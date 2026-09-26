import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function filesUnder(root: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else out.push(path)
  }
  return out
}

describe('mapping provider architecture', () => {
  it('does not ship a Mapbox runtime integration', () => {
    const runtimeFiles = [
      'package.json',
      'package-lock.json',
      '.env.example',
      'vite.config.ts',
      ...filesUnder('src').filter((path) => /\.(ts|tsx|js|css)$/.test(path)),
    ]

    const forbidden = [
      /mapbox-gl/i,
      /api\.mapbox\.com/i,
      /VITE_MAPBOX/i,
      /MAPBOX_SECRET_TOKEN/i,
      /@mapbox\//i,
    ]

    const violations: string[] = []
    for (const path of runtimeFiles) {
      const content = readFileSync(path, 'utf8')
      if (forbidden.some((pattern) => pattern.test(content))) violations.push(path)
    }

    expect(violations).toEqual([])
  })

  it('declares EagleView map and imagery functions', () => {
    const config = readFileSync('supabase/config.toml', 'utf8')
    expect(config).toContain('[functions.eagleview-imagery]')
    expect(config).toContain('[functions.eagleview-map-tile]')
  })
})
