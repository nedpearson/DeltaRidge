/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"
import * as crypto from "https://deno.land/std@0.177.0/crypto/crypto.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
})

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    // We expect this to be called by a cron. We could authenticate via secret token here.
    
    // 1. Fetch posts scheduled for right now or in the past that are still 'scheduled' or 'queued'
    const now = new Date().toISOString()
    const { data: postsToPublish, error: fetchError } = await supabase
      .from('content_calendar')
      .select(
        *,
        account:social_accounts(*)
      )
      .in('status', ['scheduled', 'queued'])
      .lte('scheduled_for', now)
      .limit(10)

    if (fetchError) throw fetchError

    if (!postsToPublish || postsToPublish.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { status: 200 })
    }

    let publishedCount = 0

    // 2. Publish each post
    for (const post of postsToPublish) {
      // Create idempotency key
      const idempotencyKey = post.id + '-' + (post.retry_count || 0)
      
      try {
        const orgId = post.organization_id;

        const { data: config } = await supabase
          .from('social_autonomy_config')
          .select('master_kill_switch')
          .eq('organization_id', orgId)
          .single()

        if (config?.master_kill_switch) {
          console.log(Skipping publish for post  + post.id + : master kill switch is active);
          continue;
        }

        if (!post.account || !post.account.encrypted_access_token) {
           throw new Error("Missing social account credentials")
        }

        if (post.account.is_active === false) {
           console.log(Skipping publish for post  + post.id + : channel is paused);
           continue;
        }

        // Only proceed for supported platforms
        if (post.account.platform !== 'meta') {
           throw new Error("Provider Not yet supported: " + post.account.platform);
        }

        // Set status to attempting
        await supabase.from('content_calendar').update({ status: 'attempting' }).eq('id', post.id)
        
        // Log attempt
        await supabase.from('integration_traces').insert({
          organization_id: orgId,
          provider: post.account.platform,
          endpoint: 'publish',
          request_payload: { post_id: post.id, content: post.content },
          status_code: 0
        })

        // Dynamic import of MetaApiClient
        const MetaApiClient = (await import('../_shared/meta-api.ts')).MetaApiClient;
        const metaApi = new MetaApiClient(post.account.encrypted_access_token);
        
        // Dispatch to Graph API
        const result = await metaApi.publishPost(
           post.account.platform_account_id,
           post.content || post.asset_text || ""
        );

        if (!result || result.error || !result.id) {
           throw new Error(result?.error?.message || "Invalid response from Meta API");
        }

        // Update post status to published
        const { error: updateError } = await supabase
          .from('content_calendar')
          .update({
            status: 'published',
            published_at: new Date().toISOString(),
            platform_post_id: result.id
          })
          .eq('id', post.id)
          
        if (updateError) {
           throw new Error("Failed to update post status after publish");
        }

        publishedCount++
      } catch (err: any) {
        console.error(Failed to publish post  + post.id + :, err)
        // Mark as failed
        await supabase.from('content_calendar').update({ status: 'failed', failure_reason: err.message }).eq('id', post.id)
      }
    }

    return new Response(JSON.stringify({ processed: publishedCount }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Publishing cron failed:", error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})
