import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { readBlocks, type ChainBlock, type ChainWindow } from "../api/blockchain";
import { BlockchainPage } from "./BlockchainPage";
vi.mock("../api/blockchain", () => ({ readBlocks: vi.fn(), mineBlock: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const block = (number: number): ChainBlock => ({ number, hash: `0x${String(number).padStart(64,"0")}`, parentHash: `0x${String(Math.max(0,number-1)).padStart(64,"0")}`, timestamp: "2026-01-08T04:05:06.000Z", stateRoot: "state", transactionsRoot: "tx", receiptsRoot: "receipts", gasUsed: "0", gasLimit: "30000000", baseFeePerGas: "1", size: 100, miner: "miner", nonce: "0x0", transactions: [] });
const windowData: ChainWindow = { chainId:31337, head:24, clientVersion:"anvil", observedAt:"2026-10-28T01:00:00Z", localDevelopment:true, canMine:false, contractAddress:null, nextBefore:null, nextFrom:12, genesis:block(0), blocks:Array.from({length:12},(_,i)=>block(i)) };
function mount() { vi.mocked(readBlocks).mockResolvedValue(windowData); return render(<MemoryRouter><BlockchainPage /></MemoryRouter>); }
it("starts at Genesis, exposes full original UTC dates and can page forward", async () => {
  mount();
  expect(await screen.findByText("Genesis block")).toBeInTheDocument();
  expect(readBlocks).toHaveBeenCalledWith(0,expect.any(AbortSignal),false);
  expect(screen.getByRole("heading",{name:"Inside block #0"})).toBeInTheDocument();
  expect(screen.getAllByText("08 Jan 2026, 04:05:06 UTC").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button",{name:"Newer blocks"}));
  await waitFor(()=>expect(readBlocks).toHaveBeenCalledWith(12,expect.any(AbortSignal),false));
});
it("changes only presentation time zone and preserves the exact UTC header timestamp", async () => {
  mount(); await screen.findByText("Genesis block");
  fireEvent.change(screen.getByLabelText("Block time zone"),{target:{value:"Asia/Kolkata"}});
  expect(screen.getAllByText(/08 Jan 2026, 09:35:06/).length).toBeGreaterThan(0);
  expect(screen.getByText("2026-01-08T04:05:06.000Z")).toBeInTheDocument();
});
