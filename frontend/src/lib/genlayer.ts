/**
 * GenLayer connection helpers for BountyJudge.
 *
 * Default network is the Bradbury testnet (chain 4221, GEN testnet tokens
 * from the faucet — no real funds). Set VITE_GENLAYER_NETWORK=studio to
 * point at a local GenLayer Studio instance instead, and
 * VITE_CONTRACT_ADDRESS to the deployed BountyJudge address.
 */
import { createClient } from "genlayer-js";
import { testnetBradbury, studionet } from "genlayer-js/chains";
import { createWalletClient, custom, type WalletClient } from "viem";

export const BRADBURY_CHAIN_ID = 4221;

export function getChain() {
  const net = (import.meta.env.VITE_GENLAYER_NETWORK || "bradbury").toLowerCase();
  return net === "studio" ? studionet : testnetBradbury;
}

export function getChainId(): number {
  return getChain().id as number;
}

export function getRpcUrl(): string {
  return (
    import.meta.env.VITE_GENLAYER_RPC_URL ||
    (getChain().rpcUrls.default.http[0] as string)
  );
}

export function getContractAddress(): string {
  return (import.meta.env.VITE_CONTRACT_ADDRESS as string) || "";
}

export function getExplorerUrl(): string {
  const ex = (getChain() as any).blockExplorers?.default?.url as string | undefined;
  return ex || "https://explorer-bradbury.genlayer.com/";
}

/** Network params for wallet_addEthereumChain (MetaMask). */
export function getNetworkParams() {
  const chain = getChain() as any;
  return {
    chainId: `0x${chain.id.toString(16)}`,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [getRpcUrl()],
    blockExplorerUrls: [getExplorerUrl()],
  };
}

interface EthereumProvider {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function isMetaMaskInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.ethereum?.isMetaMask;
}

export function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum || null;
}

export async function requestAccounts(): Promise<string[]> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("MetaMask is not installed");
  try {
    return await provider.request({ method: "eth_requestAccounts" });
  } catch (error: any) {
    if (error.code === 4001) throw new Error("User rejected the connection request");
    throw new Error(`Failed to connect to MetaMask: ${error.message}`);
  }
}

export async function getAccounts(): Promise<string[]> {
  const provider = getEthereumProvider();
  if (!provider) return [];
  try {
    return await provider.request({ method: "eth_accounts" });
  } catch {
    return [];
  }
}

export async function getCurrentChainId(): Promise<string | null> {
  const provider = getEthereumProvider();
  if (!provider) return null;
  try {
    return await provider.request({ method: "eth_chainId" });
  } catch {
    return null;
  }
}

export async function switchToGenLayerNetwork(): Promise<void> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("MetaMask is not installed");
  const chainIdHex = `0x${getChainId().toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (error: any) {
    if (error.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [getNetworkParams()],
      });
    } else if (error.code === 4001) {
      throw new Error("User rejected switching the network");
    } else {
      throw new Error(`Failed to switch network: ${error.message}`);
    }
  }
}

export async function isOnGenLayerNetwork(): Promise<boolean> {
  const chainId = await getCurrentChainId();
  if (!chainId) return false;
  return parseInt(chainId, 16) === getChainId();
}

export async function connectWallet(): Promise<string> {
  if (!isMetaMaskInstalled()) throw new Error("MetaMask is not installed");
  const accounts = await requestAccounts();
  if (!accounts || accounts.length === 0) throw new Error("No accounts found");
  if (!(await isOnGenLayerNetwork())) await switchToGenLayerNetwork();
  return accounts[0];
}

export function createMetaMaskWalletClient(): WalletClient | null {
  const provider = getEthereumProvider();
  if (!provider) return null;
  try {
    return createWalletClient({
      chain: getChain() as any,
      transport: custom(provider),
    });
  } catch {
    return null;
  }
}

/**
 * Create a GenLayer client. When an address is given, the SDK uses the
 * window.ethereum provider for signing via MetaMask.
 */
export function createGenLayerClient(address?: string) {
  const config: any = { chain: getChain() };
  if (address) config.account = address as `0x${string}`;
  const rpc = getRpcUrl();
  if (rpc) config.endpoint = rpc;
  return createClient(config);
}

export async function getClient() {
  const accounts = await getAccounts();
  return createGenLayerClient(accounts[0]);
}
