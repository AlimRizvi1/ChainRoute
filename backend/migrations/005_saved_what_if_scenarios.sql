ALTER TABLE allocation_plans
    ADD COLUMN scenario_group_id text,
    ADD COLUMN source_plan_id text REFERENCES allocation_plans(plan_id) ON DELETE RESTRICT;

UPDATE allocation_plans
SET scenario_group_id = plan_id;

ALTER TABLE allocation_plans
    ALTER COLUMN scenario_group_id SET NOT NULL,
    ADD CONSTRAINT allocation_plans_scenario_group_nonempty
        CHECK (length(trim(scenario_group_id)) > 0),
    ADD CONSTRAINT allocation_plans_source_not_self
        CHECK (source_plan_id IS NULL OR source_plan_id <> plan_id);

CREATE INDEX allocation_plans_scenario_group_idx
    ON allocation_plans (scenario_group_id, created_at);

ALTER TABLE plan_orders
    DROP CONSTRAINT plan_orders_order_id_key;

ALTER TABLE contracts
    ADD COLUMN scenario_group_id text;

UPDATE contracts c
SET scenario_group_id = p.scenario_group_id
FROM allocation_plans p
WHERE p.plan_id = c.plan_id;

ALTER TABLE contracts
    ALTER COLUMN scenario_group_id SET NOT NULL,
    ADD CONSTRAINT contracts_scenario_group_unique UNIQUE (scenario_group_id);

ALTER TABLE contract_operations
    ADD COLUMN scenario_group_id text;

UPDATE contract_operations o
SET scenario_group_id = p.scenario_group_id
FROM allocation_plans p
WHERE p.plan_id = o.plan_id AND o.action = 'accept';

ALTER TABLE contract_operations
    ADD CONSTRAINT contract_operations_accept_scenario_required
        CHECK (action <> 'accept' OR scenario_group_id IS NOT NULL);

CREATE UNIQUE INDEX contract_operations_one_active_accept_per_scenario
    ON contract_operations (scenario_group_id)
    WHERE action = 'accept'
      AND status IN ('pending', 'queued', 'processing')
      AND scenario_group_id IS NOT NULL;
