import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

export async function requireAuth(req: Request) {
  const authorization = req.headers.get('authorization')
  if (!authorization) {
    throw new Error("Missing authorization header")
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || ""

  const asCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: auth, error } = await asCaller.auth.getUser()
  if (error) {
    throw new Error(`Auth Error: ${error.message}`)
  }
  if (!auth?.user) {
    throw new Error("Invalid or expired authorization")
  }

  return { userId: auth.user.id, asCaller }
}

export async function requireOrgMember(req: Request, organizationId: string) {
  const { userId, asCaller } = await requireAuth(req)

  const { data: membership } = await asCaller
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership) {
    throw new Error("Unauthorized for this organization")
  }

  return { userId, role: membership.role, asCaller }
}
