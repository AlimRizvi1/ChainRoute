CREATE UNIQUE INDEX users_username_case_insensitive ON users (lower(username));

CREATE TABLE account_invitations (
    invitation_id uuid PRIMARY KEY,
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    role text NOT NULL CHECK (role IN ('Shipper', 'Carrier', 'Administrator', 'Auditor')),
    created_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    expires_at timestamptz NOT NULL,
    used_by uuid REFERENCES users(user_id) ON DELETE RESTRICT,
    used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((used_by IS NULL) = (used_at IS NULL)),
    CHECK (expires_at > created_at)
);

CREATE INDEX account_invitations_pending ON account_invitations (expires_at)
    WHERE used_at IS NULL AND revoked_at IS NULL;
