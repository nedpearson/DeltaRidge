import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// In a real production system, this would be an email provider like SendGrid or Resend
// import { Resend } from 'https://esm.sh/resend'

serve(async (req) => {
  // Verify authorization (crons usually send a secret header)
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response('Missing environment variables', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Fetch all active organizations
    const { data: orgs, error: orgError } = await supabase.from('organizations').select('id, name')
    if (orgError) throw orgError

    for (const org of orgs) {
      // 2. Fetch managers for this org
      const { data: managers } = await supabase
        .from('organization_roles')
        .select('user_id')
        .eq('organization_id', org.id)
        .in('role', ['admin', 'manager'])

      if (!managers || managers.length === 0) continue

      // 3. Aggregate yesterday's metrics
      // (This is a simplified aggregation. In reality, it would use the `manager_daily_brief` view)
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]

      const { data: metrics } = await supabase
        .rpc('get_manager_daily_brief_metrics', { org_id: org.id, target_date: yesterdayStr })

      // 4. Send email (simulated for now, would use Resend/SendGrid)
      const emailBody = `
        Good morning! Here is your daily brief for ${org.name}:
        Yesterday: ${metrics?.doors_assigned || 0} doors assigned, ${metrics?.doors_knocked || 0} knocked.
        Conversations: ${metrics?.conversations || 0}
        Contract Value: $${metrics?.contract_value || 0}
        
        Needs attention: ${metrics?.overdue_followups || 0} overdue follow-ups.
      `
      console.log(`[Email Sent to Org ${org.id}]:\n${emailBody}`)
    }

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
