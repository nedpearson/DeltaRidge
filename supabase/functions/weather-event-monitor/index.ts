/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
})

serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  const expectedSecret = Deno.env.get('CRON_SECRET')
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    // Fetch organizations that have not hit the master kill switch
    const { data: configs } = await supabase
      .from('social_autonomy_config')
      .select('organization_id')
      .eq('master_kill_switch', false)

    if (!configs || configs.length === 0) {
      return new Response("No active organizations found.", { status: 200 })
    }

    // 2. Fetch real weather events from our database (which is ingested from providers)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: recentStorms, error: stormError } = await supabase
      .from('storm_events')
      .select('*')
      .gt('occurred_at', twentyFourHoursAgo)
      .order('occurred_at', { ascending: false })
      .limit(1)
      
    if (stormError) throw stormError;

    if (!recentStorms || recentStorms.length === 0) {
      return new Response(JSON.stringify({ message: "No severe weather detected recently." }), { status: 200 })
    }
    
    const storm = recentStorms[0];
    const stormType = `${storm.hail_size_inches || 0} inch hail`;
    const affectedArea = storm.city || storm.county_parish || "the local area";

    // 3. Generate a post using AI based on the weather event
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

    // 4. Insert into content_calendar as a Draft for manager review (for each active org)
    let lastInsertedId = null;
    for (const config of configs) {
      const { data: insertedPost, error: insertError } = await supabase.from('content_calendar').insert({
        organization_id: config.organization_id,
        content: draftedContent,
        post_type: 'organic',
        content_pillar: 'storm preparedness',
        status: 'draft',
        // Schedule for 8 AM tomorrow automatically
        scheduled_for: new Date(Date.now() + 86400000).toISOString()
      }).select().single()
      
      if (insertError) {
        console.error("Failed to insert drafted storm post for org:", config.organization_id, insertError);
      } else {
        lastInsertedId = insertedPost.id;
      }
    }

    return new Response(JSON.stringify({ success: true, event: stormType, drafted_post_id: lastInsertedId }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Weather monitor failed:", error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})


