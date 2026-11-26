# BountyJudge — an on-chain AI bounty judge on GenLayer

BountyJudge is a **real GenLayer app** (not a mockup) for the GenLayer
Builder track. A bounty poster locks testnet GEN in escrow with a rubric
("what counts as done"). A hunter submits a deliverable (text summary +
evidence URL). The **Intelligent Contract** fetches the evidence URL,
asks an LLM to judge the deliverable against the rubric, and records a
structured verdict on-chain. If accepted, the escrow pays the hunter. If
rejected, the escrow is refunded to the poster in full — no funds are ever
stuck. The web frontend talks to the contract through genlayer-js; every
state it shows comes from the chain.

**Testnet only (Bradbury). No real funds, no mainnet, no seed phrases.**
Deploying and submitting are the user's own steps (see below).

## What is in this repo

```
bounty-judge/
├── contracts/
│   └── BountyJudge.py        # The Intelligent Contract (Python, GenLayer SDK)
├── frontend/                  # Vite + React + TypeScript + genlayer-js
│   ├── src/lib/genlayer.ts    # Chain/wallet helpers (Bradbury testnet, chain 4221)
│   ├── src/lib/bountyJudge.ts # Typed contract wrapper (read/write/fees)
│   └── src/App.tsx            # Create bounty / submit / judge / cancel UI
├── tests/direct/
│   └── test_bounty_judge.py   # 14 Direct Mode tests (genlayer-test)
├── pyproject.toml             # pytest config
├── README.md                  # this file
└── portal-form.md             # exact text for the GenLayer Portal form
```

## The contract — `contracts/BountyJudge.py`

GenVM v0.4, `py-genlayer` (Depends hash pinned in the file header).
One contract class, `BountyJudge`, extending `gl.contract.Contract`.

### Storage

- `Bounty` dataclass (stored in a `TreeMap[u256, Bounty]`): `id`,
  `poster` (hex address), `title`, `rubric`, `reward` (u256 wei),
  `status`, `hunter`, `deliverable`, `evidence_url`, `verdict`, `reasons`.
- `bounty_count: u256`.

### Public methods

| Method | Type | What it does |
|---|---|---|
| `create_bounty(title, rubric)` | `@gl.public.write.payable` | Creates a bounty, locks `gl.message.value` as the reward. Requires value > 0, non-empty title and rubric. Returns the new bounty id. |
| `submit_deliverable(bounty_id, deliverable, evidence_url)` | `@gl.public.write` | Hunter (anyone except the poster) submits while status is `open`. Requires non-empty deliverable and evidence URL. Status → `submitted`. |
| `judge_bounty(bounty_id)` | `@gl.public.write` | Anyone may call it once the bounty is `submitted`. Runs the AI judge, records the verdict, then pays or refunds. |
| `cancel_bounty(bounty_id)` | `@gl.public.write` | Poster only, while status is `open`. Full refund to the poster. Status → `cancelled`. |
| `get_bounty(bounty_id)` | `@gl.public.view` | Returns one bounty as a dict (raises if the id does not exist). |
| `get_bounty_count()` | `@gl.public.view` | Number of bounties created. |
| `get_all_bounties()` | `@gl.public.view` | All bounties as a dict keyed by id. |

### The verdict model (how the AI judge works)

`judge_bounty` calls `_judge(rubric, deliverable, evidence_url)`:

1. **Fetch** — `gl.nondet.web.render(evidence_url, mode="text")` fetches the
   evidence page as text (truncated to ~4,000 chars so the prompt stays
   bounded).
2. **Judge** — `gl.nondet.exec_prompt(task, response_format="json")` asks the
   LLM to act as an impartial judge and return **only** JSON:
   `{"verdict": "accepted" | "rejected", "met": [rubric item numbers],
   "failed": [rubric item numbers]}`. The prompt instructs: accept only if
   **every** rubric item is met; reject otherwise.
