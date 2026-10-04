import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { processMessage } from './orchestrator.ts';

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseClient = createClient(supabaseUrl, supabaseKey);

  let body = '';
  let fromNumber = '';
  let toNumber = '';

  const contentType = req.headers.get('content-type') || '';
  
  if (contentType.includes('application/json')) {
      const json = await req.json();
      body = json.Body || json.body || '';
      fromNumber = json.From || json.from || '';
      toNumber = json.To || json.to || '';
  } else {
      const formData = await req.formData();
      body = formData.get('Body')?.toString() || '';
      fromNumber = formData.get('From')?.toString() || '';
      toNumber = formData.get('To')?.toString() || '';
  }

  if (!fromNumber) {
    return new Response('No From number provided', { status: 400 });
  }

  // Normalize phone digits
  const phoneDigits = fromNumber.replace(/\D/g, '');

  // 1. Lookup the phone number in leads via customers
  const { data: customerData } = await supabaseClient
    .from('customers')
    .select('id, organization_id, leads(id, status, property_id)')
    .eq('phone_digits', phoneDigits)
    .limit(1)
    .single();

  let orgId = customerData?.organization_id;
  let leadId = customerData?.leads?.[0]?.id;
  let propertyId = customerData?.leads?.[0]?.property_id;

  if (!orgId) {
    // Attempt fallback to a default organization if not found, 
    // or just exit since we can't tie it to an org.
    const { data: org } = await supabaseClient.from('organizations').select('id').limit(1).single();
    orgId = org?.id;
  }

  if (!orgId) {
    return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
  }

  // 2. Check contact_suppressions. If STOP, write to suppressions and abort.
  if (body.trim().toUpperCase() === 'STOP') {
    await supabaseClient.from('contact_suppressions').insert({
      organization_id: orgId,
      contact_kind: 'phone',
      contact_value: phoneDigits
    });
    return new Response('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
  }

  // 3. Write incoming message to messages table (or activities)
  if (leadId) {
    // Write to messages table as requested
    await supabaseClient.from('messages').insert({
      organization_id: orgId,
      lead_id: leadId,
      property_id: propertyId,
      customer_id: customerData?.id,
      body: body,
      direction: 'inbound',
      channel: 'sms',
      from_number: fromNumber,
      to_number: toNumber
    });
  }

  // 4. Process with AI Orchestrator Agent
  if (orgId && propertyId && leadId) {
    // Call the orchestrator in the background without blocking the webhook response
    processMessage(supabaseClient, orgId, leadId, propertyId, body).catch(console.error);
  }

  return new Response('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
});
