import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function test() {
  const { data: users } = await supabase.auth.admin.listUsers();
  const ned = users.users.find(u => u.email === "ned.pearson@gmail.com");
  if (!ned) { console.log("Ned not found"); return; }
  console.log("Found Ned:", ned.id);

  // Generate link doesn't give us the JWT easily unless we follow the link.
  // Wait, we can't easily get a user JWT. 
  // Let's just create a new test user, then insert them into organization_members!
  const email = `test-${Date.now()}@test.com`;
  const { data: auth, error } = await supabase.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true
  });
  if (error) { console.error("Create user error", error); return; }
  console.log("Created user", auth.user.id);
  
  // Get org
  const { data: orgs } = await supabase.from('organization_members').select('organization_id').limit(1);
  const orgId = orgs[0].organization_id;
  
  // Insert membership
  await supabase.from('organization_members').insert({
    user_id: auth.user.id,
    organization_id: orgId,
    role: "owner",
    is_active: true
  });
  console.log("Added to org", orgId);
  
  // Now sign in to get JWT
  const anonClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
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
  console.log("Fn error:", fnError);
}

test();
