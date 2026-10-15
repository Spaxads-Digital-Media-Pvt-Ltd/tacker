-- SmartSwitch rules run (D8): the automation worker evaluates each active rule's conditions per
-- partner × offer (lib/automation/smartswitch.ts) and acts — notify, block the partner on the offer,
-- redirect their traffic on it, or set their payout on it. The rule keeps what it's watching (state),
-- its last run / firing / error; its log (smartswitch_history) now holds actions as well as edits.

-- Up Migration

ALTER TABLE smartswitch_rules
  ADD COLUMN conditions        text,
  ADD COLUMN action_params     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN state             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN last_evaluated_at timestamptz,
  ADD COLUMN last_fired_at     timestamptz,
  ADD COLUMN last_error        text;
ALTER TABLE smartswitch_rules DROP CONSTRAINT smartswitch_rules_action_check;
ALTER TABLE smartswitch_rules ADD CONSTRAINT smartswitch_rules_action_check
  CHECK (action IN ('notify', 'block', 'redirect', 'payout'));

ALTER TABLE smartswitch_history
  ADD COLUMN kind         text NOT NULL DEFAULT 'change' CHECK (kind IN ('change', 'action')),
  ADD COLUMN offer_id     uuid,
  ADD COLUMN publisher_id uuid,
  ADD COLUMN details      jsonb;
CREATE INDEX smartswitch_history_rule_idx ON smartswitch_history (network_id, rule_id, created_at DESC);

-- Down Migration

DROP INDEX IF EXISTS smartswitch_history_rule_idx;
ALTER TABLE smartswitch_history
  DROP COLUMN IF EXISTS details,
  DROP COLUMN IF EXISTS publisher_id,
  DROP COLUMN IF EXISTS offer_id,
  DROP COLUMN IF EXISTS kind;
UPDATE smartswitch_rules SET action = 'notify' WHERE action NOT IN ('notify', 'block');
ALTER TABLE smartswitch_rules DROP CONSTRAINT smartswitch_rules_action_check;
ALTER TABLE smartswitch_rules ADD CONSTRAINT smartswitch_rules_action_check CHECK (action IN ('notify', 'block'));
ALTER TABLE smartswitch_rules
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS last_fired_at,
  DROP COLUMN IF EXISTS last_evaluated_at,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS action_params,
  DROP COLUMN IF EXISTS conditions;
