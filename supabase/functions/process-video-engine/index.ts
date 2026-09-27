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

    // 2. Simulate Async Video Processing
    Promise.resolve().then(async () => {
      console.log("Processing video for job " + job.id);
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
