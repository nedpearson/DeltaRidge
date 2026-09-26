$ErrorActionPreference = "Stop"

# Deploy every Delta Ridge Edge Function. Gateway JWT verification is disabled
# because authentication is enforced by each function according to its contract.
$functions = @(
  "eagleview-imagery",
  "lookup-contact",
  "lookup-property",
  "roofr-events",
  "roofr-push"
)

foreach ($fn in $functions) {
  Write-Host "Deploying $fn..."
  npx supabase functions deploy $fn --no-verify-jwt
  if ($LASTEXITCODE -ne 0) {
    throw "Supabase function deployment failed: $fn"
  }
}

Write-Host "All Edge Function deployment commands completed."
Write-Host "Next: run docs/PRODUCTION_CERTIFICATION.md against the live environment."
