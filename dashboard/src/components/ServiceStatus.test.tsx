import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BackendUnavailable, HealthBanner } from "./ServiceStatus";

describe("service health states", () => {
  it("names degraded dependencies and keeps available work visible", () => {
    render(<HealthBanner health={{
      status: "degraded",
      dependencies: { aiEngine: "down", blockchain: "up", database: "up" },
    }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Allocation engine");
    expect(screen.getByRole("status")).toHaveTextContent("unaffected work remain available");
  });

  it("renders a full-page recovery state when the backend is unreachable", () => {
    render(<BackendUnavailable retry={() => undefined} checking={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Can’t reach ChainRoute");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
