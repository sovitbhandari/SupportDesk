CREATE UNIQUE INDEX IF NOT EXISTS ticket_assignments_one_active_per_ticket_idx
ON ticket_assignments (organization_id, ticket_id)
WHERE released_at IS NULL;
