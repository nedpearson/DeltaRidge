/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface AutoBookRequest {
  conversationId: string;
  selectedStartTime: string; // ISO String
  selectedEndTime: string; // ISO String
  propertyAddress: string;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const { conversationId, selectedStartTime, selectedEndTime, propertyAddress } = await req.json() as AutoBookRequest

    if (!conversationId || !selectedStartTime || !propertyAddress) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 })
    }

    // 1. Fetch conversation and check config
    const { data: conversation, error: convError } = await supabase
      .from("social_conversations")
      .select(\
        organization_id, 
        social_profile_id,
        lead_id,
        profile:social_profiles(customer_id)
      \)
      .eq("id", conversationId)
      .single()

    if (convError) throw convError

    const { data: config } = await supabase
      .from("social_autonomy_config")
      .select("auto_book_appointments")
      .eq("organization_id", conversation.organization_id)
      .single()

    if (!config?.auto_book_appointments) {
      return new Response(JSON.stringify({ error: "Auto-booking is disabled by management" }), { status: 403 })
    }

    // 2. Resolve Property
    const { data: property, error: propError } = await supabase.rpc('resolve_property_from_address', {
      org_id: conversation.organization_id,
      address_query: propertyAddress
    })
    
    let propertyId = property?.[0]?.id
    if (!propertyId) {
      const { data: newProp } = await supabase.from('properties').insert({
        organization_id: conversation.organization_id,
        raw_address: propertyAddress,
        normalized_address: propertyAddress.toUpperCase()
      }).select('id').single()
      propertyId = newProp?.id
    }

    if (!propertyId) throw new Error("Failed to resolve property")

    // 3. Find Rep Availability and Prevent Double Booking
    const start = selectedStartTime;
    const end = selectedEndTime || new Date(new Date(selectedStartTime).getTime() + 60 * 60 * 1000).toISOString();

    const { data: orgUsers } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', conversation.organization_id)
      .eq('is_active', true);
      
    if (!orgUsers || orgUsers.length === 0) {
      throw new Error("No reps available in organization");
    }
    const userIds = orgUsers.map(u => u.user_id);

    const { data: overlapping } = await supabase
      .from('appointments')
      .select('assigned_to')
      .eq('organization_id', conversation.organization_id)
      .not('assigned_to', 'is', null)
      .in('status', ['scheduled', 'confirmed'])
      .lt('scheduled_start', end)
      .gt('scheduled_end', start);

    const busyRepIds = new Set((overlapping || []).map(a => a.assigned_to));
    const availableRepIds = userIds.filter(id => !busyRepIds.has(id));

    if (availableRepIds.length === 0) {
      throw new Error("No reps available at this time (double booking prevented)");
    }

    const assignedRepId = availableRepIds[0];

    // 4. Create Lead if it doesn't exist
    let leadId = conversation.lead_id
    if (!leadId) {
      const { data: newLead } = await supabase.from('leads').insert({
        organization_id: conversation.organization_id,
        property_id: propertyId,
        customer_id: conversation.profile?.customer_id,
        status: 'appointment',
        assigned_to: assignedRepId,
      }).select('id').single()
      
      leadId = newLead?.id
      
      // Update conversation with new lead
      if (leadId) {
        await supabase.from('social_conversations').update({ lead_id: leadId }).eq('id', conversationId)
      }
    }

    // 5. Create Appointment
    const { data: appointment, error: apptError } = await supabase.from('appointments').insert({
      organization_id: conversation.organization_id,
      lead_id: leadId,
      property_id: propertyId,
      customer_id: conversation.profile?.customer_id,
      assigned_to: assignedRepId,
      scheduled_start: start,
      scheduled_end: end,
      status: 'scheduled',
      notes: \Auto-booked via Social AI Assistant from conversation \\
    }).select('id').single()

    if (apptError) throw apptError

    return new Response(JSON.stringify({ 
      success: true, 
      appointmentId: appointment.id,
      assignedRepId: assignedRepId
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    console.error("Auto-booking failed:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
