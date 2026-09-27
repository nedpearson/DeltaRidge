/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-console */
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
    // 1. Mock checking weather for all active organizations
    // In reality, this queries an API like NOAA or HailTrace for the org's service bounding box
    const hasRecentStorm = true; // Mock true for demonstration
    const stormType = "1.5 inch hail";
    const affectedArea = "Ascension Parish";

    if (!hasRecentStorm) {
      return new Response(JSON.stringify({ message: "No severe weather detected." }), { status: 200 })
    }

    // Get active organizations (Mocking getting Delta Ridge)
    const orgId = "00000000-0000-0000-0000-000000000000";

    // 2. Generate a post using AI based on the weather event
    const systemPrompt = `You are a helpful roofing assistant. A severe weather event (${stormType}) just hit ${affectedArea}. Write a short, empathetic, helpful Facebook post offering free roof inspections. Do not be overly salesy. Warn them about hidden damage.`;
    
    let draftedContent = `Checking on everyone in ${affectedArea} after last night's ${stormType}. Hail this size often causes hidden bruising on asphalt shingles that leads to leaks months down the line. If you suspect damage, our team at Delta Ridge is doing free drone inspections all week. Stay safe!`;

    if (OPENAI_API_KEY) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "system", content: systemPrompt }],
          temperature: 0.7,
        })
      });

      if (response.ok) {
        const json = await response.json();
        draftedContent = json.choices[0].message.content;
      }
    }

    // 3. Insert into content_calendar as a Draft for manager review
    const { data: insertedPost, error: insertError } = await supabase.from('content_calendar').insert({
      organization_id: orgId,
      content: draftedContent,
      post_type: 'organic',
      content_pillar: 'storm preparedness',
      status: 'draft',
      // Schedule for 8 AM tomorrow automatically
      scheduled_for: new Date(Date.now() + 86400000).toISOString()
    }).select().single()

    if (insertError) throw insertError

    // Optionally: Dispatch a notification to the manager here (Push or Email)

    return new Response(JSON.stringify({ success: true, event: stormType, drafted_post_id: insertedPost.id }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Weather monitor failed:", error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})
