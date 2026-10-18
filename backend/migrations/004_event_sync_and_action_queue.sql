ALTER TABLE contract_operations
    DROP CONSTRAINT contract_operations_status_check,
    ADD CONSTRAINT contract_operations_status_check
        CHECK (status IN ('pending', 'queued', 'processing', 'succeeded', 'failed')),
    ADD COLUMN request_payload jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(request_payload) = 'object'),
    ADD COLUMN actor_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
    ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN worker_token uuid;

CREATE INDEX contract_operations_retry_idx
    ON contract_operations (next_attempt_at, created_at)
    WHERE status = 'queued';

CREATE TABLE chain_sync_state (
    sync_name text PRIMARY KEY,
    chain_id numeric(78, 0) NOT NULL CHECK (chain_id >= 0),
    last_synced_block numeric(78, 0) NOT NULL DEFAULT 0 CHECK (last_synced_block >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE delivery_events
    ADD CONSTRAINT delivery_events_transaction_hash_unique UNIQUE (transaction_hash);
