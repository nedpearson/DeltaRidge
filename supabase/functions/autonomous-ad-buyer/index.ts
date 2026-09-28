/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
})

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    // 1. Fetch published posts that are strictly 'organic'
    const { data: eligiblePosts, error: fetchError } = await supabase
      .from('content_calendar')
      .select(`*, account:social_accounts(*)`)
      .eq('status', 'published')
      .eq('post_type', 'organic')

    if (fetchError) throw fetchError

    let promotedCount = 0

    for (const post of eligiblePosts || []) {
      const orgId = post.organization_id;

      // 1b. Check master kill switch
      const { data: config } = await supabase
        .from('social_autonomy_config')
        .select('master_kill_switch')
        .eq('organization_id', orgId)
        .single()

      if (config?.master_kill_switch) {
        console.log(`Skipping post ${post.id}: master kill switch is active`);
        continue;
      }

      if (!post.account || post.account.is_active === false) {
        console.log(`Skipping post ${post.id}: account is paused or missing`);
        continue;
      }

      // 2. Check if the organic post generated > $10,000 in attributed revenue
      const revenue = post.performance_metrics?.attributed_revenue || 0
      
      if (revenue > 10000) {
        // 3. Promote it: Call Meta Ads API to convert the post to a sponsored ad
        console.log(`Promoting post ${post.id} with revenue ${revenue}`)

        let providerCampaignId = "";
        try {
          const { MetaApiClient } = await import('../_shared/meta-api.ts');
          if (post.account?.encrypted_access_token) {
             const metaApi = new MetaApiClient(post.account.encrypted_access_token);
             const response = await metaApi.createCampaign(post.account.platform_account_id, 'LEAD_GENERATION', 50, `PROMO_POST_${post.id}`);
             providerCampaignId = response.id;
          }
        } catch (e) {
          console.error(`Failed to launch ad for post ${post.id}:`, e);
          continue; // Don't mark as sponsored if provider failed
        }

        // 4. Update the DB to mark it as sponsored only after provider confirms
        await supabase
          .from('content_calendar')
          .update({
            post_type: 'sponsored',
            notes: `Autonomously promoted to $50/day ad due to high organic ROI ($${revenue}). Provider Campaign ID: ${providerCampaignId}`
          })
          .eq('id', post.id)

        promotedCount++
      }
    }

    return new Response(JSON.stringify({ success: true, promoted_count: promotedCount }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Autonomous Ad Buyer failed:", error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})
