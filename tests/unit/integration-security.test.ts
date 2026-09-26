import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('production integration security', () => {
  it('never embeds EagleView credentials in the Edge Function source', () => {
    const source = readFileSync('supabase/functions/eagleview-imagery/index.ts', 'utf8')
    expect(source).toContain("Deno.env.get('EAGLEVIEW_CLIENT_ID')")
    expect(source).toContain("Deno.env.get('EAGLEVIEW_CLIENT_SECRET')")
    expect(source).not.toMatch(/CLIENT_ID\s*=\s*Deno\.env\.get\([^)]*\)\s*\|\|\s*['"][^'"]+['"]/)
    expect(source).not.toMatch(/CLIENT_SECRET\s*=\s*Deno\.env\.get\([^)]*\)\s*\|\|\s*['"][^'"]+['"]/)
  })

  it('does not permit EagleView requests without a signed-in user and active org', () => {
    const source = readFileSync('supabase/functions/eagleview-imagery/index.ts', 'utf8')
    expect(source).toContain("return json({ error: 'authentication required' }, 401)")
    expect(source).toContain("return json({ error: 'active organization membership required' }, 403)")
    expect(source).not.toContain("from('organizations').select('id').limit(1)")
  })

  it('keeps JWT verification enabled for protected outbound integrations', () => {
    const config = readFileSync('supabase/config.toml', 'utf8')
    expect(config).toMatch(/\[functions\.eagleview-imagery\][\s\S]*?verify_jwt\s*=\s*true/)
    expect(config).toMatch(/\[functions\.roofr-push\][\s\S]*?verify_jwt\s*=\s*true/)
  })
})
