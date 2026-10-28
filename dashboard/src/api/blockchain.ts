import { apiRequest } from "./client";
export type ChainBlock = { number: number; hash: string; parentHash: string; timestamp: string; stateRoot: string; transactionsRoot: string; receiptsRoot: string; gasUsed: string; gasLimit: string; baseFeePerGas: string | null; size: number; miner: string; nonce: string; transactions: string[] };
export type ChainWindow = { chainId: number; head: number; clientVersion: string; observedAt: string; localDevelopment: boolean; canMine: boolean; contractAddress: string | null; nextBefore: number | null; nextFrom: number | null; genesis: ChainBlock; blocks: ChainBlock[] };
export const readBlocks = (from: number | undefined = 0, signal?: AbortSignal, latest = false) => apiRequest<ChainWindow>(`/blockchain/blocks?limit=12${latest ? "" : `&from=${from ?? 0}`}`, { signal });
export const mineBlock = () => apiRequest<{ number: number }>("/blockchain/demo-block", { method: "POST" });
