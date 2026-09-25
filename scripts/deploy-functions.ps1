Write-Host "Deploying eagleview-imagery function..."
supabase functions deploy eagleview-imagery --no-verify-jwt

Write-Host "Deploying roofr-push function..."
supabase functions deploy roofr-push --no-verify-jwt

Write-Host "Deployment commands executed."
Write-Host "Don't forget to set your secrets in the Supabase Dashboard!"
