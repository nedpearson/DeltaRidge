import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Fetching properties...");
  const { data: properties, error: pErr } = await supabase.from('properties').select('id, address_line1').limit(20);
  if (pErr) {
    console.error("Error fetching properties", pErr);
    return;
  }

  const owners = ["Michael Scott", "Jim Halpert", "Pam Beesly", "Dwight Schrute", "Stanley Hudson", "Phyllis Vance", "Angela Martin", "Kevin Malone", "Oscar Martinez", "Creed Bratton"];
  const carriers = ["State Farm", "Allstate", "Geico", "Progressive", "Farmers", "Liberty Mutual", "Nationwide"];
  
  for (let i = 0; i < properties.length; i++) {
    const p = properties[i];
    
    // Randomize some realistic data
    const age = Math.floor(Math.random() * 25) + 5; // 5 to 30 years
    const permitYear = new Date().getFullYear() - age;
    const hasPermit = Math.random() > 0.3;
    
    let updatePayload = {
      owner_name: owners[i % owners.length],
      owner_source: "East Baton Rouge Assessor",
      roof_age_years: hasPermit ? age : null,
      roof_age_source: hasPermit ? `Permit from ${permitYear}` : null,
      last_roof_permit_date: hasPermit ? `${permitYear}-06-15` : null,
      last_roof_permit_desc: hasPermit ? "Tear off and replace architectural shingles" : null,
      last_roof_permit_source: hasPermit ? "City Permit DB" : null,
      opportunity_summary: "Based on background intelligence gathering, this property has a high probability of roof damage matching recent weather events. The optimal approach is educational, focusing on Act of God provisions and neighborhood precedence."
    };
    
    console.log(`Updating property ${p.address_line1}...`);
    await supabase.from('properties').update(updatePayload).eq('id', p.id);
    
    // Verify lead exists, update contact info on customer
    const { data: lead } = await supabase.from('leads').select('customer_id, id').eq('property_id', p.id).maybeSingle();
    if (lead && lead.customer_id) {
      await supabase.from('customers').update({
        primary_phone: "(225) 555-01" + Math.floor(Math.random() * 100).toString().padStart(2, '0'),
        email: owners[i % owners.length].split(' ')[0].toLowerCase() + "@example.com"
      }).eq('id', lead.customer_id);
    }
    
    // Ensure storm exposure exists
    if (Math.random() > 0.2) {
      await supabase.from('property_opportunity_scores').upsert({
        property_id: p.id,
        max_wind: Math.floor(Math.random() * 40) + 60, // 60-100
        max_hail: (Math.floor(Math.random() * 15) + 10) / 10, // 1.0 - 2.5
        opportunity_score: Math.floor(Math.random() * 30) + 70 // 70-100
      });
    } else {
      // Force some to have NO storm so we can test the filter!
      await supabase.from('property_opportunity_scores').upsert({
        property_id: p.id,
        max_wind: 0,
        max_hail: 0,
        opportunity_score: 50
      });
    }
  }
  
  console.log("Enrichment complete.");
}

run();
