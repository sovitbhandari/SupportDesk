CREATE TABLE IF NOT EXISTS ticket_event_counters (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  next_sequence BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, ticket_id)
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ticket_id, sequence)
);

CREATE INDEX IF NOT EXISTS ticket_events_ticket_sequence_idx
  ON ticket_events(organization_id, ticket_id, sequence);
CREATE INDEX IF NOT EXISTS ticket_events_created_id_idx
  ON ticket_events(organization_id, ticket_id, created_at, id);

WITH numbered_messages AS (
  SELECT
    m.organization_id,
    m.ticket_id,
    m.id AS message_id,
    m.author_id,
    m.body,
    m.created_at,
    row_number() OVER (
      PARTITION BY m.organization_id, m.ticket_id
      ORDER BY m.created_at ASC, m.id ASC
    ) AS sequence
  FROM messages m
),
inserted_events AS (
  INSERT INTO ticket_events(
    organization_id, ticket_id, sequence, event_type, message_id, actor_user_id, payload, created_at
  )
  SELECT
    nm.organization_id,
    nm.ticket_id,
    nm.sequence,
    'ticket.message.created',
    nm.message_id,
    nm.author_id,
    jsonb_build_object('messageId', nm.message_id, 'body', nm.body),
    nm.created_at
  FROM numbered_messages nm
  ON CONFLICT (organization_id, ticket_id, sequence) DO NOTHING
  RETURNING organization_id, ticket_id, sequence
),
counter_values AS (
  SELECT organization_id, ticket_id, max(sequence) + 1 AS next_sequence
  FROM ticket_events
  GROUP BY organization_id, ticket_id
)
INSERT INTO ticket_event_counters(organization_id, ticket_id, next_sequence)
SELECT organization_id, ticket_id, next_sequence
FROM counter_values
ON CONFLICT (organization_id, ticket_id)
DO UPDATE SET next_sequence = EXCLUDED.next_sequence, updated_at = now();

ALTER TABLE ticket_event_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_event_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_event_counters_tenant_isolation ON ticket_event_counters;
CREATE POLICY ticket_event_counters_tenant_isolation ON ticket_event_counters
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

DROP POLICY IF EXISTS ticket_events_tenant_isolation ON ticket_events;
CREATE POLICY ticket_events_tenant_isolation ON ticket_events
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_event_counters TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_events TO app_user;
