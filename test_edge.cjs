const { createClient } = require("@supabase/supabase-js");

async function test() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  
  // Create a random user
  const email = `test-${Date.now()}@example.com`;
  const password = `Password123!`;
  
  const { data: auth, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    console.error("SignUp Error:", error);
    return;
  }
  console.log("Signed up user:", auth.user.id);
  
  // Call edge function without an org (should return 400 or 401, but not 500)
  const { data, error: fnError } = await supabase.functions.invoke("integration-status", {
    body: { organizationId: "00000000-0000-0000-0000-000000000000" }
  });
  console.log("Fn response:", { data, error: fnError });
}
test();
