import { z } from 'zod'

/**
 * Environment configuration, validated once at startup.
 *
 * Deliberate design choice: this schema treats almost every integration
 * credential as OPTIONAL. The app must boot and be useful in the field with
 * nothing but a Supabase URL and key. A missing EagleView entitlement degrades imagery;
 * a missing AI key degrades photo assist; a missing CompanyCam token degrades
 * the handoff to PDF. None of them may prevent a rep from documenting a roof.
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a full URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(20, 'VITE_SUPABASE_ANON_KEY looks malformed'),

  VITE_STORM_PROVIDER: z.enum(['noaa', 'hailtrace', 'none']).default('noaa'),
  /**
   * Radar-estimated hail, alongside ground reports rather than instead of them.
   * 'swdi' reads NOAA NCEI's NEXRAD Level-III hail detections; no key, no
   * server. 'off' returns the product to ground reports only.
   */
  VITE_RADAR_HAIL: z.enum(['swdi', 'off']).default('swdi'),
  VITE_HANDOFF_MODE: z.enum(['companycam', 'pdf_email', 'disabled']).default('pdf_email'),
  VITE_AI_PROVIDER: z.enum(['anthropic', 'openai', 'none']).default('none'),
  VITE_SENTRY_DSN: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

/**
 * A guard against the classic and expensive mistake: a service-role key
 * accidentally prefixed with VITE_ and shipped to every phone in the field.
 * Fail loudly at startup rather than leak.
 */
function assertNoServerSecrets(raw: Record<string, unknown>): void {
  const forbidden = [
    'VITE_SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SERVICE_ROLE_KEY',
    'VITE_HAILTRACE_API_KEY',
    'VITE_COMPANYCAM_API_TOKEN',
    'VITE_AI_API_KEY',
    'VITE_ROOFR_WEBHOOK_SECRET',
    'VITE_EAGLEVIEW_CLIENT_ID',
    'VITE_EAGLEVIEW_CLIENT_SECRET',
  ]
  const leaked = forbidden.filter((key) => typeof raw[key] === 'string' && raw[key] !== '')
  if (leaked.length > 0) {
    throw new Error(
      `Refusing to start: server-only secrets are exposed to the browser bundle: ${leaked.join(', ')}. ` +
        `Remove the VITE_ prefix and move them to Supabase Edge Function secrets.`,
    )
  }
}

let cached: Env | null = null

export function loadEnv(source: Record<string, unknown> = import.meta.env): Env {
  if (cached) return cached
  assertNoServerSecrets(source)
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${detail}\n\nSee .env.example.`)
  }
  cached = parsed.data
  return cached
}

/** Test seam: clears the memoised config. */
export function resetEnvCache(): void {
  cached = null
}

export { envSchema, assertNoServerSecrets }
