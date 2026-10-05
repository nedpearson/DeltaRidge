$ErrorActionPreference = "Stop"

# This script assumes you have Supabase running locally (`supabase start`)
# and that `supabase functions serve property-enrichment` is running,
# or you can test against the deployed function.

$payload = @{
    property_id = "00000000-0000-0000-0000-000000000000" # Replace with a real local property ID
} | ConvertTo-Json

Write-Host "Invoking property-enrichment edge function..."
$response = Invoke-WebRequest -Uri "http://localhost:54321/functions/v1/property-enrichment" `
    -Method Post `
    -Headers @{
        "Authorization" = "Bearer YOUR_ANON_KEY" # Add anon or service role key
        "Content-Type" = "application/json"
    } `
    -Body $payload -SkipHttpErrorCheck

Write-Host "Status Code: $($response.StatusCode)"
Write-Host "Response Body:"
Write-Host ($response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5)
