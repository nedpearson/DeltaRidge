/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface BriefRequest {
  appointmentId: string;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const { appointmentId } = await req.json() as BriefRequest

    if (!appointmentId) {
      return new Response(JSON.stringify({ error: "Missing appointmentId" }), { status: 400 })
    }

    // 1. Fetch Appointment Context
    const { data: appointment, error: apptError } = await supabase
      .from("appointments")
      .select(
        `id, scheduled_start,
        lead:leads(
          id, source, lead_source_id,
          property:properties(id, raw_address, normalized_address)
        ),
        customer:customers(id, first_name, last_name, primary_phone, email)`
      )
      .eq("id", appointmentId)
      .single()

    if (apptError || !appointment) throw new Error("Appointment not found")

    // 2. Fetch Social Context if available
    let socialSummary = "No direct social conversation linked."
    const { data: conversations } = await supabase
      .from("social_conversations")
      .select(
        `id, intent_category,
        account:social_accounts(platform),
        messages:social_messages(content, direction, sent_at)`
      )
      .eq("lead_id", appointment.lead?.id)
      .order("created_at", { ascending: false })
      .limit(1)

    let systemPromptData = ""
    if (conversations && conversations.length > 0) {
      const conv = conversations[0]
      const msgs = conv.messages?.map((m: any) => `[${m.direction}]: ${m.content}`).join("\n") || ""
      socialSummary = `Platform: ${conv.account?.platform}\nIntent: ${conv.intent_category}\n\nChat History:\n${msgs}`
      systemPromptData += socialSummary
    } else {
      systemPromptData += "No social history."
    }

    let intelligenceBrief = "";
    
    if (OPENAI_API_KEY) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{
             role: "system", 
             content: `Generate a concise Intelligence Brief for a roofing sales rep based on this lead data:\n${JSON.stringify(appointment)}\n${systemPromptData}\n\nDo not invent facts, leaks, storm sizes, or objections that are not present in the data.`
          }],
          temperature: 0.1,
        })
      });

      if (response.ok) {
        const json = await response.json();
        intelligenceBrief = json.choices[0].message.content;
      } else {
        intelligenceBrief = "Failed to generate brief via AI."
      }
    } else {
       intelligenceBrief = `
EXECUTIVE SUMMARY:
Homeowner  booked via .
No AI analysis available (OpenAI Key missing).

CONVERSATIONAL HIGHLIGHTS:

       `.trim()
    }

    const { error: updateError } = await supabase
      .from("appointments")
      .update({
        notes: "--- INTELLIGENCE BRIEF ---\\n" + intelligenceBrief + "\\n\\n--- ORIGINAL NOTES ---\\n"
      })
      .eq("id", appointmentId)

    if (updateError) throw updateError

    return new Response(JSON.stringify({ success: true, brief: intelligenceBrief }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Brief generation failed:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
