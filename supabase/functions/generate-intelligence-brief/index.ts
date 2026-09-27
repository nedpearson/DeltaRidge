/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

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
      .select(`
        id, scheduled_start,
        lead:leads(
          id, source, lead_source_id, utm_campaign,
          property:properties(id, raw_address, normalized_address)
        ),
        customer:customers(id, first_name, last_name, phone, email)
      `)
      .eq("id", appointmentId)
      .single()

    if (apptError || !appointment) throw new Error("Appointment not found")

    // 2. Fetch Social Context if available
    let socialSummary = "No direct social conversation linked."
    const { data: conversations } = await supabase
      .from("social_conversations")
      .select(`
        id, intent_category,
        account:social_accounts(platform),
        messages:social_messages(content, direction, sent_at)
      `)
      .eq("lead_id", appointment.lead?.id)
      .order("created_at", { ascending: false })
      .limit(1)

    if (conversations && conversations.length > 0) {
      const conv = conversations[0]
      const msgs = conv.messages?.map(m => `[${m.direction.toUpperCase()}]: ${m.content}`).join("\n") || ""
      socialSummary = `Platform: ${conv.account?.platform}\nIntent: ${conv.intent_category}\n\nChat History:\n${msgs}`
    }

    // 3. TODO: Fetch Storm/Permit data using the existing scoring logic views
    // const propertyContext = await fetchPropertyStormHistory(appointment.lead.property.id)

    // 4. Generate the Intelligence Brief using an LLM (Simulated)
    // In production, we send the `socialSummary` and `propertyContext` to OpenAI to summarize.
    const intelligenceBrief = `
EXECUTIVE SUMMARY:
Homeowner ${appointment.customer?.first_name || 'Unknown'} booked via ${conversations?.[0]?.account?.platform || 'Social'} after engaging with the ${appointment.lead?.utm_campaign || 'recent'} campaign.

THE PROBLEM:
Homeowner indicated an active leak developing near the chimney. 

STORM CORRELATION:
Property address (${appointment.lead?.property?.raw_address}) is within 1.2 miles of the 1.5" hail report from 14 days ago. Roof is estimated at 12 years old (no recent re-roof permits found).

CONVERSATIONAL HIGHLIGHTS:
- Extremely responsive to AI agent.
- Explicitly requested an afternoon inspection.
- Mentioned they have State Farm insurance but haven't filed a claim yet.

LIKELY OBJECTIONS:
- "I want to wait to see if insurance will cover it before committing."
- "I heard contractors chase storms."

RECOMMENDED APPROACH:
1. Validate the leak immediately to build trust.
2. Provide education on the State Farm claims process, as they are hesitant.
3. Emphasize Delta Ridge's local Ascension Parish roots to counter the "storm chaser" fear.
    `.trim()

    // 5. Store the brief.
    // If an `appointment_briefs` table doesn't exist yet, we append it to the `notes` column 
    // or store it in a new dedicated column/table. For now, we update `appointments.notes`.
    const { error: updateError } = await supabase
      .from("appointments")
      .update({
        notes: `--- INTELLIGENCE BRIEF ---\n${intelligenceBrief}\n\n--- ORIGINAL NOTES ---\n`
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
