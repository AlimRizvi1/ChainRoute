import type { ReactNode } from "react";

type StatePanelProps = {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "error" | "warning";
};

export function LoadingState({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="state-panel state-loading" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, action }: StatePanelProps) {
  return <StatePanel title={title} action={action}>{children}</StatePanel>;
}

export function ErrorState({ title = "This information could not load", children, action }: Omit<StatePanelProps, "tone">) {
  return <StatePanel title={title} action={action} tone="error">{children}</StatePanel>;
}

export function ServiceUnavailableState({
  service = "A required service",
  action,
}: {
  service?: string;
  action?: ReactNode;
}) {
  return (
    <StatePanel title={`${service} is unavailable`} action={action} tone="warning">
      <p>We could not complete this request. Other parts of your workspace can continue to load.</p>
    </StatePanel>
  );
}

export function StatePanel({ title, children, action, tone = "neutral" }: StatePanelProps) {
  return (
    <section
      className={`state-panel state-${tone}`}
      role={tone === "error" ? "alert" : tone === "warning" ? "status" : undefined}
      aria-live={tone === "neutral" ? undefined : "polite"}
    >
      <h2>{title}</h2>
      <div className="state-copy">{children}</div>
      {action && <div className="state-action">{action}</div>}
    </section>
  );
}
