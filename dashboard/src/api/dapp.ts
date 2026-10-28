import { apiRequest } from "./client";

export type DappConfig = { chainId: number; chainName: string; explorer: string | null; rpcUrl: string; confirmations: number;
  linkedAddress: string | null; deployment: { address: string; operator_address: string; transaction_hash: string } | null;
  carriers: Array<{ username: string; address: string }>; paymentMode: "gas-only" };
export type WalletTransaction = { from: string; to?: string; data: string; value: string; chainId: number };
export type WalletFreight = { freight_id: string; plan_id: string; chain_id: string; settlement_address: string; shipper_address: string; carrier_address: string;
  transaction_data: string; transaction_hash: string | null; contract_id: string | null; token_id: string | null; state: string; block_number: string | null;
  block_timestamp: string | null; fee_wei: string | null; terms_hash: string; receiptOwner?: string; pending?: boolean;
  terms?: { freightValuePaise: string; slaDeadline: number; wagonCount: number; penaltyBpsPerBlock: number; penaltyBlockSeconds: number; freeHoldingHours: number; demurrageRatePaisePerWagonHour: string };
  actions?: Array<{ transactionHash: string; action: string; status: string; blockNumber: number | null; timestamp: string | null; feeWei: string | null }>;
  accounting?: { penaltyPaise: string; demurragePaise: string; netPaymentPaise: string } };
export const getDappConfig = () => apiRequest<DappConfig>("/dapp/config");
export const listWalletFreights = () => apiRequest<{ items: WalletFreight[] }>("/dapp/freights");
export const refreshWalletFreight = (id: string) => apiRequest<WalletFreight>(`/dapp/freights/${id}/refresh`, { method: "POST", signal: AbortSignal.timeout(30_000) });
export const submitWalletFreight = (id: string, hash: string) => apiRequest(`/dapp/freights/${id}/submit`, { method: "POST", body: { transactionHash: hash }, signal: AbortSignal.timeout(30_000) });
