import { useCallback, useEffect, useState } from "react";

type ServiceHealth = "up" | "down";
type HealthResponse = {
  status: "ok" | "degraded";
  dependencies: {
    aiEngine: ServiceHealth;
    blockchain: ServiceHealth;
    database: ServiceHealth;
  };
};

const serviceLabels = [
  ["aiEngine", "AI/ML Allocation Engine"],
  ["blockchain", "Blockchain"],
  ["database", "PostgreSQL Database"],
] as const;

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }
      const result: unknown = await response.json();
      if (!isHealthResponse(result)) {
        throw new Error("Backend returned an invalid health response");
      }
      setHealth(result);
      setError(null);
    } catch (cause) {
      setHealth(null);
      setError(cause instanceof Error ? cause.message : "Unable to reach backend");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const overallStatus = error ? "unavailable" : health?.status ?? "checking";

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ChainRoute home">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>ChainRoute</span>
        </a>
        <span className="environment-label">LOCAL DEVELOPMENT</span>
      </header>

      <section className="intro">
        <p className="eyebrow">WALKING SKELETON · PHASE 2</p>
        <h1>System status</h1>
        <p className="intro-copy">
          A live view of the services that power freight allocation and settlement.
        </p>
      </section>

      <section className={`overall-card overall-${overallStatus}`} aria-live="polite">
        <span className="status-dot" />
        <div>
          <p className="overall-label">Platform status</p>
          <h2>
            {error
              ? "Backend unavailable"
              : health?.status === "degraded"
                ? "Degraded service"
                : health?.status === "ok"
                  ? "All systems operational"
                  : "Checking services…"}
          </h2>
          {error && <p className="overall-detail">{error}</p>}
          {health?.status === "degraded" && (
            <p className="overall-detail">
              One or more dependencies are unavailable. The backend is still responding.
            </p>
          )}
        </div>
        <button className="refresh-button" onClick={() => void refresh()} type="button">
          Refresh
        </button>
      </section>

      <section className="service-section" aria-labelledby="service-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DEPENDENCIES</p>
            <h2 id="service-heading">Connected services</h2>
          </div>
          <span className="refresh-note">Auto-refreshes every 3 seconds</span>
        </div>
        <div className="service-list">
          <ServiceRow label="Backend API" state={error ? "down" : "up"} />
          {serviceLabels.map(([key, label]) => (
            <ServiceRow
              key={key}
              label={label}
              state={error ? "down" : health?.dependencies[key] ?? "down"}
              pending={!error && health === null}
            />
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>ChainRoute · Freight allocation and settlement</span>
        <span>Health is checked by the backend</span>
      </footer>
    </main>
  );
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null || !("dependencies" in value)) {
    return false;
  }
  const response = value as Partial<HealthResponse>;
  return (
    (response.status === "ok" || response.status === "degraded") &&
    typeof response.dependencies === "object" &&
    response.dependencies !== null &&
    ["aiEngine", "blockchain", "database"].every(
      (key) =>
        response.dependencies?.[key as keyof HealthResponse["dependencies"]] ===
          "up" ||
        response.dependencies?.[key as keyof HealthResponse["dependencies"]] ===
          "down",
    )
  );
}

function ServiceRow({
  label,
  state,
  pending = false,
}: {
  label: string;
  state: ServiceHealth;
  pending?: boolean;
}) {
  const text = pending ? "Checking" : state === "up" ? "Operational" : "Down";
  return (
    <article className="service-row">
      <div className="service-name">
        <span className={`service-indicator ${pending ? "is-pending" : `is-${state}`}`} />
        <span>{label}</span>
      </div>
      <span className={`service-status ${pending ? "is-pending" : `is-${state}`}`}>
        {text}
      </span>
    </article>
  );
}
