import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"
import { requireOrgMember } from "../_shared/auth.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface AutoBookRequest {
  conversationId: string
  selectedStartTime: string
  selectedEndTime?: string
  propertyAddress?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
      },
    })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Server is not configured.' }), { status: 503 })
  }

  try {
    const { conversationId, selectedStartTime, selectedEndTime, propertyAddress } =
      await req.json() as AutoBookRequest

    if (!conversationId || !selectedStartTime) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 })
    }

    const startDate = new Date(selectedStartTime)
    if (!Number.isFinite(startDate.getTime())) {
      return new Response(JSON.stringify({ error: 'Invalid appointment start time' }), { status: 400 })
    }
    const endDate = selectedEndTime
      ? new Date(selectedEndTime)
      : new Date(startDate.getTime() + 60 * 60 * 1000)

    if (!Number.isFinite(endDate.getTime()) || endDate <= startDate) {
      return new Response(JSON.stringify({ error: 'Appointment end must be after start' }), { status: 400 })
    }

    const { data: conversation, error: convError } = await db
      .from('social_conversations')
      .select(`
        organization_id,
        social_profile_id,
        lead_id,
        profile:social_profiles(customer_id),
        lead:leads(property_id)
      `)
      .eq('id', conversationId)
      .single()

    if (convError || !conversation) throw convError || new Error('Conversation not found')
    await requireOrgMember(req, conversation.organization_id)

    const { data: config, error: configError } = await db
      .from('social_autonomy_config')
      .select('auto_book_appointments, master_kill_switch')
      .eq('organization_id', conversation.organization_id)
      .single()

    if (configError) throw configError
    if (config?.master_kill_switch) {
      return new Response(JSON.stringify({ error: 'Automation is disabled by the master kill switch' }), { status: 403 })
    }
    if (!config?.auto_book_appointments) {
      return new Response(JSON.stringify({ error: 'Auto-booking is disabled by management' }), { status: 403 })
    }

    let propertyId = conversation.lead?.property_id as string | undefined

    if (!propertyId && propertyAddress?.trim()) {
      const cleanAddress = propertyAddress.trim()
      const { data: property, error: resolveError } = await db.rpc('resolve_property_from_address', {
        org_id: conversation.organization_id,
        address_query: cleanAddress,
      })
      if (resolveError) throw resolveError

      propertyId = property?.[0]?.id as string | undefined
      if (!propertyId) {
        const { data: created, error } = await db
          .from('properties')
          .insert({
            organization_id: conversation.organization_id,
            address_line1: cleanAddress,
            provenance: 'social-auto-book',
          })
          .select('id')
          .single()
        if (error) throw error
        propertyId = created.id as string
      }
    }

    if (!propertyId) throw new Error('Failed to resolve property. A property address is required.')

    let leadId = conversation.lead_id as string | null
    if (!leadId) {
      const { data: existingLead, error: existingLeadError } = await db
        .from('leads')
        .select('id')
        .eq('organization_id', conversation.organization_id)
        .eq('property_id', propertyId)
        .is('deleted_at', null)
        .not('status', 'in', '(sold,lost,not_interested)')
        .limit(1)
        .maybeSingle()
      if (existingLeadError) throw existingLeadError

      leadId = existingLead?.id as string | undefined ?? null
      if (!leadId) {
        const { data: newLead, error } = await db
          .from('leads')
          .insert({
            organization_id: conversation.organization_id,
            property_id: propertyId,
            customer_id: conversation.profile?.customer_id ?? null,
            status: 'appointment',
          })
          .select('id')
          .single()
        if (error) throw error
        leadId = newLead.id as string
      }

      const { error: conversationError } = await db
        .from('social_conversations')
        .update({ lead_id: leadId })
        .eq('id', conversationId)
      if (conversationError) throw conversationError
    }

    const { data: booking, error: bookingError } = await db.rpc('book_available_rep_appointment', {
      p_org: conversation.organization_id,
      p_lead: leadId,
      p_property: propertyId,
      p_customer: conversation.profile?.customer_id ?? null,
      p_start: startDate.toISOString(),
      p_end: endDate.toISOString(),
      p_notes: `Auto-booked from social conversation ${conversationId}`,
    })

    if (bookingError) throw bookingError
    const row = booking?.[0]
    if (!row?.appointment_id || !row?.assigned_rep_id) throw new Error('Booking did not return an appointment')

    return new Response(JSON.stringify({
      success: true,
      appointmentId: row.appointment_id,
      assignedRepId: row.assigned_rep_id,
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Auto-booking failed:', message)
    return new Response(JSON.stringify({ error: message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 409,
    })
  }
})
