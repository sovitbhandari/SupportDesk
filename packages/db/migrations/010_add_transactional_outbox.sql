CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatching', 'dispatched', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_by TEXT,
  leased_until TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_events_org_idx ON outbox_events(organization_id);
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS outbox_events_aggregate_idx
  ON outbox_events(organization_id, aggregate_type, aggregate_id);

ALTER TABLE notification_jobs
ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES outbox_events(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS aggregate_id UUID,
ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_event_id_idx
  ON notification_jobs(event_id)
  WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  notification_job_id UUID REFERENCES notification_jobs(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  attempt_number INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'accepted', 'skipped', 'failed')),
  provider_message_id TEXT,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_attempts_event_idx ON notification_attempts(event_id);
CREATE INDEX IF NOT EXISTS notification_attempts_org_idx ON notification_attempts(organization_id);

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbox_events_tenant_isolation ON outbox_events;
CREATE POLICY outbox_events_tenant_isolation ON outbox_events
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON outbox_events TO app_user;
