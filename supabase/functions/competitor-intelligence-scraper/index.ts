/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

/**
 * Competitor Intelligence Engine
 * 
 * Scheduled via pg_cron to run weekly.
 * 1. Queries the Meta Ad Library API for known local competitor pages.
 * 2. Parses active ads, offers, and messaging.
 * 3. Logs new threats to the `competitor_ad_intelligence` table.
 * 4. Triggers the AI Concierge / Creative Studio to draft counter-messaging if a competitor is blanketing the area with a heavy discount.
 */
serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 })
  }

  try {
    // Delta Ridge is organization index 0 in the mock or we query it. 
    const orgId = "00000000-0000-0000-0000-000000000000"; 

    // 1. Fetch tracked competitors
    // In reality, this would query a tracked_competitors table. 
    // Here we simulate the target list for Ascension Parish.
    const trackedCompetitors = [
      { name: "Big Box Roofing Corp", pageId: "123456789" },
      { name: "Storm Chasers LLC", pageId: "987654321" }
    ]

    const newThreatsFound = []

    for (const comp of trackedCompetitors) {
      // 2. Call Meta Ad Library API (Simulated)
      // const response = await fetch(`https://graph.facebook.com/v20.0/ads_archive?search_page_ids=${comp.pageId}&active_status=ACTIVE...`)
      
      const simulatedActiveAds = [
        {
          id: `ad_${Math.floor(Math.random() * 10000)}`,
          page_name: comp.name,
          ad_creation_time: new Date().toISOString(),
          ad_creative_body: `Get a brand new roof with ZERO down! We waive your deductible! Call ${comp.name} today.`,
          detected_offer: "Waive Deductible / Zero Down"
        }
      ]

      // 3. Process the ads to find compliance violations or aggressive offers
      for (const ad of simulatedActiveAds) {
        
        // Detect "waiving deductibles" which is a common (and often illegal) tactic 
        // that Delta Ridge needs to actively sell against using education.
        const isIllegalOffer = ad.ad_creative_body.toLowerCase().includes("waive") && ad.ad_creative_body.toLowerCase().includes("deductible");
        
        if (isIllegalOffer) {
          // Log it to the DB
          await supabase.from('competitor_ad_intelligence').insert({
            organization_id: orgId,
            competitor_name: ad.page_name,
            platform: 'meta',
            ad_content: ad.ad_creative_body,
            threat_level: 'high',
            notes: 'Detected illegal deductible waiving offer. Triggering counter-education campaign.'
          })

          newThreatsFound.push(ad)
          
          // Generate a counter-campaign automatically via the Brand Brain
          await supabase.from('content_calendar').insert({
            organization_id: orgId,
            content: `[AUTO-GENERATED COUNTER] Be careful of roofers promising to "waive your deductible." In Louisiana, this is insurance fraud and leaves the homeowner liable. At Delta Ridge, we believe in honest, legal, local business. Book a free inspection today.`,
            post_type: 'organic',
            content_pillar: 'education',
            status: 'draft',
            scheduled_for: new Date(Date.now() + 3600000).toISOString() // Schedule for 1 hour from now
          })
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      competitorsScanned: trackedCompetitors.length,
      threatsDetected: newThreatsFound.length 
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Competitor Intelligence Engine failed:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
