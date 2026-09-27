/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-console */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const { conversationId } = await req.json()

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "Missing conversationId" }), { status: 400 })
    }

    // 1. Fetch conversation history
    const { data: messages, error: msgError } = await supabase
      .from("social_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true })

    if (msgError) throw msgError

    // 2. Fetch Brand Brain Context (FAQs, Voice, Policies)
    const { data: conversation, error: convError } = await supabase
      .from("social_conversations")
      .select(`
        organization_id, 
        social_account_id, 
        social_profile_id,
        account:social_accounts(*),
        profile:social_profiles(*)
      `)
      .eq("id", conversationId)
      .single()

    if (convError) throw convError

    const { data: brandKnowledge } = await supabase
      .from("brand_knowledge")
      .select("category, topic, content")
      .eq("organization_id", conversation.organization_id)
      .eq("is_approved", true)

    // 3. TODO: Construct LLM Prompt
    // ... openai.chat.completions.create(...)

    // 4. Simulate AI Reply
    const simulatedReply = "Hi, this is Dustin's AI assistant at Delta Ridge. How can I help you with your roof today?"

    // 5. Store Outbound Message
    await supabase.from("social_messages").insert({
      organization_id: conversation.organization_id,
      conversation_id: conversationId,
      platform_message_id: `sys_${crypto.randomUUID()}`,
      direction: "outbound",
      message_type: "text",
      content: simulatedReply,
      is_ai_generated: true,
      sent_at: new Date().toISOString()
    })

    // 6. Dispatch to actual platform API (Meta Graph API)
    if (conversation.account?.platform === 'meta' && conversation.account?.encrypted_access_token) {
      // In production, we would decrypt the token using Supabase Vault or KMS
      const accessToken = conversation.account.encrypted_access_token;
      
      const MetaApiClient = (await import('../_shared/meta-api.ts')).MetaApiClient;
      const metaApi = new MetaApiClient(accessToken);
      
      try {
        await metaApi.sendMessage(
          conversation.account.platform_account_id,
          conversation.profile.platform_user_id,
          simulatedReply
        );
      } catch (err) {
        console.error("Failed to send Meta message:", err);
        // We log the error but still return 200 so the caller knows the AI process finished
      }
    }

    return new Response(JSON.stringify({ success: true, reply: simulatedReply }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("AI Concierge failed:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
