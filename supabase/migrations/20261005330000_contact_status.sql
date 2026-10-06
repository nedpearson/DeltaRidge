-- Update contact statuses for realistic pipeline behavior
UPDATE customers 
SET 
  phone_verification_status = 'PROVIDER_NOT_CONFIGURED',
  email_verification_status = 'PROVIDER_NOT_CONFIGURED'
WHERE 
  primary_phone IS NULL OR email IS NULL;
