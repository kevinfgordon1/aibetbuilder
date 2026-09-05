-- What’s New: one live announcement at a time, written by the owner from the app.
-- Apply in the prod Supabase SQL editor (project aibetbuilder / xuolkiadmumtbksbyjzc)
-- if this file is not already applied. Safe to re-run.
--
-- Owner writes: JWT email kev120909@gmail.com — same gate as OWNER_EMAIL /
-- canSeeOwnerTools (Miss tape). Do not authorize on user_metadata.
-- Signed-in users may SELECT enabled=true rows only. Nobody else writes.
-- There is no seed row — until the owner publishes, the modal stays hidden.

CREATE TABLE IF NOT EXISTS public.whats_new_announcements (
  id text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  cta_label text,
  cta_href text,
  enabled boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid DEFAULT auth.uid(),
  CONSTRAINT whats_new_announcements_title_check CHECK (length(btrim(title)) > 0),
  CONSTRAINT whats_new_announcements_body_check CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS whats_new_announcements_active_published_at_idx
  ON public.whats_new_announcements (published_at DESC)
  WHERE enabled = true;

COMMENT ON TABLE public.whats_new_announcements IS
  'Owner-published What’s New modal. Clients show the latest enabled=true row once.';

ALTER TABLE public.whats_new_announcements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whats_new_announcements FROM PUBLIC;
REVOKE ALL ON TABLE public.whats_new_announcements FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.whats_new_announcements TO authenticated;
GRANT ALL ON TABLE public.whats_new_announcements TO service_role;

DROP POLICY IF EXISTS whats_new_announcements_select_published ON public.whats_new_announcements;
CREATE POLICY whats_new_announcements_select_published
  ON public.whats_new_announcements
  FOR SELECT
  TO authenticated
  USING (
    enabled = true
    OR lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'kev120909@gmail.com'
  );

DROP POLICY IF EXISTS whats_new_announcements_insert_owner ON public.whats_new_announcements;
CREATE POLICY whats_new_announcements_insert_owner
  ON public.whats_new_announcements
  FOR INSERT
  TO authenticated
  WITH CHECK (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'kev120909@gmail.com');

DROP POLICY IF EXISTS whats_new_announcements_update_owner ON public.whats_new_announcements;
CREATE POLICY whats_new_announcements_update_owner
  ON public.whats_new_announcements
  FOR UPDATE
  TO authenticated
  USING (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'kev120909@gmail.com')
  WITH CHECK (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'kev120909@gmail.com');
