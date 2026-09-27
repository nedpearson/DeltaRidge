/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-console */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || ""

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
    const { prompt, organizationId } = await req.json()

    if (!prompt || !organizationId) {
      return new Response(JSON.stringify({ error: "Missing prompt or organizationId" }), { status: 400 })
    }

    let imageUrl = "https://images.unsplash.com/photo-1600607688066-890987f18a86?q=80&w=1000&auto=format&fit=crop";

    if (OPENAI_API_KEY) {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: prompt,
          n: 1,
          size: "1024x1024"
        })
      });

      if (response.ok) {
        const json = await response.json();
        imageUrl = json.data[0].url;
      } else {
        console.error("OpenAI Error", await response.text());
      }
    } else {
      console.warn("NO OPENAI_API_KEY. Using mock image.");
    }

    // Save to creative_assets
    const { data: asset, error } = await supabase.from('creative_assets').insert({
      organization_id: organizationId,
      asset_type: 'image',
      provenance: 'ai_generated',
      url: imageUrl,
      metadata: { prompt }
    }).select().single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, asset }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Image generation failed:", error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } })
  }
})
