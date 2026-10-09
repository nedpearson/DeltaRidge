const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function test() {
  const email = `test-${Date.now()}@test.com`;
  const { data: auth, error } = await supabase.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true
  });
  if (error) { console.error("Create user error", error); return; }
  console.log("Created user", auth.user.id);
  
  const { data: orgs } = await supabase.from("organization_members").select("organization_id").limit(1);
  const orgId = orgs[0].organization_id;
  
  await supabase.from("organization_members").insert({
    user_id: auth.user.id,
    organization_id: orgId,
    role: "owner",
    is_active: true
  });
  console.log("Added to org", orgId);
  
  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: signIn, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password: "Password123!"
  });
  if (signInError) { console.error("Sign in error", signInError); return; }
  console.log("Signed in. Invoking function...");
  
  const { data: fnData, error: fnError } = await anonClient.functions.invoke("integration-status", {
    body: { organizationId: orgId }
  });
  console.log("Fn data:", fnData);
  if (fnError) console.log("Fn error:", fnError);
}

test();
