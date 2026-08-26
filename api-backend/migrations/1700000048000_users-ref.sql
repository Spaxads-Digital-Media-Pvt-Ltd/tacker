-- My Account (Profile) General tab: the reference's own "ID" field on a user's account, matching
-- the same real numeric ID convention every other "Manage X" list/detail in this app already uses.

-- Up Migration

ALTER TABLE users ADD COLUMN ref bigserial;
CREATE INDEX users_ref_idx ON users (ref);

-- Down Migration

ALTER TABLE users DROP COLUMN ref;
