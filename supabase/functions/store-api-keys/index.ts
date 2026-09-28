/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
    })
  }

  try {
    const { openaiKey, metaKey, twilioKey } = await req.json()
    
    if (openaiKey) {
      await supabase.from('system_secrets').upsert({ id: 'OPENAI_API_KEY', secret_value: openaiKey });
    }
    if (metaKey) {
      await supabase.from('system_secrets').upsert({ id: 'META_ACCESS_TOKEN', secret_value: metaKey });
    }
    if (twilioKey) {
      await supabase.from('system_secrets').upsert({ id: 'TWILIO_AUTH_TOKEN', secret_value: twilioKey });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, status: 200,
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, status: 500,
    })
  }
})

