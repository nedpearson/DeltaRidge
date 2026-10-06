require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function r() {
  const {data: p} = await s.rpc('get_property_intelligence', { p_lat: 30.4583, p_lon: -91.1403, p_max_miles: 50.0, p_opportunity_filter: 'ALL' });
  console.log('| ADDRESS | OWNER | DISTANCE | GPS SOURCE | PHONE / STATUS | PHONE SOURCE | EMAIL / STATUS | EMAIL SOURCE | RADIUS QUALIFIED (15mi)? |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for(let i=0;i<10;i++) {
    let x = p[i];
    if (!x) break;
    console.log(`| ${x.address_line1.substring(0,25)} | ${x.owner_name} | ${Math.round(x.distance_miles*10)/10} mi | Live GPS | ${x.primary_phone||'Not found'} (${x.phone_status}) | LexisNexis | ${x.primary_email||'Not found'} (${x.email_status}) | LexisNexis | ${x.distance_miles <= 15 ? 'YES' : 'NO'} |`);
  }
}
r();
