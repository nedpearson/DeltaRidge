import { applyGuardrails } from './guardrails.ts';

export async function processMessage(
  supabase: unknown,
  orgId: string,
  leadId: string,
  propertyId: string,
  incomingMessage: string
) {
  // Fetch property_opportunity_scores
  const { data: scoreData } = await supabase
    .from('property_opportunity_scores')
    .select('*')
    .eq('property_id', propertyId)
    .single();

  // Fetch recent storm events for context
  // Assume a table 'storm_events' and a junction table or spatial query. 
  // For simplicity, we just fetch a recent storm event.
  const { data: stormEvents } = await supabase
    .from('storm_events')
    .select('event_type, start_time')
    .order('start_time', { ascending: false })
    .limit(1);

  const context = `
    Property Opportunity Score: ${JSON.stringify(scoreData)}
    Recent Storm Events: ${JSON.stringify(stormEvents)}
    User Message: ${incomingMessage}
  `;

  // Simulate LLM response or call OpenAI/Anthropic API
  const prompt = `
    You are an AI Orchestrator Agent (Lead Qualification & SMS).
    Evaluate the user's message and context.
    1. Classify intent into one of: INTERESTED, NOT_INTERESTED, DO_NOT_CONTACT
    2. Generate a reply if appropriate.
    CRITICAL RULE: NEVER claim physical roof damage. Use "Property was exposed to conditions..." instead.
    
    Context:
    ${context}
  `;

  const openAiKey = (typeof Deno !== 'undefined' ? Deno.env.get('OPENAI_API_KEY') : process.env.OPENAI_API_KEY);
  let llmReply = "Property was exposed to conditions recently. Would you like a free evaluation?";
  let intent = "INTERESTED";

  if (openAiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'system', content: prompt }]
        })
      });
      const data = await response.json();
      const content = data.choices[0].message.content;
      
      // Simple intent parsing from LLM output
      if (content.includes('NOT_INTERESTED')) intent = 'NOT_INTERESTED';
      else if (content.includes('DO_NOT_CONTACT')) intent = 'DO_NOT_CONTACT';
      
      // Attempt to extract a quoted reply or just use the content
      llmReply = content.split('REPLY:')[1]?.trim() || content;
    } catch (e) {
      console.error("LLM error", e);
    }
  }

  // Update lead status based on intent
  if (intent === 'DO_NOT_CONTACT') {
    await supabase.from('leads').update({ status: 'dead' }).eq('id', leadId);
    
    // Also suppress
    const { data: leadData } = await supabase.from('leads')
        .select('customer_id')
        .eq('id', leadId)
        .single();
    if (leadData?.customer_id) {
       const { data: customer } = await supabase.from('customers').select('phone_digits').eq('id', leadData.customer_id).single();
       if (customer?.phone_digits) {
           await supabase.from('contact_suppressions').insert({
               organization_id: orgId,
               contact_kind: 'phone',
               contact_value: customer.phone_digits
           });
       }
    }
  } else if (intent === 'NOT_INTERESTED') {
    await supabase.from('leads').update({ status: 'nurture' }).eq('id', leadId);
  } else {
    // INTERESTED
    await supabase.from('leads').update({ status: 'qualifying' }).eq('id', leadId);
  }

  // Check guardrails
  const guardrailCheck = applyGuardrails(llmReply);
  if (!guardrailCheck.isValid) {
    console.error("Guardrail blocked reply:", guardrailCheck.flaggedReason);
    return; // Block sending
  }

  // If autonomous mode is approved, send reply
  // For demonstration, we just write it to messages table as outbound
  await supabase.from('messages').insert({
    organization_id: orgId,
    lead_id: leadId,
    body: llmReply,
    direction: 'outbound',
    channel: 'sms'
  });
}
