/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-console */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface CopyRequest {
  topic: string;
  pillar: string;
  platform: string;
  organizationId: string;
}

serve(async (req) => {
  // CORS headers
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    })
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const { topic, pillar, platform, organizationId } = await req.json() as CopyRequest

    if (!topic || !pillar || !platform || !organizationId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 })
    }

    // 1. Fetch Brand Brain Context (Tone, Policies, Founder Story)
    const { data: knowledge, error: kError } = await supabase
      .from("brand_knowledge")
      .select("category, topic, content")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .eq("is_approved", true)

    if (kError) throw kError

    let toneRules = ""
    let founderStory = ""
    let policies = ""

    knowledge?.forEach((k) => {
      if (k.category === 'tone') toneRules += `- ${k.topic}: ${k.content}\n`
      if (k.category === 'founder_story') founderStory += `${k.content}\n`
      if (k.category === 'policy') policies += `- ${k.topic}: ${k.content}\n`
    })

    // 2. Construct the LLM Prompt
    const systemPrompt = `
You are the elite social media copywriter for Delta Ridge, a roofing company in Ascension Parish, Louisiana.
Your job is to write highly engaging, authentic social media copy for the requested platform.

--- BRAND RULES & TONE ---
${toneRules || "Write in an authentic, local, no-nonsense tone. Avoid overly salesy or generic 'Best roofer in town' clichés."}

--- FOUNDER STORY (Use if relevant) ---
${founderStory || "Dustin Wambsgans founded Delta Ridge to bring trust and craftsmanship to roofing."}

--- COMPLIANCE / POLICIES ---
${policies || "Never promise that insurance will cover a claim. Only offer free inspections."}

--- INSTRUCTIONS ---
- The content pillar is: ${pillar}
- The target platform is: ${platform}
- Adapt the length, formatting, and hashtag usage to fit the exact platform.
- Do NOT use emojis excessively. Keep it professional yet approachable.
- Always include a clear Call-To-Action (CTA) at the end, usually directing them to book a free inspection or visit the website.
`.trim()

    const userPrompt = `Please write a post about the following topic: ${topic}`

    // 3. Call OpenAI API
    // If we don't have a key (e.g. running locally without env), we return a simulated response.
    let generatedCopy = ""

    if (OPENAI_API_KEY) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`)
      }

      const aiData = await response.json()
      generatedCopy = aiData.choices[0].message.content
    } else {
      // Simulated response for development
      console.log("No OPENAI_API_KEY found, simulating response...")
      generatedCopy = `(Simulated AI Copy for ${platform})\n\nDid you know that ${topic}?\n\nHere at Delta Ridge, we see this all the time in Ascension Parish. ${founderStory.slice(0, 50)}... That's why we take this seriously.\n\nDon't wait until a small issue becomes a massive leak. Let us give you a free, honest assessment. No pressure, just facts.\n\n👇 Click the link in our bio to schedule your free inspection today.`
    }

    // 4. Log the generation in a content calendar / history table (Simulated here)
    await supabase.from("content_calendar").insert({
      organization_id: organizationId,
      platform: platform.toLowerCase(),
      content_type: 'post',
      asset_text: generatedCopy,
      status: 'draft',
      scheduled_for: new Date(Date.now() + 86400000).toISOString() // Scheduled for tomorrow by default
    })

    return new Response(JSON.stringify({ success: true, copy: generatedCopy }), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      status: 200,
    })

  } catch (error: any) {
    console.error("Copy generation failed:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      status: 500,
    })
  }
})
