const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function test() {
  const email = `test-${Date.now()}@test.com`;
  const { data: auth } = await supabase.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true
  });
  
  const { data: orgs } = await supabase.from("organization_members").select("organization_id").limit(1);
  const orgId = orgs[0].organization_id;
  
  const { error } = await supabase.from("organization_members").insert({
    user_id: auth.user.id,
    organization_id: orgId,
    role: "owner",
    is_active: true
  });
  console.log("Insert error:", error);
}
test();
