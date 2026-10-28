-- Separate network-aware records preserve the existing local settlement history.
CREATE TABLE wallet_links (
    user_id uuid PRIMARY KEY REFERENCES users(user_id),
    address text NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
    linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wallet_links_address_unique ON wallet_links(lower(address));
CREATE TABLE wallet_challenges (
    challenge_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(user_id),
    address text NOT NULL,
    message text NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);
CREATE TABLE wallet_deployments (
    chain_id bigint PRIMARY KEY,
    address text NOT NULL,
    operator_address text NOT NULL,
    transaction_hash text NOT NULL,
    deployed_by uuid NOT NULL REFERENCES users(user_id),
    deployed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wallet_freights (
    freight_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(user_id),
    plan_id text NOT NULL REFERENCES allocation_plans(plan_id),
    scenario_group_id text NOT NULL,
    chain_id bigint NOT NULL,
    settlement_address text NOT NULL,
    shipper_address text NOT NULL,
    carrier_address text NOT NULL,
    terms_hash text NOT NULL,
    terms jsonb NOT NULL,
    transaction_data text NOT NULL,
    transaction_hash text,
    contract_id text,
    token_id text,
    state text NOT NULL DEFAULT 'Prepared',
    block_number bigint,
    block_hash text,
    block_timestamp timestamptz,
    gas_used text,
    fee_wei text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(chain_id, settlement_address, scenario_group_id),
    UNIQUE(chain_id, transaction_hash)
);
CREATE INDEX wallet_freights_owner_idx ON wallet_freights(user_id, created_at DESC);
CREATE TABLE wallet_action_transactions (
    chain_id bigint NOT NULL,
    transaction_hash text NOT NULL,
    freight_id uuid NOT NULL REFERENCES wallet_freights(freight_id),
    user_id uuid NOT NULL REFERENCES users(user_id),
    action text NOT NULL,
    status text NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    block_number bigint,
    block_timestamp timestamptz,
    fee_wei text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(chain_id, transaction_hash)
);
