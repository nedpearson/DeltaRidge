const { createClient } = require("@supabase/supabase-js");

async function test() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  
  const { data: auth, error } = await supabase.auth.signInWithPassword({ 
    email: "ned.pearson@gmail.com", 
    password: "DeltaRidge123!" 
  });
  if (error) {
    console.error("Login Error:", error);
    return;
  }
  console.log("Logged in:", auth.user.id);
  
  // Get org
  const { data: orgs } = await supabase.from('organization_members').select('organization_id').limit(1);
  const orgId = orgs[0].organization_id;
  console.log("Org ID:", orgId);
  
  // Call edge function
  const { data, error: fnError } = await supabase.functions.invoke("integration-status", {
    body: { organizationId: orgId }
  });
  console.log("Fn response data:", JSON.stringify(data));
  console.log("Fn response error:", fnError);
}
test();
