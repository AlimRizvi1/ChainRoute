import { readFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, Wallet, type ContractRunner, type InterfaceAbi, type TransactionReceipt } from "ethers";

type Artifact = { contractName: string; address: string; chainId: number; abi: InterfaceAbi };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function openSettlement(rpcUrl: string, artifactPath: string) {
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Artifact;
  if (artifact.contractName !== "ChainRouteSettlement" || !/^0x[0-9a-fA-F]{40}$/.test(artifact.address) || !Array.isArray(artifact.abi)) {
    throw new Error("Deployed ChainRouteSettlement artifact is invalid.");
  }
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== artifact.chainId) {
    await provider.destroy();
    throw new Error("The deployed settlement contract belongs to a different chain.");
  }
  const contract = new Contract(artifact.address, artifact.abi, provider);
  return { artifact, provider, contract };
}

export async function getSigner(
  provider: JsonRpcProvider,
  address: string,
  role: "operator" | "shipper" | "carrier",
): Promise<ContractRunner> {
  const configured = process.env[`CHAIN_${role.toUpperCase()}_PRIVATE_KEY`];
  if (configured) {
    const wallet = new Wallet(configured, provider);
    if (wallet.address.toLowerCase() !== address.toLowerCase()) {
      throw new Error(`Configured ${role} signer does not match the account mapping.`);
    }
    return wallet;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(`CHAIN_${role.toUpperCase()}_PRIVATE_KEY must be configured in production.`);
  }
  const signer = await provider.getSigner(address);
  if ((await signer.getAddress()).toLowerCase() !== address.toLowerCase()) {
    throw new Error(`The local RPC does not expose the mapped ${role} account.`);
  }
  return signer;
}

export async function submitTransaction(
  provider: JsonRpcProvider,
  contract: Contract,
  signerAddress: string,
  signerRole: "operator" | "shipper" | "carrier",
  method: string,
  args: unknown[],
): Promise<{ receipt: TransactionReceipt; transactionHash: string }> {
  const signer = await getSigner(provider, signerAddress, signerRole);
  const signed = contract.connect(signer);
  const transaction = await signed.getFunction(method)(...args);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Blockchain transaction was not confirmed successfully.");
  return { receipt, transactionHash: receipt.hash };
}

export function findEvent(contract: Contract, receipt: TransactionReceipt, eventName: string) {
  for (const log of receipt.logs) {
    try {
      const event = contract.interface.parseLog(log);
      if (event?.name === eventName) return event;
    } catch {
      // Ignore logs emitted by other contracts.
    }
  }
  return undefined;
}

export function getStateName(value: bigint | number): string {
  return ["Created", "Booked", "InTransit", "Delivered", "PenaltyCalculated", "PaymentReleased", "Closed", "Disputed"][Number(value)] ?? "Unknown";
}
