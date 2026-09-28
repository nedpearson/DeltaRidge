/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import * as postgres from 'https://deno.land/x/postgres@v0.17.0/mod.ts'

serve(async (req) => {
  if (req.method !== 'POST') return new Response("Method not allowed", { status: 405 });
  try {
    const { sql } = await req.json();
    if (!sql) return new Response("No SQL provided", { status: 400 });

    const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!databaseUrl) return new Response("SUPABASE_DB_URL missing", { status: 500 });
    const pool = new postgres.Pool(databaseUrl, 3, true);
    const connection = await pool.connect();
    
    try {
      await connection.queryObject(sql);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally {
      connection.release();
    }
  } catch (error: any) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
})

