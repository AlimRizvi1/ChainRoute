import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth } from "../auth/context";
import { readSession } from "../auth/session";
import { SignupPage } from "./SignupPage";

function Home() { const { session } = useAuth(); return <h1>Signed in as {session?.user.role}</h1>; }
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function mount(path = "/signup") {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><Location /><Routes><Route path="/signup" element={<SignupPage />} /><Route path="/overview" element={<Home />} /></Routes></AuthProvider></MemoryRouter>);
}
function fill(confirmation = "my long freight passphrase") {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "new.shipper" } });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "my long freight passphrase" } });
  fireEvent.change(screen.getByLabelText("Confirm password", { exact: true }), { target: { value: confirmation } });
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const sessionResponse = (role = "Shipper") => ({ token: "signup-token", tokenType: "Bearer", expiresIn: 900, user: { id: "new-user", username: "new.shipper", role } });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe("account signup", () => {
  it("creates a Shipper account without sending a client-selected role", async () => {
    const fetch = vi.fn().mockResolvedValue(json(sessionResponse(), 201)); vi.stubGlobal("fetch", fetch);
    mount(); fill(); fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Signed in as Shipper" })).toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ username: "new.shipper", password: "my long freight passphrase" });
    expect(readSession()?.user.role).toBe("Shipper");
  });

  it("catches mismatched passwords before a request and supports password visibility", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); mount(); fill("something different");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("previews the assigned invitation role, removes its token from the URL, and redeems it", async () => {
    const token = "a".repeat(43);
    const fetch = vi.fn().mockImplementation(async (url) => String(url).endsWith("/preview") ? json({ role: "Carrier", expiresAt: "2027-01-01T00:00:00Z" }) : json(sessionResponse("Carrier"), 201));
    vi.stubGlobal("fetch", fetch); mount(`/signup?invite=${token}`);
    expect(await screen.findByText("Carrier account")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toBe("");
    fill(); fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Signed in as Carrier" })).toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls.find(([url]) => String(url).endsWith("/signup"))![1].body).invitationToken).toBe(token);
  });

  it("blocks an invalid invitation and allows explicit recovery to public signup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { code: "INVALID_INVITATION", message: "This invitation expired. Ask for a new link." } }, 400)));
    mount(`/signup?invite=${"b".repeat(43)}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("invitation expired");
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Create a Shipper account instead" }));
    expect(screen.getByText("Shipper account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("keeps inputs available after a server error and prevents duplicate submissions", async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch); mount(); fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled();
    resolve(json({ error: { code: "USERNAME_UNAVAILABLE", message: "Choose another username." } }, 409));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Choose another username"));
    expect(screen.getByLabelText("Username")).toHaveValue("new.shipper");
    expect(fetch).toHaveBeenCalledTimes(1); expect(readSession()).toBeNull();
  });

  it("recovers when an invitation becomes unavailable after preview", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url) => String(url).endsWith("/preview")
      ? json({ role: "Carrier", expiresAt: "2027-01-01T00:00:00Z" })
      : json({ error: { code: "INVALID_INVITATION", message: "This invitation has already been used." } }, 400)));
    mount(`/signup?invite=${"c".repeat(43)}`); await screen.findByText("Carrier account"); fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already been used");
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create a Shipper account instead" })).toBeEnabled();
    expect(readSession()).toBeNull();
  });
});
