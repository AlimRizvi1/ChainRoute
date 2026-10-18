CREATE TABLE users (
    user_id uuid PRIMARY KEY,
    username text NOT NULL UNIQUE CHECK (length(trim(username)) > 0),
    role text NOT NULL CHECK (role IN ('Shipper', 'Carrier', 'Administrator', 'Auditor')),
    chain_address text UNIQUE,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_chain_address_format CHECK (
        chain_address IS NULL OR chain_address ~ '^0x[0-9a-fA-F]{40}$'
    )
);

CREATE TABLE wagons (
    wagon_id text PRIMARY KEY CHECK (length(trim(wagon_id)) > 0),
    capacity_tonnes numeric(18, 3) NOT NULL CHECK (capacity_tonnes > 0),
    wagon_type text NOT NULL CHECK (length(trim(wagon_type)) > 0),
    location text NOT NULL CHECK (length(trim(location)) > 0),
    available boolean NOT NULL DEFAULT true,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routes (
    route_id text PRIMARY KEY CHECK (length(trim(route_id)) > 0),
    origin text NOT NULL CHECK (length(trim(origin)) > 0),
    destination text NOT NULL CHECK (length(trim(destination)) > 0),
    distance_km numeric(18, 3) NOT NULL CHECK (distance_km > 0),
    transit_time_seconds integer NOT NULL CHECK (transit_time_seconds > 0),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE optimization_runs (
    run_id text PRIMARY KEY CHECK (length(trim(run_id)) > 0),
    input_hash text CHECK (input_hash IS NULL OR input_hash ~ '^sha256:[0-9a-f]{64}$'),
    status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    input_snapshot jsonb,
    run_metadata jsonb,
    failure jsonb,
    duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT optimization_runs_result_shape CHECK (
        (status = 'running' AND completed_at IS NULL)
        OR (status = 'succeeded' AND completed_at IS NOT NULL AND run_metadata IS NOT NULL AND failure IS NULL)
        OR (status = 'failed' AND completed_at IS NOT NULL AND failure IS NOT NULL)
    )
);

CREATE TABLE orders (
    order_id text PRIMARY KEY CHECK (length(trim(order_id)) > 0),
    created_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    cargo_type text NOT NULL CHECK (length(trim(cargo_type)) > 0),
    quantity_tonnes numeric(18, 3) NOT NULL CHECK (quantity_tonnes > 0),
    destination text NOT NULL CHECK (length(trim(destination)) > 0),
    priority smallint NOT NULL CHECK (priority BETWEEN 1 AND 3),
    deadline timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Planned')),
    locked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orders_lock_state CHECK (
        (status = 'Pending' AND locked_at IS NULL)
        OR (status = 'Planned' AND locked_at IS NOT NULL)
    )
);

CREATE INDEX orders_owner_pending_idx ON orders (created_by, deadline) WHERE status = 'Pending';

CREATE TABLE allocation_plans (
    plan_id text PRIMARY KEY CHECK (length(trim(plan_id)) > 0),
    run_id text NOT NULL UNIQUE REFERENCES optimization_runs(run_id) ON DELETE RESTRICT,
    created_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    plan_payload jsonb NOT NULL CHECK (jsonb_typeof(plan_payload) = 'object'),
    score double precision NOT NULL CHECK (score >= 0 AND score < 'Infinity'::double precision),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_orders (
    plan_id text NOT NULL REFERENCES allocation_plans(plan_id) ON DELETE RESTRICT,
    order_id text NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
    assigned boolean NOT NULL,
    PRIMARY KEY (plan_id, order_id),
    UNIQUE (order_id)
);

CREATE INDEX plan_orders_order_idx ON plan_orders (order_id);

CREATE FUNCTION prevent_locked_order_update() RETURNS trigger AS $$
BEGIN
    IF OLD.locked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Order % is immutable after a plan is generated', OLD.order_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_are_immutable_after_planning
    BEFORE UPDATE OF created_by, cargo_type, quantity_tonnes, destination, priority, deadline, status, locked_at
    ON orders
    FOR EACH ROW
    WHEN (OLD.locked_at IS NOT NULL)
    EXECUTE FUNCTION prevent_locked_order_update();

CREATE TABLE contracts (
    contract_id text PRIMARY KEY CHECK (contract_id ~ '^[1-9][0-9]*$'),
    plan_id text NOT NULL UNIQUE REFERENCES allocation_plans(plan_id) ON DELETE RESTRICT,
    shipper_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    carrier_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    shipper_address text NOT NULL CHECK (shipper_address ~ '^0x[0-9a-fA-F]{40}$'),
    carrier_address text NOT NULL CHECK (carrier_address ~ '^0x[0-9a-fA-F]{40}$'),
    state text NOT NULL CHECK (state IN ('Created', 'Booked', 'InTransit', 'Delivered', 'PenaltyCalculated', 'PaymentReleased', 'Closed', 'Disputed')),
    agreement_hash text CHECK (agreement_hash IS NULL OR agreement_hash ~ '^0x[0-9a-fA-F]{64}$'),
    terms_hash text NOT NULL CHECK (terms_hash ~ '^0x[0-9a-fA-F]{64}$'),
    terms jsonb NOT NULL CHECK (jsonb_typeof(terms) = 'object'),
    assignments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assignments) = 'array'),
    freight_value_paise numeric(78, 0) NOT NULL CHECK (freight_value_paise > 0),
    sla_deadline timestamptz NOT NULL,
    penalty_paise numeric(78, 0) NOT NULL DEFAULT 0 CHECK (penalty_paise >= 0),
    demurrage_paise numeric(78, 0) NOT NULL DEFAULT 0 CHECK (demurrage_paise >= 0),
    net_payment_paise numeric(78, 0) CHECK (net_payment_paise IS NULL OR net_payment_paise >= 0),
    sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'degraded')),
    last_synced_block numeric(78, 0) CHECK (last_synced_block IS NULL OR last_synced_block >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contracts_shipper_recent_idx ON contracts (shipper_id, created_at DESC);
CREATE INDEX contracts_carrier_recent_idx ON contracts (carrier_id, created_at DESC);
CREATE INDEX contracts_state_recent_idx ON contracts (state, updated_at DESC);

CREATE TABLE contract_events (
    contract_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (length(trim(action)) > 0),
    actor_address text NOT NULL CHECK (actor_address ~ '^0x[0-9a-fA-F]{40}$'),
    occurred_at timestamptz NOT NULL,
    data_hash text NOT NULL CHECK (data_hash ~ '^0x[0-9a-fA-F]{64}$'),
    transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
    block_number numeric(78, 0) CHECK (block_number IS NULL OR block_number >= 0),
    log_index integer CHECK (log_index IS NULL OR log_index >= 0),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contract_events_chain_position_unique UNIQUE (transaction_hash, log_index)
);

CREATE INDEX contract_events_timeline_idx ON contract_events (contract_id, occurred_at, contract_event_id);

CREATE TABLE delivery_events (
    delivery_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE RESTRICT,
    shipment_status text CHECK (shipment_status IS NULL OR shipment_status IN ('Dispatched', 'CheckpointReached', 'ArrivedAtDestination')),
    delivery_timestamp timestamptz,
    pod_reference text,
    on_time boolean,
    seconds_late bigint CHECK (seconds_late IS NULL OR seconds_late >= 0),
    actor_address text NOT NULL CHECK (actor_address ~ '^0x[0-9a-fA-F]{40}$'),
    transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT delivery_events_has_payload CHECK (
        shipment_status IS NOT NULL OR delivery_timestamp IS NOT NULL
    )
);

CREATE INDEX delivery_events_contract_time_idx ON delivery_events (contract_id, recorded_at, delivery_event_id);

CREATE TABLE payments (
    contract_id text PRIMARY KEY REFERENCES contracts(contract_id) ON DELETE RESTRICT,
    gross_paise numeric(78, 0) NOT NULL CHECK (gross_paise >= 0),
    penalty_paise numeric(78, 0) NOT NULL CHECK (penalty_paise >= 0),
    demurrage_paise numeric(78, 0) NOT NULL CHECK (demurrage_paise >= 0),
    net_paise numeric(78, 0) NOT NULL CHECK (net_paise >= 0),
    transaction_hash text UNIQUE CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
    released_at timestamptz,
    closed_at timestamptz,
    CONSTRAINT payments_amounts_reconcile CHECK (
        gross_paise = penalty_paise + demurrage_paise + net_paise
    ),
    CONSTRAINT payments_closure_follows_release CHECK (closed_at IS NULL OR released_at IS NOT NULL)
);

CREATE TABLE audit_trail (
    audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
    action text NOT NULL CHECK (length(trim(action)) > 0),
    resource_type text,
    resource_id text,
    request_id text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    outcome text NOT NULL CHECK (outcome IN ('success', 'failure')),
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX audit_trail_recent_idx ON audit_trail (occurred_at DESC, audit_id DESC);
CREATE INDEX audit_trail_actor_idx ON audit_trail (user_id, occurred_at DESC);
