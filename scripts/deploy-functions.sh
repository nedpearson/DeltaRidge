#!/usr/bin/env bash
set -euo pipefail

# Deploy every Delta Ridge Edge Function. JWT verification is disabled at the
# gateway because each function has a different authentication contract:
# - eagleview-imagery / lookup-contact / lookup-property validate Supabase JWTs
#   inside the function so they can also resolve the caller's organisation.
# - roofr-events and lead-acquisition are external webhooks authenticated by per-org hashed tokens.
# - roofr-push validates the signed-in caller and RLS inside the function.
#
# A deployment succeeding is NOT proof an integration works. Run the production
# certification smoke tests afterwards and confirm observed traffic in Health.

functions=(
  eagleview-imagery
  lookup-contact
  lookup-property
  lead-acquisition
  roofr-events
  roofr-push
)

for fn in "${functions[@]}"; do
  echo "Deploying ${fn}..."
  supabase functions deploy "${fn}" --no-verify-jwt
done

echo "All Edge Function deployment commands completed."
echo "Next: run docs/PRODUCTION_CERTIFICATION.md against the live environment."
