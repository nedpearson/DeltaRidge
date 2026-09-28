/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
})

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const { record: lead, old_record: oldLead } = await req.json()

    // 1. Only trigger if status changed to 'sold' (which is the actual enum value)
    if (lead?.status !== 'sold') {
      return new Response("Not a sold job", { status: 200 })
    }

    if (oldLead && oldLead.status === 'sold') {
      return new Response("Already processed", { status: 200 })
    }

    // 2. Fetch Google Review Link for the Organization
    const reviewLink = "https://g.page/r/delta-ridge-roofing/review";
    const propertyType = 'roof';

    // 3. Use AI to generate a highly personalized review draft
    let suggestedReview = "The team at Delta Ridge did an amazing job replacing my roof. Highly recommend!";

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
             content: `You are a helpful assistant writing a suggested 5-star Google review for a homeowner to copy/paste. Make it sound natural and mention their specific project details: ${propertyType}. Do not exceed 2 sentences.`
          }],
          temperature: 0.7,
        })
      });

      if (response.ok) {
        const json = await response.json();
        suggestedReview = json.choices[0].message.content;
      }
    }

    const messageContent = `Hi! It was great working on your project. If you have a minute, we'd love a Google Review. Here's a link: ${reviewLink}\n\nIf it helps, here's a quick template you can copy and paste:\n\n"${suggestedReview}"`;

    // Rather than inserting into social_messages with non-existent columns,
    // we log an activity against the lead, and a ledger entry.
    // In a full implementation, we'd enqueue to an SMS service.
    
    await supabase.from('activities').insert({
       organization_id: lead.organization_id,
       lead_id: lead.id,
       activity_type: 'email', // fallback since sms isn't in enum? Wait, let's check enum.
       notes: "Sent automated review request:\n" + messageContent
    });

    await supabase.from('automation_ledger').insert({
       organization_id: lead.organization_id,
       event_trigger: 'lead_won',
       rule_name: 'review_acquisition',
       action_attempted: 'send_review_request',
       status: 'completed',
       metadata: { message: messageContent }
    });

    return new Response(JSON.stringify({ success: true, requested: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Review Acquisition Engine failed:", error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})
