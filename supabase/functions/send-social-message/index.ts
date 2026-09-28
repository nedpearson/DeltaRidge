import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { requireAuth } from "../_shared/auth.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  try {
    const user = await requireAuth(req)
    
    const { conversation_id, content } = await req.json()
    if (!conversation_id || !content) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: conv } = await supabaseClient.from('social_conversations')
      .select('organization_id, social_accounts(platform, platform_account_id, encrypted_access_token), social_profiles(platform_profile_id)')
      .eq('id', conversation_id)
      .single()

    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404 })
    }
    
    // Auth check
    const { data: orgMember } = await supabaseClient.from('organization_members')
      .select('id')
      .eq('organization_id', conv.organization_id)
      .eq('user_id', user.id)
      .single()
      
    if (!orgMember) {
      return new Response("Unauthorized", { status: 403 })
    }

    const token = conv.social_accounts?.encrypted_access_token
    if (!token) {
      throw new Error("Missing or expired social account token. Cannot send message.")
    }

    if (conv.social_accounts?.platform !== 'meta') {
      throw new Error("Unsupported platform: " + conv.social_accounts?.platform)
    }

    // Dynamic import of MetaApiClient
    const MetaApiClient = (await import('../_shared/meta-api.ts')).MetaApiClient;
    const metaApi = new MetaApiClient(token);
    
    // Dispatch to Graph API
    const result = await metaApi.sendMessage(
       conv.social_accounts.platform_account_id,
       conv.social_profiles.platform_profile_id,
       content
    );

    if (!result || result.error || !result.message_id) {
       throw new Error(result?.error?.message || "Invalid response from Meta API");
    }

    const providerMessageId = result.message_id

    const { data: msg, error } = await supabaseClient.from('social_messages').insert({
      organization_id: conv.organization_id,
      conversation_id,
      platform_message_id: providerMessageId,
      direction: 'outbound',
      message_type: 'text',
      content,
      is_ai_generated: false,
      sent_at: new Date().toISOString()
    }).select().single()

    if (error) throw error

    return new Response(JSON.stringify(msg), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 })
  }
})
