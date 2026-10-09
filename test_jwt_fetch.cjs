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
  
  await supabase.from("organization_members").insert({
    user_id: auth.user.id,
    organization_id: orgId,
    role: "admin",
    is_active: true
  });
  
  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: signIn } = await anonClient.auth.signInWithPassword({
    email,
    password: "Password123!"
  });
  
  const res = await fetch("https://udrxvpkihkbrudvwggpr.supabase.co/functions/v1/integration-status", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + signIn.session.access_token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ organizationId: orgId })
  });
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
}

test();
