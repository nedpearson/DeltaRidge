/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

// Constants
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") || "delta_ridge_secure_token"
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || ""

// Initialize Supabase Admin Client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function verifyMetaSignature(req: Request, rawBody: string, appSecret: string): Promise<boolean> {
  const signature = req.headers.get('x-hub-signature-256');
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const hashArray = Array.from(new Uint8Array(mac));
  const expectedSig = 'sha256=' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return signature === expectedSig;
}

serve(async (req) => {
  const url = new URL(req.url)
  const method = req.method

  // Extract platform from path (e.g. /social-webhook/meta)
  // URL looks like: https://<project>.supabase.co/functions/v1/social-webhook/meta
  const pathParts = url.pathname.split('/')
  const platform = pathParts[pathParts.length - 1] || 'unknown'

  // 1. Webhook Verification (Meta/Facebook)
  if (method === "GET") {
    if (platform === "meta") {
      const mode = url.searchParams.get("hub.mode")
      const token = url.searchParams.get("hub.verify_token")
      const challenge = url.searchParams.get("hub.challenge")

      if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 })
      }
      return new Response("Forbidden", { status: 403 })
    }
    
    return new Response("OK", { status: 200 })
  }

  // 2. Ingest Payload (POST)
  if (method === "POST") {
    try {
      const contentType = req.headers.get("content-type") || ""
      let payload: any = {}
      let rawText = ""
      
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await req.formData()
        for (const [key, value] of formData.entries()) {
          payload[key] = value
        }
      } else {
        rawText = await req.text()
        if (platform === "meta" && META_APP_SECRET) {
          const isValid = await verifyMetaSignature(req, rawText, META_APP_SECRET)
          if (!isValid) {
            return new Response("Invalid signature", { status: 401 })
          }
        }
        payload = JSON.parse(rawText)
      }
      
      // Determine Organization ID from provider account
      let recipientId: string | undefined;
      if (platform === 'meta' && payload.entry?.[0]?.messaging?.[0]?.recipient?.id) {
          recipientId = payload.entry[0].messaging[0].recipient.id;
      } else if (platform === 'meta' && payload.entry?.[0]?.id) {
          recipientId = payload.entry[0].id;
      } else if (platform === 'twilio' && payload.To) {
          recipientId = payload.To;
      }

      let organizationId;
      if (recipientId) {
        const { data: account } = await supabase
          .from('social_accounts')
          .select('organization_id')
          .eq('platform_account_id', recipientId)
          .eq('platform', platform)
          .maybeSingle();
          
        if (account) {
          organizationId = account.organization_id;
        }
      }
        
      if (!organizationId) {
        throw new Error("Failed to resolve organization for provider account")
      }

      // Insert into our ingestion queue
      const { error: insertError } = await supabase
        .from("social_webhooks")
        .insert({
          organization_id: organizationId,
          platform: platform,
          event_type: getEventType(platform, payload),
          payload: payload,
          processing_status: 'pending'
        })

      if (insertError) {
        throw insertError
      }

      // Return 200 OK immediately so platforms don't timeout
      if (platform === 'twilio') {
        return new Response("<Response></Response>", {
          headers: { "Content-Type": "text/xml" },
          status: 200,
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })

    } catch (err: any) {
      console.error("Webhook ingestion error for " + platform, err)
      return new Response(JSON.stringify({ error: err.message }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      })
    }
  }

  return new Response("Method not allowed", { status: 405 })
})

// Helper to determine event type
function getEventType(platform: string, payload: any): string {
  if (platform === 'meta') {
    if (payload.object === 'page' || payload.object === 'instagram') {
      return 'messaging_event'
    }
  }
  if (platform === 'twilio') {
    return 'sms_event'
  }
  if (platform === 'google_business') {
    return 'business_event'
  }
  return 'unknown_event'
}
