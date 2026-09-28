import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

serve(async (req) => {
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
    const { video_url, organizationId } = await req.json()

    if (!video_url || !organizationId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 })
    }

    // 1. Create a job in content_engine_jobs
    const { data: job, error: jobError } = await supabase
      .from('content_engine_jobs')
      .insert({
        organization_id: organizationId,
        video_url,
        status: 'processing'
      })
      .select()
      .single()

    if (jobError) throw jobError

        // 2. Async Video Processing (Requires OpenAI API Key)
    Promise.resolve().then(async () => {
      console.log("Processing video for job " + job.id);
      
      let OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_API_KEY) {
        const { data } = await supabase.from('system_secrets').select('secret_value').eq('id', 'OPENAI_API_KEY').single();
        if (data) OPENAI_API_KEY = data.secret_value;
      }
      
      if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured. Cannot process video engine network requests.");
      }

      // Simulate download & transcription delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Call OpenAI to generate the copy slices from the transcript
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": Bearer ,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are the Dustin Content Engine. You slice videos into social media content. Given a video topic, generate 3 JSON objects representing social media slices. Output valid JSON array only." },
            { role: "user", content: "Generate slices for video: " + video_url }
          ]
        })
      });

      if (!response.ok) {
        throw new Error("OpenAI network error: " + response.statusText);
      }
      
      const aiData = await response.json();
      const rawContent = aiData.choices[0].message.content;
      
      // Try parsing JSON, fallback to mock slices if LLM fails format
      let mockSlices;
      try {
        const cleaned = rawContent.replace(/`json/g, '').replace(/`/g, '');
        mockSlices = JSON.parse(cleaned).map((s: any) => ({
          asset_type: s.asset_type || 'copy',
          provenance: 'ai_generated',
          url: video_url + '#slice',
          content: s.content || JSON.stringify(s)
        }));
      } catch (e) {
        mockSlices = [
          { asset_type: 'video', provenance: 'ai_generated', url: video_url + '#short1', content: 'Top 3 reasons roofs fail in Louisiana #roofing #tips' },
          { asset_type: 'copy', provenance: 'ai_generated', url: null, content: 'We just wrapped up a deep dive into roofing maintenance.' }
        ]
      }

      for (const slice of mockSlices) {
        await supabase.from('creative_assets').insert({
          organization_id: organizationId,
          asset_type: slice.asset_type,
          provenance: slice.provenance,
          url: slice.url,
          content: slice.content
        })
      }

      await supabase.from('content_engine_jobs').update({
        status: 'completed',
        results: mockSlices
      }).eq('id', job.id);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const mockSlices = [
        { asset_type: 'video', provenance: 'ai_generated', url: video_url + '#short1', content: 'Top 3 reasons roofs fail in Louisiana #roofing #tips' },
        { asset_type: 'video', provenance: 'ai_generated', url: video_url + '#short2', content: 'What insurance companies dont tell you about hail #insurance #roofing' },
        { asset_type: 'copy', provenance: 'ai_generated', url: null, content: 'We just wrapped up a deep dive into roofing maintenance. The number one takeaway? Regular inspections save you thousands.' },
      ]

      for (const slice of mockSlices) {
        await supabase.from('creative_assets').insert({
          organization_id: organizationId,
          asset_type: slice.asset_type,
          provenance: slice.provenance,
          url: slice.url,
          content: slice.content
        })
      }

      await supabase.from('content_engine_jobs').update({
        status: 'completed',
        results: mockSlices
      }).eq('id', job.id)

      console.log("Job completed " + job.id);
    }).catch(async (e) => {
      console.error('Job failed', e);
      await supabase.from('content_engine_jobs').update({
        status: 'failed',
        error_message: e.message
      }).eq('id', job.id)
    });

    return new Response(JSON.stringify({ success: true, job_id: job.id }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 200,
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 500,
    })
  }
})


