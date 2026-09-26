CREATE TABLE IF NOT EXISTS public.analytics_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    event_name text NOT NULL,
    event_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own analytics events"
    ON public.analytics_events
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own analytics events"
    ON public.analytics_events
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS analytics_events_org_id_idx ON public.analytics_events (org_id);
CREATE INDEX IF NOT EXISTS analytics_events_user_id_idx ON public.analytics_events (user_id);
