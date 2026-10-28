import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../auth/context";
import { writeSession } from "../auth/session";
import { getDappConfig, listWalletFreights, type DappConfig } from "../api/dapp";
import { WalletPage } from "./WalletPage";

vi.mock("../api/dapp", async original => ({ ...await original<typeof import("../api/dapp")>(), getDappConfig: vi.fn(), listWalletFreights: vi.fn() }));
const config: DappConfig = { chainId: 11155111, chainName: "Sepolia", rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io", confirmations: 2, linkedAddress: null, deployment: null, carriers: [], paymentMode: "gas-only" };
function mount(role: "Shipper" | "Administrator" | "Auditor" = "Shipper") {
  writeSession({ token: "wallet-test", expiresAt: Date.now() + 60_000, user: { id: "wallet-user", username: "demo", role } });
  vi.mocked(getDappConfig).mockResolvedValue(config); vi.mocked(listWalletFreights).mockResolvedValue({ items: [] });
  return render(<MemoryRouter initialEntries={["/wallet?plan=plan-from-optimizer"]}><AuthProvider><WalletPage /></AuthProvider></MemoryRouter>);
}
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); Reflect.deleteProperty(window, "ethereum"); });
describe("MetaMask freight workspace", () => {
  it("keeps signing disabled until connection and deployment, and carries the saved plan into the form", async () => {
    mount();
    expect(await screen.findByText(/Public testnet/)).toBeInTheDocument();
    expect(screen.getByLabelText("Saved plan ID")).toHaveValue("plan-from-optimizer");
    expect(screen.getByRole("button", { name: "Initiate freight & mint receipt" })).toBeDisabled();
    expect(screen.getByText(/Only network gas is deducted/)).toBeInTheDocument();
  });
  it("explains a missing browser extension without creating a transaction", async () => {
    mount(); await screen.findByText(/Public testnet/);
    fireEvent.click(screen.getByRole("button", { name: "Connect MetaMask" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/MetaMask extension installed/);
  });
  it("auditors can inspect records but cannot initiate or deploy", async () => {
    mount("Auditor"); await screen.findByText(/Public testnet/);
    expect(screen.queryByRole("button", { name: "Deploy with MetaMask" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Saved plan ID")).not.toBeInTheDocument();
  });
  it("retains a submitted hash across reload and provides its Sepolia explorer link", async () => {
    const hash = `0x${"a".repeat(64)}`;
    localStorage.setItem("chainroute.wallet.pending.v1.wallet-user", JSON.stringify({ kind: "deployment", hash }));
    mount("Administrator"); await screen.findByText(/Public testnet/);
    expect(screen.getByRole("link", { name: /View transaction/ })).toHaveAttribute("href", `https://sepolia.etherscan.io/tx/${hash}`);
    expect(screen.getByRole("button", { name: "Deploy with MetaMask" })).toBeDisabled();
  });
});
