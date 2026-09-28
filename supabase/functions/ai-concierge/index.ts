/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const { conversationId } = await req.json()

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "Missing conversationId" }), { status: 400 })
    }

    const { data: messages, error: msgError } = await supabase
      .from("social_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true })

    if (msgError) throw msgError

    const { data: conversation, error: convError } = await supabase
      .from("social_conversations")
      .select(`\n        organization_id, 
        social_account_id, 
        social_profile_id,
        assigned_to,
        status,
        account:social_accounts(*),
        profile:social_profiles(*)` )
      .eq("id", conversationId)
      .single()

    if (convError) throw convError

    // Honor human ownership
    if (conversation.assigned_to) {
      console.log("Conversation owned by human. AI skipping.")
      return new Response(JSON.stringify({ success: true, reason: "human_owned" }), { status: 200 })
    }

    const { data: brandKnowledge } = await supabase
      .from("brand_knowledge")
      .select("category, topic, content")
      .eq("organization_id", conversation.organization_id)
      .eq("is_approved", true)

    // Build Brand Context
          const rules = brandKnowledge?.map(k => " - " + k.topic + ": " + k.content).join("\n") || ""
      const systemPrompt = "You are the AI Concierge for Delta Ridge, a roofing company.\nYour goal is to answer questions, be helpful, and qualify leads to book appointments.\nUse this brand knowledge:\n" + rules + "\n\nAnalyze the conversation. Extract any available contact info. Determine the intent.\nOutput JSON EXACTLY in this format:\n{\"reply\": \"...\", \"intent_category\": \"...\", \"extracted_address\": \"...\"}"
      let aiResult = {
      reply: "Hi, this is Delta Ridge's AI assistant. I'm currently undergoing maintenance.",
      intent_category: "nurture",
      extracted_info: { name: null, phone: null, address: null },
      wants_appointment: false
    }

    if (OPENAI_API_KEY) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'system', content: systemPrompt }, ...chatHistory],
          response_format: { type: 'json_object' }
        })
      })
      if (resp.ok) {
        const json = await resp.json()
        try { aiResult = JSON.parse(json.choices[0].message.content) } catch(e) { console.error('Parse err', e) }
      } else {
        console.error("OpenAI Error", await resp.text())
      }
    } else {
      console.warn("NO OPENAI_API_KEY. Using mock response.")
      aiResult.reply = "We'd love to help! Can we get an address or phone number to check our schedule?"
      if (chatHistory[chatHistory.length - 1]?.content.match(/\d{3}/)) {
         aiResult.extracted_info.phone = chatHistory[chatHistory.length - 1].content
         aiResult.wants_appointment = true
         aiResult.reply = "Got your info! A manager will review this and get an estimator out to you shortly."
      }
    }

    // Store Outbound Message
    await supabase.from("social_messages").insert({
      organization_id: conversation.organization_id,
      conversation_id: conversationId,
      platform_message_id: "sys_",
      direction: "outbound",
      message_type: "text",
      content: aiResult.reply,
      is_ai_generated: true,
      sent_at: new Date().toISOString()
    })

    // Update conversation intent
    await supabase.from("social_conversations").update({
      intent_category: aiResult.intent_category
    }).eq("id", conversationId)

    // Save extracted profile info
    if (aiResult.extracted_info.name || aiResult.extracted_info.phone || aiResult.extracted_info.address) {
      const updates: any = {}
      if (aiResult.extracted_info.name && !conversation.profile.display_name) updates.display_name = aiResult.extracted_info.name
      if (aiResult.extracted_info.phone) updates.phone = aiResult.extracted_info.phone
      if (aiResult.extracted_info.address) updates.address = aiResult.extracted_info.address

      if (Object.keys(updates).length > 0) {
        await supabase.from("social_profiles").update(updates).eq("id", conversation.social_profile_id)
      }
    }

    if (conversation.account?.platform === 'meta' && conversation.account?.encrypted_access_token) {
      const accessToken = conversation.account.encrypted_access_token;
      const MetaApiClient = (await import('../_shared/meta-api.ts')).MetaApiClient;
      const metaApi = new MetaApiClient(accessToken);
      try {
        await metaApi.sendMessage(
          conversation.account.platform_account_id,
          conversation.profile.platform_user_id,
          aiResult.reply
        );
      } catch (err) { console.error("Meta API err", err) }
    }

    return new Response(JSON.stringify({ success: true, reply: aiResult.reply }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("AI Concierge failed:", error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})












