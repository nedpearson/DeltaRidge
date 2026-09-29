import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const AUTOMATION_SECRET = Deno.env.get("AUTOMATION_WEBHOOK_SECRET") || ""

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const TRACE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function traceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let suffix = ''
  for (let i = 0; i < 16; i++) suffix += TRACE_ALPHABET[bytes[i] % TRACE_ALPHABET.length]
  return 'tr_' + suffix
}

async function trace(
  organizationId: string,
  id: string,
  outcome: 'started' | 'ok' | 'failed' | 'refused',
  detail?: string,
) {
  await db.from('integration_traces').insert({
    organization_id: organizationId,
    trace_id: id,
    layer: 'outbound',
    step: 'social_publish',
    outcome,
    entity: 'content_calendar',
    detail: detail?.slice(0, 200) ?? null,
  })
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !AUTOMATION_SECRET) {
    return new Response(JSON.stringify({ error: 'Publishing worker is not configured.' }), { status: 503 })
  }
  if (req.headers.get('x-delta-ridge-automation-secret') !== AUTOMATION_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  try {
    const { data: claimed, error: claimError } = await db.rpc('claim_due_social_posts', { p_limit: 10 })
    if (claimError) throw claimError

    const ids = (claimed ?? []).map((row: { post_id: string }) => row.post_id)
    if (ids.length === 0) {
      return new Response(JSON.stringify({ processed: 0, failed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: posts, error: fetchError } = await db
      .from('content_calendar')
      .select(`
        id, organization_id, status,
        account:social_accounts(platform, platform_account_id, encrypted_access_token, is_active),
        asset:creative_assets(asset_type, content)
      `)
      .in('id', ids)
    if (fetchError) throw fetchError

    let published = 0
    let failed = 0

    for (const post of posts ?? []) {
      const attemptTrace = traceId()
      await trace(post.organization_id, attemptTrace, 'started')

      try {
        const { data: config, error: configError } = await db
          .from('social_autonomy_config')
          .select('master_kill_switch')
          .eq('organization_id', post.organization_id)
          .maybeSingle()
        if (configError) throw configError
        if (config?.master_kill_switch) throw new Error('Master kill switch is active.')

        if (!post.account || post.account.is_active === false) throw new Error('Social account is unavailable.')
        if (post.account.platform !== 'meta') throw new Error('This provider is not supported by the live publisher.')
        if (!post.account.encrypted_access_token) throw new Error('Social account credential is unavailable.')
        if (!post.asset || post.asset.asset_type !== 'copy' || !post.asset.content?.trim()) {
          throw new Error('A non-empty text copy asset is required.')
        }

        const { MetaApiClient } = await import('../_shared/meta-api.ts')
        const meta = new MetaApiClient(post.account.encrypted_access_token)
        const result = await meta.publishPost(post.account.platform_account_id, post.asset.content)

        if (!result?.id) throw new Error(result?.error?.message || 'Provider did not return a post ID.')

        const { error: publishUpdateError } = await db
          .from('content_calendar')
          .update({
            status: 'published',
            published_at: new Date().toISOString(),
            platform_post_id: result.id,
            failure_reason: null,
          })
          .eq('id', post.id)
          .eq('status', 'attempting')
        if (publishUpdateError) throw publishUpdateError

        await trace(post.organization_id, attemptTrace, 'ok', 'Provider confirmed published post ' + result.id)
        published++
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('Failed to publish post', post.id, message)
        await db
          .from('content_calendar')
          .update({ status: 'failed', failure_reason: message.slice(0, 500) })
          .eq('id', post.id)
        await trace(post.organization_id, attemptTrace, 'failed', message)
        failed++
      }
    }

    return new Response(JSON.stringify({ processed: published, failed }), {
      headers: { 'Content-Type': 'application/json' },
      status: failed > 0 ? 207 : 200,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Publishing worker failed:', message)
    return new Response(JSON.stringify({ error: message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
