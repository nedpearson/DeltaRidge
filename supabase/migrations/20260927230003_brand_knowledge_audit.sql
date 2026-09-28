ALTER TABLE brand_knowledge
ALTER COLUMN is_approved SET DEFAULT false,
ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS approved_at timestamptz,
ADD COLUMN IF NOT EXISTS superseded_version uuid REFERENCES brand_knowledge(id),
ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'active', 'retired'));

-- Update existing records
UPDATE brand_knowledge SET status = 'active' WHERE is_approved = true;

CREATE OR REPLACE FUNCTION audit_brand_knowledge_changes()
RETURNS trigger AS $$
BEGIN
    -- Only managers can approve
    IF NEW.is_approved = true AND OLD.is_approved = false THEN
        NEW.approved_at = now();
        NEW.status = 'approved';
        -- Check if user is manager would happen here or in RLS
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS brand_knowledge_audit ON brand_knowledge;
CREATE TRIGGER brand_knowledge_audit
    BEFORE UPDATE ON brand_knowledge
    FOR EACH ROW
    EXECUTE FUNCTION audit_brand_knowledge_changes();
