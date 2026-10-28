import { BrowserProvider, formatEther, type Eip1193Provider } from "ethers";
import { apiRequest } from "../api/client";
import type { DappConfig, WalletTransaction } from "../api/dapp";

export type InjectedWallet = Eip1193Provider & { isMetaMask?: boolean; providers?: InjectedWallet[]; on?: (event: string, fn: (...args: unknown[]) => void) => void; removeListener?: (event: string, fn: (...args: unknown[]) => void) => void };
declare global { interface Window { ethereum?: InjectedWallet } }
export function metamask(): InjectedWallet {
  const injected = window.ethereum;
  const provider = injected?.providers?.find(item => item.isMetaMask) ?? injected;
  if (!provider?.isMetaMask) throw new Error("Open ChainRoute in a browser with the MetaMask extension installed and unlocked. The in-app preview may not expose wallet extensions.");
  return provider;
}
export async function selectNetwork(config: DappConfig) {
  const wallet = metamask();
  const expected = `0x${config.chainId.toString(16)}`;
  if (Number(await wallet.request({ method: "eth_chainId" })) !== config.chainId) {
    try { await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: expected }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await wallet.request({ method: "wallet_addEthereumChain", params: [{ chainId: expected, chainName: config.chainName, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [config.rpcUrl], ...(config.explorer ? { blockExplorerUrls: [config.explorer] } : {}) }] });
    }
  }
  if (Number(await wallet.request({ method: "eth_chainId" })) !== config.chainId) throw new Error(`Select ${config.chainName} in MetaMask before continuing.`);
  return wallet;
}
export async function connectWallet(config: DappConfig) {
  const injected = metamask();
  await injected.request({ method: "eth_requestAccounts" });
  await selectNetwork(config);
  const provider = new BrowserProvider(injected);
  const signer = await provider.getSigner(); const address = await signer.getAddress();
  if (config.linkedAddress && address.toLowerCase() !== config.linkedAddress.toLowerCase()) throw new Error(`Select your linked wallet ${config.linkedAddress} in MetaMask.`);
  const challenge = await apiRequest<{ challengeId: string; message: string }>("/dapp/wallet/challenge", { method: "POST", body: { address } });
  const signature = await signer.signMessage(challenge.message);
  await apiRequest("/dapp/wallet/verify", { method: "POST", body: { challengeId: challenge.challengeId, signature } });
  return { address, balance: formatEther(await provider.getBalance(address)) };
}
export async function sendWalletTransaction(config: DappConfig, transaction: WalletTransaction) {
  if (transaction.chainId !== config.chainId || !config.linkedAddress || transaction.from.toLowerCase() !== config.linkedAddress.toLowerCase()) throw new Error("Reconnect the wallet linked to this transaction.");
  const injected = await selectNetwork(config);
  const accounts = await injected.request({ method: "eth_accounts" }) as string[];
  if (accounts[0]?.toLowerCase() !== transaction.from.toLowerCase()) throw new Error("The selected MetaMask account changed. Select your linked wallet and retry.");
  const provider = new BrowserProvider(injected);
  const signer = await provider.getSigner(transaction.from);
  const tx = await signer.sendTransaction({ ...(transaction.to ? { to: transaction.to } : {}), data: transaction.data, value: BigInt(transaction.value), chainId: transaction.chainId });
  return tx.hash;
}
export function walletError(error: unknown) {
  const value = error as { code?: string | number; shortMessage?: string; message?: string };
  if (value.code === 4001 || value.code === "ACTION_REJECTED") return "You rejected the MetaMask request. No new transaction was submitted by this action.";
  if (value.code === -32002) return "A MetaMask request is already open. Complete or reject it in your wallet first.";
  if (value.code === "INSUFFICIENT_FUNDS") return "Your wallet needs Sepolia test ETH for gas. Fund it from a Sepolia faucet, then retry.";
  return value.shortMessage || value.message || "The wallet request could not be completed.";
}
