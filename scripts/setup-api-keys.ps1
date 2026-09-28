Write-Host "========================================="
Write-Host "  Delta Ridge API Credential Setup"
Write-Host "========================================="
Write-Host "This script securely stores your API keys directly into your production Supabase project."
Write-Host "Your keys will NEVER be printed to the screen, logged to a file, or sent to any AI."
Write-Host ""

function Prompt-Secret($promptText) {
    $secureString = Read-Host -Prompt "$promptText (typing hidden)" -AsSecureString
    if ($secureString.Length -eq 0) { return $null }
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureString)
    $key = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
    return $key
}

$openai = Prompt-Secret "Enter OPENAI_API_KEY"
if ($openai) {
    Write-Host "Uploading OPENAI_API_KEY to Supabase..."
    npx supabase secrets set OPENAI_API_KEY=$openai
}

$meta = Prompt-Secret "Enter META_ACCESS_TOKEN"
if ($meta) {
    Write-Host "Uploading META_ACCESS_TOKEN to Supabase..."
    npx supabase secrets set META_ACCESS_TOKEN=$meta
}

$twilio = Prompt-Secret "Enter TWILIO_AUTH_TOKEN"
if ($twilio) {
    Write-Host "Uploading TWILIO_AUTH_TOKEN to Supabase..."
    npx supabase secrets set TWILIO_AUTH_TOKEN=$twilio
}

Write-Host "
All done! Keys are safely stored in Supabase Edge Secrets."
