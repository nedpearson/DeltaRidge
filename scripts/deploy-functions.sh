#!/bin/bash
# Deploy edge functions for EagleView and Roofr

echo "Deploying eagleview-imagery function..."
supabase functions deploy eagleview-imagery --no-verify-jwt

echo "Deploying roofr-push function..."
supabase functions deploy roofr-push --no-verify-jwt

echo "Deployment commands executed."
echo "Don't forget to set your secrets in the Supabase Dashboard!"
