import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures = []

const migrationsDir = path.join(root, 'supabase', 'migrations')
const migrationNames = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

// Individual migration files are the deployable source of truth. apply_all.sql
// is retained only as a convenience snapshot because the production project has
// historical migration-state differences; treating that large concatenated
// file as authoritative previously made CI green while a clean replay could
// still fail on duplicate DDL.
//
// What CI can prove here is that migration filenames are deterministic and
// unique. Deployment certification separately proves the objects exist in the
// live database.
const migrationPrefix = /^\d{8}(?:\d{6})?_[a-z0-9_]+\.sql$/
const seenMigrationNames = new Set()
for (const name of migrationNames) {
  if (!migrationPrefix.test(name)) {
    failures.push(`Migration filename is not deterministic: ${name}`)
  }
  if (seenMigrationNames.has(name)) {
    failures.push(`Duplicate migration filename: ${name}`)
  }
  seenMigrationNames.add(name)
}

const functionsDir = path.join(root, 'supabase', 'functions')
const functionNames = fs
  .readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(functionsDir, name, 'index.ts')))
  .sort()

for (const deployPath of ['scripts/deploy-functions.sh', 'scripts/deploy-functions.ps1']) {
  const deploy = fs.readFileSync(path.join(root, deployPath), 'utf8')
  for (const name of functionNames) {
    if (!deploy.includes(name)) {
      failures.push(`${deployPath} does not deploy Edge Function: ${name}`)
    }
  }
}

const sourceFiles = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) sourceFiles.push(full)
  }
}
walk(path.join(root, 'supabase', 'functions'))

const dangerousSecretFallbacks = [
  /EAGLEVIEW_CLIENT_SECRET['"]?\)?\s*\|\|\s*['"][^'"]{8,}['"]/,
  /EAGLEVIEW_CLIENT_ID['"]?\)?\s*\|\|\s*['"][^'"]{8,}['"]/,
  /SUPABASE_SERVICE_ROLE_KEY['"]?\)?\s*\|\|\s*['"][^'"]{8,}['"]/,
  /ZAPIER_ROOFR_HOOK_URL['"]?\)?\s*\|\|\s*['"]https?:\/\//,
]

for (const file of sourceFiles) {
  const body = fs.readFileSync(file, 'utf8')
  for (const pattern of dangerousSecretFallbacks) {
    if (pattern.test(body)) {
      failures.push(`Possible hard-coded production secret fallback in ${path.relative(root, file)}`)
    }
  }
}

const requiredAuthFunctions = ['eagleview-imagery', 'lookup-contact', 'lookup-property', 'roofr-push']
for (const name of requiredAuthFunctions) {
  const file = path.join(functionsDir, name, 'index.ts')
  const body = fs.readFileSync(file, 'utf8')
  if (!/authorization/i.test(body) || !/getUser\(/.test(body)) {
    failures.push(`${name} must validate an authenticated Supabase user inside the function`)
  }
}

// roofr-events is intentionally not JWT-authenticated: it is an external webhook.
// It must instead validate the per-organisation webhook token.
{
  const body = fs.readFileSync(path.join(functionsDir, 'roofr-events', 'index.ts'), 'utf8')
  if (!/webhook_secret_hash|sha256Hex|x-delta-ridge-token/.test(body)) {
    failures.push('roofr-events must validate the per-organisation webhook credential')
  }
}

// lead-acquisition is also an external webhook. It must authenticate the
// organization with the per-org acquisition token before invoking the
// service-role ingest RPC.
{
  const body = fs.readFileSync(path.join(functionsDir, 'lead-acquisition', 'index.ts'), 'utf8')
  if (!/acquisition_webhook_settings|sha256Hex|x-delta-ridge-token/.test(body)) {
    failures.push('lead-acquisition must validate the per-organisation webhook credential')
  }
  if (!/ingest_acquisition_lead/.test(body)) {
    failures.push('lead-acquisition must use the atomic acquisition ingest RPC')
  }
}

if (failures.length > 0) {
  console.error('Production contract checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Production contracts OK: ${migrationNames.length} migrations, ${functionNames.length} Edge Functions, deployment/auth checks passed.`,
)
