/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-console */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
})

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    // 1. Fetch pending webhooks
    const { data: pendingEvents, error: fetchError } = await supabase
      .from("social_webhooks")
      .select("*")
      .eq("processing_status", "pending")
      .order("created_at", { ascending: true })
      .limit(50)

    if (fetchError) throw fetchError
    if (!pendingEvents || pendingEvents.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: { "Content-Type": "application/json" }, status: 200 })
    }

    let processedCount = 0

    // 2. Process each event
    for (const event of pendingEvents) {
      try {
        // Mark as processing
        await supabase.from("social_webhooks").update({ processing_status: "processing" }).eq("id", event.id)

        if (event.event_type === "messaging_event" && event.platform === "meta") {
          await processMetaMessaging(event)
        }

        // Mark as success
        await supabase.from("social_webhooks").update({ processing_status: "success" }).eq("id", event.id)
        processedCount++
      } catch (err: any) {
        console.error(`Error processing webhook ${event.id}:`, err)
        // Mark as failed and increment retry_count
        await supabase.rpc('increment_webhook_retry', { webhook_id: event.id, error_msg: err.message })
      }
    }

    return new Response(JSON.stringify({ processed: processedCount }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Processor failed:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})

// Handles Facebook/Instagram messaging
async function processMetaMessaging(event: any) {
  const payload = event.payload
  if (!payload.entry) return

  for (const entry of payload.entry) {
    if (!entry.messaging) continue

    for (const messaging of entry.messaging) {
      const senderId = messaging.sender.id
      const recipientId = messaging.recipient.id
      const text = messaging.message?.text

      if (!text) continue

      // 1. Resolve Social Account
      const { data: account } = await supabase
        .from("social_accounts")
        .select("id, organization_id")
        .eq("platform_account_id", recipientId)
        .eq("platform", "meta")
        .maybeSingle()

      if (!account) throw new Error(`Unknown recipient ID: ${recipientId}`)

      // 2. Identity Resolution (Find or Create Profile)
      const { data: profile } = await resolveSocialProfile(
        account.organization_id,
        "meta",
        senderId,
        "Unknown User" // Would normally fetch profile from Graph API here
      )

      // 3. Find or Create Conversation
      const { data: conversation } = await getOrCreateConversation(
        account.organization_id,
        account.id,
        profile.id
      )

      // 4. Save Inbound Message
      const { error: msgError } = await supabase.from("social_messages").insert({
        organization_id: account.organization_id,
        conversation_id: conversation.id,
        platform_message_id: messaging.message.mid,
        direction: "inbound",
        message_type: "text",
        content: text,
        sent_at: new Date(messaging.timestamp).toISOString()
      })

      // Unique constraint will ignore duplicate MIDs
      if (msgError && msgError.code !== '23505') {
        throw msgError
      }

      // 5. Trigger AI Concierge (In a full implementation, this calls OpenAI and sends reply)
      // For now, we simulate queuing it for the AI Concierge by calling a hypothetical internal endpoint or RPC
      await triggerAiConcierge(conversation.id)
    }
  }
}

async function resolveSocialProfile(orgId: string, platform: string, platformUserId: string, displayName: string) {
  const { data: existing } = await supabase
    .from("social_profiles")
    .select("*")
    .eq("organization_id", orgId)
    .eq("platform", platform)
    .eq("platform_user_id", platformUserId)
    .maybeSingle()

  if (existing) return { data: existing }

  // Otherwise create
  const { data: created, error } = await supabase
    .from("social_profiles")
    .insert({
      organization_id: orgId,
      platform,
      platform_user_id: platformUserId,
      display_name: displayName,
      confidence_score: 10.0 // Low confidence until we get phone/email
    })
    .select()
    .single()

  if (error) throw error
  return { data: created }
}

async function getOrCreateConversation(orgId: string, accountId: string, profileId: string) {
  const { data: existing } = await supabase
    .from("social_conversations")
    .select("*")
    .eq("organization_id", orgId)
    .eq("social_account_id", accountId)
    .eq("social_profile_id", profileId)
    .eq("status", "open")
    .maybeSingle()

  if (existing) return { data: existing }

  const { data: created, error } = await supabase
    .from("social_conversations")
    .insert({
      organization_id: orgId,
      social_account_id: accountId,
      social_profile_id: profileId,
      status: "open"
    })
    .select()
    .single()

  if (error) throw error
  return { data: created }
}

async function triggerAiConcierge(conversationId: string) {
  // In production, this would invoke OpenAI with the conversation history and the Brand Brain,
  // then push the response back via the Graph API, and record an "outbound" message.
  // We'll leave this as a stub that the next phase will implement.
  console.log(`Triggering AI Concierge for conversation ${conversationId}`)
}
