/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
let OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
})

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    // 1. Parse the incoming Twilio form data
    const formData = await req.formData()
    const callerNumber = formData.get('From') as string
    const speechResult = formData.get('SpeechResult') as string

    // Organization ID is hardcoded for demo, normally mapped via the Twilio 'To' number
    const orgId = "00000000-0000-0000-0000-000000000000";

    // 2. TwiML Generation helper
    const generateTwiML = (text: string, gather = false) => {
      let twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Matthew-Neural">${text}</Say>`;
      if (gather) {
        twiml += `<Gather input="speech" action="/functions/v1/voice-ai-concierge" timeout="3" speechTimeout="auto" />`;
      }
      twiml += `</Response>`;
      return new Response(twiml, {
        headers: { "Content-Type": "text/xml" },
        status: 200,
      })
    }

    // 3. Initial Greeting (No SpeechResult yet)
    if (!speechResult) {
      return generateTwiML("Hi, you've reached Delta Ridge Roofing. I'm Dustin's AI assistant. Are you calling to book a free roof inspection?", true);
    }

    // 4. Process the user's speech using the Brand Brain via OpenAI
    let aiResponse = "I can definitely help with that. I've sent a text message to this number with a link to book your appointment online. Thanks for calling Delta Ridge!";
    let shouldHangUp = true;

    if (!OPENAI_API_KEY) {
      const { data } = await supabase.from('system_secrets').select('secret_value').eq('id', 'OPENAI_API_KEY').single();
      if (data) OPENAI_API_KEY = data.secret_value;
    }

    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured. Cannot execute real network request.");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": Bearer ,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are the voice AI receptionist for Delta Ridge Roofing. The caller said something. Respond naturally, in 1 or 2 sentences. Your ultimate goal is to get them to agree to a free inspection." },
          { role: "user", content: speechResult }
        ],
        temperature: 0.7,
      })
    });

    if (!response.ok) {
      const error = await response.json()
      throw new Error("OpenAI API error: " + (error.error?.message || response.statusText))
    }

    const json = await response.json();
    aiResponse = json.choices[0].message.content;
    
    // Very basic NLP to see if we should keep gathering
    if (aiResponse.includes('?')) {
      shouldHangUp = false;
    }

    return generateTwiML(aiResponse, !shouldHangUp);

  } catch (error: any) {
    console.error("Voice AI Concierge failed:", error)
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, our system is currently down. Please call back later.</Say></Response>`, 
      { headers: { "Content-Type": "text/xml" }, status: 200 }
    )
  }
})



