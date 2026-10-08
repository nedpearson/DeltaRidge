import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts"
import { decode } from "https://deno.land/std@0.177.0/encoding/base64.ts"

serve(async (req) => {
  const { query } = await req.json()
  const sql = new TextDecoder().decode(decode(query))
  
  const pool = new Pool(Deno.env.get("SUPABASE_DB_URL"), 1, true)
  const connection = await pool.connect()
  try {
    const result = await connection.queryObject(sql)
    return new Response(JSON.stringify(result.rows), { headers: { "Content-Type": "application/json" } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } })
  } finally {
    connection.release()
  }
})
