INSERT INTO roles (key, description)
VALUES
  ('customer', 'Customer end-user role'),
  ('agent', 'Support agent role'),
  ('admin', 'Organization administrator role')
ON CONFLICT (key) DO NOTHING;

WITH inserted_orgs AS (
  INSERT INTO organizations (name, slug)
  VALUES
    ('Acme Corp', 'acme'),
    ('Globex Inc', 'globex')
  ON CONFLICT (slug) DO UPDATE SET updated_at = now()
  RETURNING id, slug
),
all_orgs AS (
  SELECT id, slug FROM inserted_orgs
  UNION
  SELECT id, slug FROM organizations WHERE slug IN ('acme', 'globex')
),
inserted_users AS (
  INSERT INTO users (organization_id, email, full_name, password_hash)
  SELECT ao.id, v.email, v.full_name, crypt('hashed-password', gen_salt('bf', 10))
  FROM all_orgs ao
  JOIN (
    VALUES
      ('acme', 'alice.customer@acme.com', 'Alice Customer'),
      ('acme', 'adam.agent@acme.com', 'Adam Agent'),
      ('acme', 'amy.admin@acme.com', 'Amy Admin'),
      ('globex', 'gary.customer@globex.com', 'Gary Customer'),
      ('globex', 'gina.agent@globex.com', 'Gina Agent'),
      ('globex', 'grace.admin@globex.com', 'Grace Admin')
  ) AS v(org_slug, email, full_name) ON v.org_slug = ao.slug
  ON CONFLICT (email) DO UPDATE
    SET password_hash = CASE
      WHEN users.password_hash LIKE '$2%' THEN users.password_hash
      ELSE crypt(users.password_hash, gen_salt('bf', 10))
    END,
    updated_at = now()
  RETURNING id, organization_id, email
),
all_users AS (
  SELECT id, organization_id, email FROM inserted_users
  UNION
  SELECT id, organization_id, email FROM users WHERE email IN (
    'alice.customer@acme.com', 'adam.agent@acme.com', 'amy.admin@acme.com',
    'gary.customer@globex.com', 'gina.agent@globex.com', 'grace.admin@globex.com'
  )
),
role_map AS (
  SELECT id, key FROM roles WHERE key IN ('customer', 'agent', 'admin')
)
INSERT INTO organization_memberships (organization_id, user_id, role_id)
SELECT
  au.organization_id,
  au.id,
  rm.id
FROM all_users au
JOIN role_map rm ON rm.key = CASE
  WHEN au.email LIKE '%.customer@%' THEN 'customer'
  WHEN au.email LIKE '%.agent@%' THEN 'agent'
  ELSE 'admin'
END
ON CONFLICT (organization_id, user_id) DO NOTHING;

WITH u AS (
  SELECT id, organization_id, email
  FROM users
  WHERE email IN (
    'alice.customer@acme.com',
    'adam.agent@acme.com',
    'amy.admin@acme.com',
    'gary.customer@globex.com',
    'gina.agent@globex.com'
  )
)
INSERT INTO tickets (organization_id, requester_id, subject, description, status, priority)
SELECT
  u.organization_id,
  u.id,
  v.subject,
  v.description,
  'open',
  v.priority::ticket_priority
FROM u
JOIN (
  VALUES
    ('alice.customer@acme.com', 'Billing issue: invoice mismatch', 'Invoice total does not match expected amount for March billing cycle.', 'high'),
    ('adam.agent@acme.com', 'Login issue: cannot access account', 'User cannot sign in after password reset and receives invalid credentials error.', 'high'),
    ('amy.admin@acme.com', 'Subscription issue: charged after cancellation', 'Customer reports recurring charge posted after confirmed cancellation date.', 'urgent'),
    ('alice.customer@acme.com', 'Feature issue: export button not working', 'CSV export action completes with no file download in dashboard reports.', 'medium'),
    ('adam.agent@acme.com', 'Support request: update company billing address', 'Need to update legal billing address for upcoming invoice and tax records.', 'low')
) AS v(email, subject, description, priority) ON v.email = u.email
WHERE NOT EXISTS (
  SELECT 1
  FROM tickets t
  WHERE t.organization_id = u.organization_id
    AND t.requester_id = u.id
    AND t.subject = v.subject
);
