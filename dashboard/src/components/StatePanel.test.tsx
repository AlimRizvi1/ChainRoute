import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState, ErrorState, LoadingState, ServiceUnavailableState } from "./StatePanel";

describe("shared content states", () => {
  it("announces loading status and renders intentional empty and error messages", () => {
    const { rerender } = render(<LoadingState label="Loading contracts…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading contracts…");
    rerender(<EmptyState title="No contracts yet"><p>Accepted plans will appear here.</p></EmptyState>);
    expect(screen.getByRole("heading", { name: "No contracts yet" })).toBeInTheDocument();
    rerender(<ErrorState title="Audit trail unavailable"><p>Retry in a moment.</p></ErrorState>);
    expect(screen.getByRole("heading", { name: "Audit trail unavailable" })).toBeInTheDocument();
  });

  it("explains a 503 without hiding unrelated workspace work", () => {
    render(<ServiceUnavailableState service="Blockchain settlement" />);
    expect(screen.getByText(/Blockchain settlement is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Other parts of your workspace can continue/)).toBeInTheDocument();
  });
});
