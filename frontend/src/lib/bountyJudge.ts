/**
 * Typed wrapper around the deployed BountyJudge Intelligent Contract.
 * Follows the genlayer-js read/write pattern: readContract for views,
 * writeContract (+ value for payable) for state changes, then wait for an
 * ACCEPTED receipt. Fee presets mirror the GenLayer fee model (appeal
 * rounds / rotations); the estimate is best-effort and optional.
 */
import { createGenLayerClient, getContractAddress } from "./genlayer";

export interface Bounty {
  id: number;
  poster: string;
  title: string;
  rubric: string;
  reward: bigint;
  status: string;
  hunter: string;
  deliverable: string;
  evidence_url: string;
  verdict: string;
  reasons: string;
}

export interface TransactionReceipt {
  status: string;
  hash: string;
  blockNumber?: number;
  [key: string]: any;
}

type FeePresetLevel = "low" | "standard" | "high";

const PRESET_OPTIONS: Record<FeePresetLevel, Record<string, unknown>> = {
  low: { appealRounds: 0n, rotations: [0n] },
  standard: { appealRounds: 1n, rotations: [0n, 0n] },
  high: { appealRounds: 2n, rotations: [0n, 0n, 0n] },
};

/** Recursively turn genlayer-js Maps (TreeMap / dataclass) into plain objects. */
function toPlain(value: any): any {
  if (value instanceof Map) {
    const obj: Record<string, any> = {};
    for (const [k, v] of value.entries()) obj[String(k)] = toPlain(v);
    return obj;
  }
  if (Array.isArray(value)) return value.map(toPlain);
  return value;
}

function bountyFromRaw(raw: any): Bounty {
  const o = toPlain(raw);
  return {
    id: Number(o.id ?? 0),
    poster: String(o.poster ?? ""),
    title: String(o.title ?? ""),
    rubric: String(o.rubric ?? ""),
    reward: BigInt(o.reward ?? 0),
    status: String(o.status ?? ""),
    hunter: String(o.hunter ?? ""),
    deliverable: String(o.deliverable ?? ""),
    evidence_url: String(o.evidence_url ?? ""),
    verdict: String(o.verdict ?? ""),
    reasons: String(o.reasons ?? ""),
  };
}

export class BountyJudge {
  private contractAddress: `0x${string}`;
  private client: any;

  constructor(contractAddress?: string, account?: string | null) {
    this.contractAddress = (contractAddress ||
      getContractAddress()) as `0x${string}`;
    this.client = createGenLayerClient(account || undefined);
  }

  updateAccount(address: string): void {
    this.client = createGenLayerClient(address);
  }

  requireAddress(): void {
    if (!this.contractAddress) {
      throw new Error(
        "No contract address configured — set VITE_CONTRACT_ADDRESS to the deployed BountyJudge address."
      );
    }
  }

  private async estimateFees(
    functionName: string,
    args: unknown[],
    value: bigint = 0n,
    level: FeePresetLevel = "standard"
  ): Promise<Record<string, unknown> | undefined> {
    if (typeof this.client?.estimateTransactionFees !== "function") {
      return undefined;
    }
    try {
      const options = PRESET_OPTIONS[level];
      let estimate = await this.client.estimateTransactionFees(options);
      if (
        typeof this.client.simulateWriteContract === "function" &&
        typeof this.client.estimateTransactionFeesFromSimulation === "function"
      ) {
        const simulation = await this.client.simulateWriteContract({
          address: this.contractAddress,
          functionName,
          args,
          includeReceipt: true,
          value,
        });
        estimate = await this.client.estimateTransactionFeesFromSimulation(
          simulation
        );
      }
      const est = estimate?.estimate ?? estimate;
      if (!est?.distribution) return undefined;
      const fees: Record<string, unknown> = { distribution: est.distribution };
      if (est.messageAllocations) fees.messageAllocations = est.messageAllocations;
      const feeValue = est.feeValue ?? est.fee_value;
      if (feeValue !== undefined) fees.feeValue = feeValue;
      return fees;
    } catch {
      return undefined;
    }
  }

  private async write(
    functionName: string,
    args: unknown[],
    value: bigint = 0n
  ): Promise<TransactionReceipt> {
    this.requireAddress();
    const fees = await this.estimateFees(functionName, args, value);
    const txHash = await this.client.writeContract({
      address: this.contractAddress,
      functionName,
      args,
      value,
      ...(fees ? { fees } : {}),
    });
    const receipt = await this.client.waitForTransactionReceipt({
      hash: txHash,
      status: "ACCEPTED" as any,
      retries: 24,
      interval: 5000,
    });
    return receipt as TransactionReceipt;
  }

  async getBountyCount(): Promise<number> {
    this.requireAddress();
    const count = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_bounty_count",
      args: [],
    });
    return Number(count);
  }

  async getBounty(bountyId: number): Promise<Bounty> {
    this.requireAddress();
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_bounty",
      args: [bountyId],
    });
    return bountyFromRaw(raw);
  }

  async getAllBounties(): Promise<Bounty[]> {
    this.requireAddress();
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_all_bounties",
      args: [],
    });
    const obj = toPlain(raw) as Record<string, any>;
    return Object.values(obj)
      .map((b: any) => bountyFromRaw(b))
      .sort((a, b) => a.id - b.id);
  }

  async createBounty(
    title: string,
    rubric: string,
    rewardWei: bigint
  ): Promise<TransactionReceipt> {
    return this.write("create_bounty", [title, rubric], rewardWei);
  }

  async submitDeliverable(
    bountyId: number,
    deliverable: string,
    evidenceUrl: string
  ): Promise<TransactionReceipt> {
    return this.write("submit_deliverable", [bountyId, deliverable, evidenceUrl]);
  }

  async judgeBounty(bountyId: number): Promise<TransactionReceipt> {
    return this.write("judge_bounty", [bountyId]);
  }

  async cancelBounty(bountyId: number): Promise<TransactionReceipt> {
    return this.write("cancel_bounty", [bountyId]);
  }
}

export default BountyJudge;
