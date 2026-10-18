import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

type SummaryRow = {
  pending_orders: string;
  active_contracts: string;
  delivered_contracts: string;
  pending_payments: string;
  assigned_wagons: string;
  active_wagons: string;
  allocations_today: string;
  utilization_trend: number[];
  total_freight_value_paise: string;
};

export async function registerDashboardRoutes(app: FastifyInstance, database: Pool): Promise<void> {
  app.get(
    "/dashboard/summary",
    { config: { permission: "dashboard.summary" } },
    async (request, reply) => {
      const actor = request.actor!;
      const result = await database.query<SummaryRow>(
        `WITH scoped_contracts AS (
           SELECT c.* FROM contracts c
           WHERE ($1::text = 'Administrator' OR c.shipper_id = $2::uuid)
         ), trend_days AS (
           SELECT generate_series((now() AT TIME ZONE 'UTC')::date - 6,
                                  (now() AT TIME ZONE 'UTC')::date, interval '1 day')::date AS day
         ), trend AS (
           SELECT d.day,
             CASE WHEN (SELECT count(*) FROM wagons w WHERE w.active = true AND w.available = true) = 0 THEN 0
               ELSE LEAST(100, round(count(DISTINCT wagon.value) * 100.0 /
                 (SELECT count(*) FROM wagons w WHERE w.active = true AND w.available = true)))::int
             END AS utilization
           FROM trend_days d
           LEFT JOIN allocation_plans p
             ON (p.created_at AT TIME ZONE 'UTC')::date = d.day
            AND ($1::text = 'Administrator' OR p.created_by = $2::uuid)
           LEFT JOIN LATERAL jsonb_array_elements(COALESCE(p.plan_payload->'assignments','[]'::jsonb)) assignment ON true
           LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(assignment->'wagonIds','[]'::jsonb)) wagon(value) ON true
           GROUP BY d.day ORDER BY d.day
         )
         SELECT
           (SELECT count(*) FROM orders o WHERE o.status = 'Pending'
             AND ($1::text = 'Administrator' OR o.created_by = $2::uuid))::text AS pending_orders,
           (SELECT count(*) FROM scoped_contracts c WHERE c.state IN ('Created','Booked','InTransit','Disputed'))::text AS active_contracts,
           (SELECT count(*) FROM scoped_contracts c WHERE c.state IN ('Delivered','PenaltyCalculated','PaymentReleased','Closed'))::text AS delivered_contracts,
           (SELECT count(*) FROM scoped_contracts c WHERE c.state IN ('PenaltyCalculated','Disputed'))::text AS pending_payments,
           (SELECT count(DISTINCT wagon.value)
              FROM scoped_contracts c
              CROSS JOIN LATERAL jsonb_array_elements(c.assignments) assignment
              CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(assignment->'wagonIds','[]'::jsonb)) wagon(value)
             WHERE c.state IN ('Created','Booked','InTransit','Disputed'))::text AS assigned_wagons,
           (SELECT count(*) FROM wagons w WHERE w.active = true AND w.available = true)::text AS active_wagons,
           (SELECT count(*) FROM allocation_plans p
             WHERE (p.created_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date
               AND ($1::text = 'Administrator' OR p.created_by = $2::uuid))::text AS allocations_today,
           (SELECT array_agg(t.utilization ORDER BY t.day) FROM trend t) AS utilization_trend,
           (SELECT COALESCE(sum(c.freight_value_paise),0)::text FROM scoped_contracts c) AS total_freight_value_paise`,
        [actor.role, actor.userId],
      );
      const row = result.rows[0];
      const activeWagons = Number(row.active_wagons);
      const assignedWagons = Number(row.assigned_wagons);
      return reply.code(200).send({
        pendingOrders: Number(row.pending_orders),
        activeContracts: Number(row.active_contracts),
        deliveredContracts: Number(row.delivered_contracts),
        pendingPayments: Number(row.pending_payments),
        wagonUtilizationPercent: activeWagons > 0 ? Math.min(100, Math.round(assignedWagons / activeWagons * 100)) : 0,
        allocationsToday: Number(row.allocations_today),
        utilizationTrend: row.utilization_trend,
        ...(actor.role === "Shipper" ? { totalFreightValuePaise: row.total_freight_value_paise } : {}),
      });
    },
  );
}
