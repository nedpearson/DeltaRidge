import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures = []

const migrationsDir = path.join(root, 'supabase', 'migrations')
const applyAllPath = path.join(root, 'supabase', 'apply_all.sql')
const applyAll = fs.readFileSync(applyAllPath, 'utf8')
const migrationNames = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

for (const name of migrationNames) {
  if (!applyAll.includes(`-- ${name}`)) {
    failures.push(`apply_all.sql is missing migration: ${name}`)
  }
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

if (failures.length > 0) {
  console.error('Production contract checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Production contracts OK: ${migrationNames.length} migrations, ${functionNames.length} Edge Functions, deployment/auth checks passed.`,
)
