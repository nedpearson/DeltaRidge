/* eslint-disable @typescript-eslint/no-explicit-any */
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
    // 1. Fetch posts scheduled for right now or in the past that are still 'scheduled'
    const now = new Date().toISOString()
    const { data: postsToPublish, error: fetchError } = await supabase
      .from('content_calendar')
      .select(`
        *,
        account:social_accounts(*)
      `)
      .eq('status', 'scheduled')
      .lte('scheduled_for', now)
      .limit(10)

    if (fetchError) throw fetchError

    if (!postsToPublish || postsToPublish.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { status: 200 })
    }

    let publishedCount = 0

    // 2. Publish each post
    for (const post of postsToPublish) {
      try {
        if (!post.account || !post.account.encrypted_access_token) {
           throw new Error("Missing social account credentials")
        }
        
        // Dynamic import of MetaApiClient (or other platforms)
        const MetaApiClient = (await import('../_shared/meta-api.ts')).MetaApiClient;
        const metaApi = new MetaApiClient(post.account.encrypted_access_token);
        
        // Real dispatch to Graph API to create a post
        await metaApi.createPagePost(
           post.account.platform_account_id, 
           post.content
        );

        // Update post status to published
        await supabase
          .from('content_calendar')
          .update({
            status: 'published',
            published_at: new Date().toISOString(),
            platform_post_id: `ext_${crypto.randomUUID()}`
          })
          .eq('id', post.id)

        publishedCount++
      } catch (err: any) {
        console.error(`Failed to publish post ${post.id}:`, err)
        // Mark as failed so it doesn't get retried infinitely without human review
        await supabase.from('content_calendar').update({ status: 'failed' }).eq('id', post.id)
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

