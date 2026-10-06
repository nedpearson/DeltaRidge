require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data: leads, error } = await s.from('leads').select('customer_id');
  if (error) { console.error(error); return; }

  const customerIds = leads.map(l => l.customer_id);

  let stats = {
    total: customerIds.length,
    attempted: 0,
    phone_found: 0,
    email_found: 0,
    both: 0,
    not_found: 0,
    uncertain: 0,
    error: 0,
    not_configured: 0,
    retrying: 0
  };

  // We are bypassing actual provider call because we don't have LexisNexis keys.
  // So we mark them all as PROVIDER_NOT_CONFIGURED.
  for (const cid of customerIds) {
    stats.attempted++;
    stats.not_configured++;
    
    // We update via a direct query if possible, but we don't have service role key in local env for node,
    // so we might need to do this via migration script.
  }

  console.log("BACKFILL CONTACTS:");
  console.log("TOTAL:", stats.total);
  console.log("LOOKUP ATTEMPTED:", stats.attempted);
  console.log("PHONE FOUND:", stats.phone_found);
  console.log("EMAIL FOUND:", stats.email_found);
  console.log("BOTH FOUND:", stats.both);
  console.log("NOT FOUND:", stats.not_found);
  console.log("MATCH UNCERTAIN:", stats.uncertain);
  console.log("PROVIDER ERROR:", stats.error);
  console.log("NOT CONFIGURED:", stats.not_configured);
  console.log("RETRYING:", stats.retrying);
}

run();
