CREATE TABLE contract_operations (
    operation_id uuid PRIMARY KEY,
    plan_id text NOT NULL REFERENCES allocation_plans(plan_id) ON DELETE RESTRICT,
    contract_id text REFERENCES contracts(contract_id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN (
        'accept', 'confirm_booking', 'shipment_status', 'confirm_delivery',
        'raise_dispute', 'resolve_dispute', 'release_payment', 'close'
    )),
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    response_payload jsonb CHECK (response_payload IS NULL OR jsonb_typeof(response_payload) = 'object'),
    transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contract_operations_result_shape CHECK (
        (status = 'succeeded' AND response_payload IS NOT NULL)
        OR status <> 'succeeded'
    ),
    CONSTRAINT contract_operations_idempotency_unique UNIQUE (plan_id, action, idempotency_key)
);

CREATE INDEX contract_operations_pending_idx ON contract_operations (updated_at)
    WHERE status = 'pending';
