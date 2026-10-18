import { useCallback, useEffect, useState } from "react";
import { getHealth, type HealthResponse } from "../api/health";

const SERVICE_NAMES: Record<keyof HealthResponse["dependencies"], string> = {
  aiEngine: "Allocation engine",
  blockchain: "Settlement chain",
  database: "Database",
};

export function useServiceHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const next = await getHealth();
      setHealth(next);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { health, unavailable, checking, refresh };
}

export function HealthBanner({ health }: { health: HealthResponse }) {
  const down = (Object.entries(health.dependencies) as [keyof HealthResponse["dependencies"], string][])
    .filter(([, state]) => state === "down")
    .map(([key]) => SERVICE_NAMES[key]);
  if (health.status !== "degraded" || down.length === 0) return null;

  return (
    <aside className="service-degraded" role="status" aria-live="polite">
      <span className="service-degraded-mark" aria-hidden="true">!</span>
      <div><strong>Some services are unavailable</strong><span>{down.join(", ")} · reads and unaffected work remain available.</span></div>
    </aside>
  );
}

export function BackendUnavailable({ retry, checking }: { retry: () => void; checking: boolean }) {
  return (
    <section className="backend-unavailable" role="alert" aria-live="assertive">
      <h1>Can’t reach ChainRoute</h1>
      <p>The platform server is not responding. Your open workspace is safe; reconnect to continue.</p>
      <button className="primary-button" onClick={retry} disabled={checking} type="button">
        {checking ? "Checking connection…" : "Try again"}
      </button>
    </section>
  );
}

