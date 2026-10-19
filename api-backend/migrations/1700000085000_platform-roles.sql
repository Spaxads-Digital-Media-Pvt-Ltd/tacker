-- Platform staff roles (Super Admin › Team › Roles) — the platform's own team works in role-based panels,
-- as on Everflow (custom roles: each section Full Access / Read Only / hidden; managers limited to their
-- assigned accounts), Trackier (sub-admin custom roles) and Voluum (owner / admin / worker / read-only).
--
-- permissions: { <section>: 'none' | 'read' | 'full' } over the sections in lib/platform/permissions.ts.
-- scope: 'all' networks, or 'assigned' = only the networks a member manages (networks.account_manager_id)
-- or sold (networks.sales_owner_id). home: the panel the role lands on.
-- System roles have fixed ids (the owner's is platform_admins.role_id's default, so an admin created
-- outside the Team page — the bootstrap script — is an owner). Owner can't be changed or deleted.

-- Up Migration

CREATE TABLE platform_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL,
  name         text NOT NULL,
  description  text,
  permissions  jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope        text NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'assigned')),
  home         text NOT NULL DEFAULT '/admin',
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_roles_key ON platform_roles (key);
CREATE TRIGGER trg_platform_roles_updated_at BEFORE UPDATE ON platform_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO platform_roles (id, key, name, description, scope, home, is_system, permissions) VALUES
('00000000-0000-4000-a000-000000000001', 'owner', 'Owner', 'Everything, including the team and roles.', 'all', '/admin', true,
 '{"dashboard":"full","networks":"full","access":"full","sales":"full","success":"full","support":"full","billing":"full","plans":"full","revenue":"full","comms":"full","platform":"full","team":"full","settings":"full","activity":"full"}'),
('00000000-0000-4000-a000-000000000002', 'admin', 'Admin', 'Runs the platform — everything but managing the team.', 'all', '/admin', true,
 '{"dashboard":"full","networks":"full","access":"full","sales":"full","success":"full","support":"full","billing":"full","plans":"full","revenue":"full","comms":"full","platform":"full","team":"read","settings":"full","activity":"full"}'),
('00000000-0000-4000-a000-000000000003', 'sales', 'Sales', 'Leads, pipeline and trials; converts leads into networks.', 'all', '/admin/sales', true,
 '{"dashboard":"read","networks":"read","access":"none","sales":"full","success":"read","support":"read","billing":"read","plans":"read","revenue":"read","comms":"none","platform":"none","team":"none","settings":"none","activity":"none"}'),
('00000000-0000-4000-a000-000000000004', 'account_manager', 'Account Manager', 'Looks after their assigned networks: health, notes, tasks, support, their dashboards.', 'assigned', '/admin/success', true,
 '{"dashboard":"read","networks":"read","access":"full","sales":"read","success":"full","support":"full","billing":"read","plans":"read","revenue":"none","comms":"read","platform":"none","team":"none","settings":"none","activity":"read"}'),
('00000000-0000-4000-a000-000000000005', 'support', 'Support', 'The ticket queue; opens tenant dashboards to help.', 'all', '/admin/support', true,
 '{"dashboard":"read","networks":"read","access":"full","sales":"none","success":"read","support":"full","billing":"read","plans":"read","revenue":"none","comms":"full","platform":"read","team":"none","settings":"none","activity":"read"}'),
('00000000-0000-4000-a000-000000000006', 'finance', 'Finance', 'Invoices, payments, plans, coupons and revenue.', 'all', '/admin/revenue', true,
 '{"dashboard":"read","networks":"read","access":"none","sales":"read","success":"read","support":"read","billing":"full","plans":"full","revenue":"full","comms":"none","platform":"none","team":"none","settings":"read","activity":"read"}'),
('00000000-0000-4000-a000-000000000007', 'read_only', 'Read-only', 'Sees everything, changes nothing.', 'all', '/admin', true,
 '{"dashboard":"read","networks":"read","access":"none","sales":"read","success":"read","support":"read","billing":"read","plans":"read","revenue":"read","comms":"read","platform":"read","team":"read","settings":"read","activity":"read"}');

ALTER TABLE platform_admins
  ADD COLUMN role_id uuid NOT NULL DEFAULT '00000000-0000-4000-a000-000000000001' REFERENCES platform_roles(id) ON DELETE RESTRICT;

ALTER TABLE networks
  ADD COLUMN account_manager_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  ADD COLUMN sales_owner_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL;
CREATE INDEX networks_account_manager_idx ON networks (account_manager_id) WHERE account_manager_id IS NOT NULL;
CREATE INDEX networks_sales_owner_idx ON networks (sales_owner_id) WHERE sales_owner_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS networks_sales_owner_idx;
DROP INDEX IF EXISTS networks_account_manager_idx;
ALTER TABLE networks DROP COLUMN IF EXISTS sales_owner_id, DROP COLUMN IF EXISTS account_manager_id;
ALTER TABLE platform_admins DROP COLUMN IF EXISTS role_id;
DROP TABLE IF EXISTS platform_roles;
