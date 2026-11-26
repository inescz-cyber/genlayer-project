# BountyJudge — GenLayer Portal submission (exact form text)

The user submits this form themselves in their GenLayer Portal account
(handle **0xsyifa**). Nothing in this repo submits it. Character limits are
checked below each field.

## Project name

```
BountyJudge
```

## Primary tag (suggestion)

```
AI / Agents
```

(Alternative if the form's tag list differs: `DeFi` is wrong; use the
closest tag for "AI judging / escrow". The project is an AI-judged escrow
for bounties.)

## One-liner (≤180 chars)

```
On-chain AI judge for bounties: post a rubric, lock GEN in escrow, and let an Intelligent Contract fetch the evidence, judge the work, and pay or refund automatically.
```

## Description (≤1000 chars)

```
BountyJudge is an on-chain AI bounty judge. A poster creates a bounty with a numbered rubric and locks testnet GEN in escrow. A hunter submits a deliverable (summary + evidence URL). The Intelligent Contract fetches the evidence page, asks an LLM to judge it against the rubric, and records a structured verdict on-chain. If accepted, escrow pays the hunter; if rejected, the full reward is refunded to the poster — funds are never stuck. The verdict is consensus-checked: the LLM returns only structured JSON (verdict + rubric item numbers met/failed) under strict_eq, and the reasons string is built deterministically in the contract. A React frontend (genlayer-js) lets anyone create bounties, submit deliverables, and trigger judging — every state shown comes from the contract. Testnet only (Bradbury).
```

## Demo video

(Optional — leave blank. The evidence below is the repo + live contract.)

## How-to steps (for the steward)

```
1. Open the frontend (see Website link) and connect MetaMask on the Bradbury testnet (chain 4221). Get testnet GEN from https://testnet-faucet.genlayer.foundation if needed.
2. Paste the deployed contract address in the app's Contract box (or it is pre-configured via VITE_CONTRACT_ADDRESS).
3. Create a bounty: title "Build a landing page", rubric "1) Page renders. 2) Signup form present. 3) No placeholder text.", reward 1 GEN. Confirm the transaction — the reward is locked in escrow.
4. From a different wallet (or the same one after noting the poster cannot submit their own bounty), open the bounty and Submit deliverable with a summary and a real public evidence URL, e.g. https://example.com.
5. Click Judge (AI). Wait for the transaction to be accepted, then Refresh: the bounty shows verdict accepted/rejected with reasons, and the escrow has paid the hunter or refunded the poster.
6. Optionally: create another bounty and Cancel it as the poster to see the full refund.
```

## Expected verification outcome (what the steward should see)

```
- The contract address on the Bradbury explorer shows the BountyJudge deployment and its transactions.
- get_bounty_count returns the number of bounties created; get_all_bounties returns each bounty with title, rubric, reward, status, hunter, deliverable, evidence_url, verdict and reasons.
- After step 5, the judged bounty has status accepted or rejected, a verdict, and a deterministic reasons string such as "Rubric items met: 1, 2. Items failed: 3." — and the hunter's balance increased by the reward (accepted) or the poster's balance was refunded (rejected).
- The frontend shows only on-chain state; no fake or placeholder data.
```

## Contract links

```
Contract source: contracts/BountyJudge.py in the GitHub repo below.
Explorer link format (Bradbury): https://explorer-bradbury.genlayer.com/address/<DEPLOYED_CONTRACT_ADDRESS>
(Replace <DEPLOYED_CONTRACT_ADDRESS> with the address from the deploy step; the frontend's .env holds the same address.)
```

## Website link (REQUIRED)

```
<URL where the frontend is hosted, e.g. the Vercel/Netlify deployment of frontend/>
(Deploy the frontend from this repo — e.g. `npm run build` in frontend/ and host dist/ — then paste that URL here.)
```

## GitHub link

```
<URL of the pushed GitHub repo, e.g. https://github.com/ariiescz/bounty-judge>
(The repo is ready to push; the user creates it and pushes it themselves — no GitHub credentials on the build machine.)
```

## Evidence

```
GitHub repo URL (same as above): <https://github.com/ariiescz/bounty-judge>
Repo contains: contracts/BountyJudge.py, frontend/ (Vite + React + genlayer-js, builds clean), tests/direct/test_bounty_judge.py (14 Direct Mode tests, all passing), README.md with Studio test steps and Bradbury deploy steps.
```
