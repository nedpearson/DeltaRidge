import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// NOAA MRMS Base URL
const MRMS_BASE = 'https://mrms.ncep.noaa.gov/data/2D/MESH_Max_1440min/'

serve(async (req) => {
  // Authorization
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== Bearer \) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response('Missing Supabase environment variables', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Check latest available MRMS file
    // Note: In a full production implementation, we would download the .grib2.gz file
    // and pipe it to a specialized decoding service (e.g., wgrib2 via a Python worker)
    // because Deno cannot natively parse GRIB2 weather grids.
    
    // For now, we record the health/ingest attempt in the DB to satisfy Health Monitoring
    await supabase.from('integration_health_logs').insert({
      integration_name: 'mrms_mesh',
      status: 'pending',
      message: 'Initiating MRMS MESH data sync'
    })

    const res = await fetch(MRMS_BASE)
    if (!res.ok) throw new Error('Failed to reach NOAA MRMS endpoint')
    
    const html = await res.text()
    
    // Find latest .grib2.gz
    const matches = [...html.matchAll(/href="(MRMS_MESH_Max_1440min.*?\.grib2\.gz)"/g)]
    if (matches.length === 0) {
      throw new Error('No MRMS files found on NOAA index')
    }
    
    const latestFile = matches[matches.length - 1][1]
    const fileUrl = MRMS_BASE + latestFile

    // Record success
    await supabase.from('integration_health_logs').insert({
      integration_name: 'mrms_mesh',
      status: 'success',
      message: Successfully located latest grid: \. Awaiting decoding service.
    })

    return new Response(JSON.stringify({ 
      success: true, 
      latest_file: latestFile,
      download_url: fileUrl,
      status: "Awaiting GRIB2 decoding microservice"
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (error) {
    // Record failure for Health Monitoring
    await supabase.from('integration_health_logs').insert({
      integration_name: 'mrms_mesh',
      status: 'failed',
      message: error.message
    })

    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