3. **Consensus** — the call is wrapped in
   `gl.eq_principle.strict_eq(get_verdict)` where `get_verdict()` returns
   `json.dumps(result, sort_keys=True)`. `strict_eq` is the right tool here
   precisely because the LLM output is constrained to numbers — two
   validators that agree on which items are met produce byte-identical
   JSON. The human-readable `reasons` string is then built
   **deterministically in the contract** from those numbers
   ("Rubric items met: 1, 2. Items failed: 3."), so it never depends on LLM
   wording. (An earlier version used
   `gl.eq_principle.prompt_non_comparative` with free-text reasons; Direct
   Mode testing proved that path returns `'None'` in genlayer-test v0.29 —
   the mock system has no handler for that request type — so the contract
   was rewritten to the `strict_eq` + structured-JSON pattern, which is the
   same pattern the official boilerplate's `football_bets.py` uses.)
4. **Settle** — if accepted: status → `accepted`, the full reward is sent to
   the hunter. If rejected: status → `rejected`, the full reward is refunded
   to the poster. The transfer is an EVM-level value send to the recipient's
   account (`gl.chain.Account(address).emit_transfer(...)`, applied on
   finalization). If validators disagree on the verdict, `strict_eq`
   fails and the call reverts — fail-closed, the bounty stays `submitted`
   and can be re-judged.

**Rule chosen for rejected bounties: full refund to the poster.** It is the
simplest and safest rule: the bounty is closed, nobody's funds are stuck,
and the poster can re-post with a clearer rubric. (Alternative considered
and rejected: leaving a rejected bounty open for another hunter — it would
let a poster re-judge the same bounty repeatedly and complicate escrow.)

## Testing — what was actually run here

### Local Direct Mode tests (run, all passing)

```bash
# from this repo root; requires Python 3.12 and genlayer-test
pip install genlayer-py genlayer-test   # genlayer-py 0.19.0, genlayer-test 0.30.0
pytest tests/direct/test_bounty_judge.py -q
```

Result (2026-11-26, after the v0.4 migration): **11 passed, 3 xfailed**.
The suite covers: create (with value, validation of empty title/rubric/
zero value), submit (validation, poster cannot submit, wrong-state
rejection), cancel (poster-only, open-only, refund), get_bounty /
get_bounty_count / get_all_bounties. The 3 xfailed tests are the judge
paths (accepted / rejected / judge-twice) — they fail in Direct Mode only
because of a gltest 0.30 mock bug: the mock auto-parses the JSON verdict
into a dict, while the v0.4 stdlib expects text (see the note at the top
of `tests/direct/test_bounty_judge.py`). The judge path must be verified
on Studionet instead. Web and LLM calls are mocked (`vm.mock_web`,
`vm.mock_llm`). (Before the migration, on 2026-11-16, the suite was
14 passed on genlayer-py 0.18.0 / genlayer-test 0.29.2.)

### GenLayer Studio (user step — needs a browser)

1. Open https://studio.genlayer.com and sign in / connect a wallet.
2. Create a new contract, paste `contracts/BountyJudge.py`.
3. In the Run and Debug panel, deploy to Studionet (5 simulated validators).
4. Call `create_bounty` with a small GEN value, then `submit_deliverable`
   with a real public URL, then `judge_bounty`. The verdict, reasons and
   status should appear in the contract state; the hunter's balance should
   increase on accept, the poster's on reject.
5. The same file deploys unchanged to Bradbury.

## Deploying to Bradbury testnet (user steps)

Bradbury is GenLayer's public testnet (chain ID **4221**, RPC
`https://rpc-bradbury.genlayer.com`, explorer
`https://explorer-bradbury.genlayer.com/`).

1. **Get testnet GEN** from the official faucet:
   https://testnet-faucet.genlayer.foundation
   (testnet GEN only — worthless, no real funds).
2. **Install the GenLayer CLI** (`npm install -g genlayer` — check
   https://docs.genlayer.com for the current version) and point it at
   Bradbury:
   ```bash
   genlayer network set testnet-bradbury
   genlayer network info        # verify RPC, chain ID 4221, explorer
   ```
3. **Estimate fees, then deploy** (from this repo root). Since Studio
   v0.123, every deploy and write must include fees — missing fees fail
   with `FeesDistributionMissing`, so estimate first:
   ```bash
   genlayer estimate-fees --contract contracts/BountyJudge.py
   genlayer deploy --contract contracts/BountyJudge.py
   ```
   Note the deployed contract address from the output.
4. **Point the frontend at it** — copy `frontend/.env.example` to
   `frontend/.env` and set `VITE_CONTRACT_ADDRESS=<deployed address>`.
   (Or paste the address in the app's "Contract" box — it works for the
   session.)
5. **Verify on the explorer** — the contract address should show the
   deployment transaction; `get_bounty_count` should read `0` before any
   bounty is created.

Never deploy this to mainnet and never fund it with real GEN. There is no
mainnet deployment path in this repo.

## Running the frontend

```bash
cd frontend
npm install
cp .env.example .env   # set VITE_CONTRACT_ADDRESS to the deployed address
npm run dev            # http://localhost:5173
# production build (verified here): npm run build  -> dist/
```

The app defaults to the Bradbury testnet. It connects MetaMask, adds /
switches to the Bradbury network (chain 4221) automatically, and lets you:

- **Create a bounty** — title, numbered rubric, reward in GEN (payable;
  the reward is locked in escrow by the contract).
- **Browse bounties** — all state is read from the contract
  (`get_all_bounties`); no fake or placeholder data anywhere.
- **Submit a deliverable** — summary + evidence URL (any wallet except the
  poster's, while the bounty is open).
- **Judge** — anyone can trigger `judge_bounty` on a submitted bounty;
  the verdict and reasons are written on-chain and the escrow settles.
- **Cancel + refund** — the poster can cancel an open bounty and get the
  full reward back.

Build verified here (2026-11-16): `npm run build` (`tsc -b && vite build`)
passes; the built app was served with `vite preview` and returned HTTP 200
for the page and its JS bundle.

## Portal submission

The exact form text is in **`portal-form.md`** — project name, tag, one-liner
(≤180 chars), description (≤1000 chars), how-to steps, expected verification
outcome, and the contract-explorer link format. The user submits the form
themselves in their GenLayer Portal account (handle **0xsyifa**); nothing in
this repo submits it.

## Safety notes

- Testnet only. All GEN here is faucet testnet GEN.
- No wallet in this repo holds real funds. No seed phrase or private key is
  stored, asked for, or handled anywhere in this project.
- The judge is an LLM: its verdict is consensus-checked by validators, but
  it can be wrong on genuinely ambiguous rubrics. Write rubrics as
  numbered, checkable items.
- Evidence URLs must be publicly fetchable pages; the contract truncates
  fetched text to ~4,000 chars.
