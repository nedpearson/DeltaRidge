import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
export async function recordIntegrationRun(db: SupabaseClient, organizationId: string, integration: 'contacts'|'push'|'mrms', status: 'success'|'failed'|'not_configured', detail: string) {
 // Diagnostics must never turn a successful integration request into a failure.
 try { await db.from('integration_runs').insert({ organization_id: organizationId, integration, status, detail: detail.slice(0,200) }) } catch { /* primary request owns its result */ }
}
