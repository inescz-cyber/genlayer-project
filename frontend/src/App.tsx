import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectWallet,
  getAccounts,
  getChainId,
  getContractAddress,
  getExplorerUrl,
  isMetaMaskInstalled,
} from "./lib/genlayer";
import { BountyJudge, type Bounty } from "./lib/bountyJudge";

const WEI_PER_GEN = 10n ** 18n;

function fmtGen(wei: bigint): string {
  const whole = wei / WEI_PER_GEN;
  const frac = wei % WEI_PER_GEN;
  if (frac === 0n) return `${whole} GEN`;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 4);
  return `${whole}.${fracStr} GEN`;
}

function shortAddr(addr: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "submitted":
      return "Submitted — awaiting judge";
    case "accepted":
      return "Accepted — paid";
    case "rejected":
      return "Rejected — refunded";
    case "cancelled":
      return "Cancelled — refunded";
    default:
      return status;
  }
}

export default function App() {
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [contractAddress, setContractAddress] = useState<string>(
    getContractAddress()
  );
  const [addressInput, setAddressInput] = useState<string>(getContractAddress());
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Create-bounty form
  const [title, setTitle] = useState("");
  const [rubric, setRubric] = useState(
    "1) The deliverable is complete.\n2) The evidence link shows the finished work.\n3) No placeholder or lorem ipsum text."
  );
  const [rewardGen, setRewardGen] = useState("1");

  // Submit-deliverable form (per bounty, keyed by id)
  const [submittingFor, setSubmittingFor] = useState<number | null>(null);
  const [deliverable, setDeliverable] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  const judge = useMemo(
    () => new BountyJudge(contractAddress || undefined, account || undefined),
    [contractAddress, account]
  );

  const refresh = useCallback(async () => {
    if (!contractAddress) {
      setBounties([]);
      return;
    }
    setLoading(true);
    try {
      const list = await judge.getAllBounties();
      setBounties(list);
    } catch (e: any) {
      setNotice({ kind: "err", text: `Failed to load bounties: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, [judge, contractAddress]);

  useEffect(() => {
    getAccounts().then((accs) => {
      if (accs[0]) setAccount(accs[0]);
    });
    setChainId(getChainId());
    refresh();
  }, [refresh]);

  useEffect(() => {
    const provider = (window as any).ethereum;
    if (!provider?.on) return;
    const onAccounts = (accs: string[]) => setAccount(accs[0] || "");
    const onChain = () => window.location.reload();
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, []);

  async function onConnect() {
    setNotice(null);
    try {
      const addr = await connectWallet();
      setAccount(addr);
      setChainId(await getChainId());
      setNotice({ kind: "ok", text: `Connected as ${addr}` });
    } catch (e: any) {
      setNotice({ kind: "err", text: e.message });
    }
  }

  function onSaveAddress() {
    const addr = addressInput.trim();
    if (addr && !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setNotice({ kind: "err", text: "Contract address must be a 0x address (40 hex chars)." });
      return;
    }
    setContractAddress(addr);
    setNotice({
      kind: "ok",
      text: addr ? "Contract address saved for this session." : "Contract address cleared.",
    });
  }

  async function runAction(label: string, fn: () => Promise<any>, doneMsg: string) {
    setBusy(label);
    setNotice(null);
    try {
      await fn();
      setNotice({ kind: "ok", text: doneMsg });
      await refresh();
    } catch (e: any) {
      setNotice({ kind: "err", text: `${label} failed: ${e.message}` });
    } finally {
      setBusy("");
    }
  }

  async function onCreateBounty(e: React.FormEvent) {
    e.preventDefault();
    if (!account) {
      setNotice({ kind: "err", text: "Connect your wallet first." });
      return;
    }
    const rewardWei = BigInt(Math.round(parseFloat(rewardGen) * 1e18));
    if (rewardWei <= 0n) {
      setNotice({ kind: "err", text: "Reward must be greater than 0 GEN." });
      return;
    }
    await runAction("create", () => judge.createBounty(title.trim(), rubric.trim(), rewardWei), "Bounty created — reward locked in escrow.");
    setTitle("");
  }

  async function onSubmitDeliverable(bountyId: number) {
    if (!account) {
      setNotice({ kind: "err", text: "Connect your wallet first." });
      return;
    }
    await runAction(
      `submit-${bountyId}`,
      () => judge.submitDeliverable(bountyId, deliverable.trim(), evidenceUrl.trim()),
      "Deliverable submitted — anyone can now call Judge."
    );
    setSubmittingFor(null);
    setDeliverable("");
    setEvidenceUrl("");
  }

  const isPoster = (b: Bounty) =>
    account && b.poster.toLowerCase() === account.toLowerCase();
  const canSubmit = (b: Bounty) => b.status === "open" && account && !isPoster(b);
  const canJudge = (b: Bounty) => b.status === "submitted";
  const canCancel = (b: Bounty) => b.status === "open" && isPoster(b);

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>BountyJudge</h1>
          <p className="subtitle">
            On-chain AI bounty judge on GenLayer. Post a bounty with a rubric,
            lock GEN in escrow — an Intelligent Contract fetches the evidence,
            judges the deliverable, and pays or refunds automatically.
          </p>
        </div>
        <div className="wallet">
          {account ? (
            <>
              <span className="addr">{shortAddr(account)}</span>
              <span className="chain">chain {chainId || "?"}</span>
            </>
          ) : (
            <button onClick={onConnect} disabled={!isMetaMaskInstalled()}>
              Connect MetaMask
            </button>
          )}
          {!isMetaMaskInstalled() && (
            <p className="hint">MetaMask is required to sign transactions.</p>
          )}
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.kind === "ok" ? "notice-ok" : "notice-err"}`}>
          {notice.text}
        </div>
      )}

      <section className="card">
        <h2>Contract</h2>
        <p className="muted">
          Point the app at your deployed BountyJudge contract (Bradbury testnet).
          Explorer:{" "}
          <a href={getExplorerUrl()} target="_blank" rel="noreferrer">
            {getExplorerUrl()}
          </a>
        </p>
        <div className="row">
          <input
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="0x… BountyJudge contract address"
            spellCheck={false}
          />
          <button onClick={onSaveAddress}>Use contract</button>
          <button onClick={refresh} disabled={loading || !contractAddress}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {!contractAddress && (
          <p className="hint">
            No contract configured yet. Deploy contracts/BountyJudge.py to Bradbury
            (see README), then paste its address here.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Create a bounty</h2>
        <form onSubmit={onCreateBounty}>
          <label>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Build a landing page"
              required
            />
          </label>
          <label>
            Rubric — numbered requirements the judge checks
            <textarea
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={4}
              required
            />
          </label>
          <label>
            Reward (GEN, testnet — locked in escrow)
            <input
              value={rewardGen}
              onChange={(e) => setRewardGen(e.target.value)}
              inputMode="decimal"
              placeholder="1"
              required
            />
          </label>
          <button type="submit" disabled={busy === "create" || !account || !contractAddress}>
            {busy === "create" ? "Creating…" : "Create bounty (payable)"}
          </button>
          {!account && <p className="hint">Connect your wallet to create a bounty.</p>}
        </form>
      </section>

      <section className="card">
        <h2>Bounties ({bounties.length})</h2>
        {loading && <p className="muted">Loading…</p>}
        {!loading && bounties.length === 0 && (
          <p className="muted">
            No bounties yet. Create one above — it will appear here once the
            transaction is accepted.
          </p>
        )}
        <div className="bounties">
          {bounties.map((b) => (
            <article key={b.id} className="bounty">
              <div className="bounty-head">
                <h3>
                  #{b.id} — {b.title}
                </h3>
                <span className={`badge badge-${b.status}`}>{statusLabel(b.status)}</span>
              </div>
              <dl>
                <div>
                  <dt>Reward</dt>
                  <dd>{fmtGen(b.reward)}</dd>
                </div>
                <div>
                  <dt>Poster</dt>
                  <dd>{shortAddr(b.poster)}</dd>
                </div>
                <div>
                  <dt>Hunter</dt>
                  <dd>{shortAddr(b.hunter)}</dd>
                </div>
              </dl>
              <p className="rubric">
                <strong>Rubric:</strong> {b.rubric}
              </p>
              {b.deliverable && (
                <p>
                  <strong>Deliverable:</strong> {b.deliverable}{" "}
                  {b.evidence_url && (
                    <a href={b.evidence_url} target="_blank" rel="noreferrer">
                      evidence ↗
                    </a>
                  )}
                </p>
              )}
              {b.verdict && (
                <p className={`verdict verdict-${b.verdict}`}>
                  <strong>Verdict: {b.verdict}</strong> — {b.reasons}
                </p>
              )}
              <div className="actions">
                {canSubmit(b) && (
                  <button onClick={() => setSubmittingFor(submittingFor === b.id ? null : b.id)}>
                    {submittingFor === b.id ? "Cancel" : "Submit deliverable"}
                  </button>
                )}
                {canJudge(b) && (
                  <button
                    onClick={() =>
                      runAction(
                        `judge-${b.id}`,
                        () => judge.judgeBounty(b.id),
                        "Judge finished — verdict recorded on-chain."
                      )
                    }
                    disabled={busy === `judge-${b.id}`}
                  >
                    {busy === `judge-${b.id}` ? "Judging…" : "Judge (AI)"}
                  </button>
                )}
                {canCancel(b) && (
                  <button
                    className="danger"
                    onClick={() =>
                      runAction(
                        `cancel-${b.id}`,
                        () => judge.cancelBounty(b.id),
                        "Bounty cancelled — reward refunded."
                      )
                    }
                    disabled={busy === `cancel-${b.id}`}
                  >
                    Cancel + refund
                  </button>
                )}
              </div>
              {submittingFor === b.id && (
                <div className="submit-form">
                  <label>
                    Deliverable summary
                    <textarea
                      value={deliverable}
                      onChange={(e) => setDeliverable(e.target.value)}
                      rows={3}
                      placeholder="What did you build? Summarise it here."
                      required
                    />
                  </label>
                  <label>
                    Evidence URL (the judge fetches this page)
                    <input
                      value={evidenceUrl}
                      onChange={(e) => setEvidenceUrl(e.target.value)}
                      placeholder="https://…"
                      required
                    />
                  </label>
                  <button
                    onClick={() => onSubmitDeliverable(b.id)}
                    disabled={busy === `submit-${b.id}` || !deliverable.trim() || !evidenceUrl.trim()}
                  >
                    {busy === `submit-${b.id}` ? "Submitting…" : "Submit"}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <footer className="footer">
        <p className="muted">
          Testnet only (Bradbury). Rewards are testnet GEN from the faucet — no
          real funds. If a bounty is rejected, the reward is refunded to the
          poster in full; if accepted, it is paid to the hunter.
        </p>
      </footer>
    </div>
  );
}
