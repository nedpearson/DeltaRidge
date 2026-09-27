import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface WebhookPayload {
  type: 'UPDATE';
  table: string;
  record: any;
  old_record: any;
}

/**
 * Review Acquisition Engine
 * 
 * Triggered via Postgres webhook when an Inspection/Job is marked 'completed' or 'closed_won'.
 * Automates the collection of 5-star Google Business/Facebook reviews by:
 * 1. Waiting for an optimal delay (e.g., 24 hours after completion)
 * 2. Generating a personalized SMS/Email request
 * 3. Handling API responses to auto-reply to the review once posted
 */
serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const payload = await req.json() as WebhookPayload

    // Monitor the `appointments` (or jobs) table for completed work
    if (payload.table !== 'appointments') {
      return new Response("Ignored: Not an appointments table event", { status: 200 })
    }

    const appt = payload.record
    const oldAppt = payload.old_record

    // Check if status transitioned to 'completed'
    if (appt.status !== 'completed' || oldAppt.status === 'completed') {
      return new Response("Ignored: Not a completion transition", { status: 200 })
    }

    // 1. Fetch Customer and Rep details
    const { data: details, error } = await supabase
      .from('appointments')
      .select(`
        customer:customers(id, first_name, last_name, phone, email),
        assigned_to:users(first_name, last_name)
      `)
      .eq('id', appt.id)
      .single()

    if (error || !details?.customer) {
      console.error("Missing customer data for review request.")
      return new Response("Missing customer data", { status: 400 })
    }

    const customer = details.customer as any
    const repName = (details.assigned_to as any)?.first_name || 'our team'

    // 2. Generate highly personalized review request
    // "Hey John, thanks for trusting Dustin and the Delta Ridge team..."
    const personalizedMessage = `Hey ${customer.first_name}, thanks for trusting ${repName} and the Delta Ridge team with your roof inspection today. If we provided 5-star service, it would mean the world to our local Ascension Parish business if you left us a quick Google review here: [GOOGLE_REVIEW_LINK] \n\nThanks again, Dustin W.`

    // 3. Queue the outbound message
    // Instead of sending immediately when the rep clicks 'complete' in the driveway, 
    // we queue it to send the next morning when engagement rates are higher.
    const scheduledTime = new Date()
    scheduledTime.setDate(scheduledTime.getDate() + 1)
    scheduledTime.setHours(9, 0, 0, 0) // 9:00 AM tomorrow

    await supabase.from('social_messages').insert({
      organization_id: appt.organization_id,
      conversation_id: null, // Will map to SMS provider / Twilio table in reality
      direction: 'outbound',
      platform: 'sms',
      content: personalizedMessage,
      sent_at: scheduledTime.toISOString(),
      is_ai_generated: true
    })

    // Log the automation
    await supabase.from('automation_ledger').insert({
      organization_id: appt.organization_id,
      action_type: 'review_request_queued',
      entity_type: 'customer',
      entity_id: customer.id,
      description: `Queued automated review request to ${customer.first_name} following completed appointment by ${repName}.`,
      status: 'executed'
    })

    return new Response(JSON.stringify({ success: true, queued: true, target: customer.phone }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Review Acquisition Engine failed:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
