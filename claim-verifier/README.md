# ClaimVerifier — a reusable on-chain fact-checking primitive

A standalone GenLayer Intelligent Contract (GenVM v0.4, Studio v0.123) for
the Portal's **Intelligent Contracts** category. It is a separate project
from BountyJudge: no bounty, no escrow, no rubric, no hunter — pure
verification.

## What it does

Anyone submits a factual claim plus the source URLs it should be checked
against. Anyone can then call `verify_claim`: the contract fetches the
sources, asks an LLM to judge the claim, and records a structured verdict
on-chain.

- **supported** — the sources back the claim.
- **refuted** — the sources contradict the claim.
- **unverifiable** — the sources do not contain enough information to decide.

Each verified claim also records a **confidence** score (0–100) and a
human-readable **reasons** string built deterministically from the verdict.

## Why it is useful

It is a building block other agents and apps can reuse:

- **AI agents** can check a claim before acting on it ("is this price /
  date / fact true?").
- **Content pipelines** can verify statements before publishing.
- **Other contracts** can read verdicts as an oracle for real-world facts.

## How consensus is used

Verification uses `gl.eq_principle.strict_eq` over a strictly-structured
verdict. The leader's LLM returns ONLY JSON — a verdict, a confidence
score, and the indices of the sources that support / refute the claim —
no free text — normalised with `json.dumps(sort_keys=True)` before
consensus, so validators agree whenever they agree on the substance.

The human-readable reasons string is then built deterministically in the
contract from those values (e.g. `"Claim supported. Sources supporting:
0, 1. Sources refuting: none. Confidence: 85%."`), so it never depends
on LLM wording. `strict_eq` is the right tool here precisely because the
output is constrained to a verdict plus numbers; free-text reasons would
need the criteria-based `prompt_non_comparative` instead.

Non-deterministic work (web fetch, LLM call) happens inside the function
the equivalence principle invokes, so validators re-run it independently.
Each source page is fetched with `gl.nondet.web.render(url, mode="text")`
and truncated to its first 2000 characters before being put in the prompt.

The contract has **NO owner/admin**: after deployment nobody has special
power over it. Testnet only.

## Contract API

| Function | Type | Description |
| --- | --- | --- |
| `submit_claim(claim_text, source_urls)` | write | Store a claim (status `submitted`), returns the claim id. Requires non-empty text and at least one source URL. |
| `verify_claim(claim_id)` | write | Fetch the sources, run the LLM judge under consensus, record verdict + confidence + reasons, status becomes `verified`. Fails if the claim does not exist or is already verified. |
| `get_claim(claim_id)` | view | Full claim record (id, submitter, claim_text, source_urls, status, verdict, confidence, reasons). |
| `get_claim_count()` | view | Number of claims submitted. |
| `get_all_claims()` | view | All claims, keyed by id. |

Notes:

- A claim whose source URLs cannot be loaded (404, unreachable page)
  cannot be verified — the verify call reverts. Use loadable public
  pages as sources.
- `verify_claim` may be called by anyone; there is no restricted role.
- Storage note: source URLs are stored as a single newline-delimited
  string inside the claim record (GenVM v0.4 storage has no plain `list`
  type, and `DynArray` cannot be user-instantiated), and split back
  into a list on read — the API still takes and returns a list.

## Tests

Direct Mode tests live in `tests/direct/` (genlayer-test 0.30.0).

```bash
python3 -m venv .venv
.venv/bin/pip install genlayer-py==0.19.0 genlayer-test==0.30.0 pytest
.venv/bin/python -m pytest tests -v
```

Expected: deterministic tests pass (submit, empty claim / no sources,
invalid ids, get_all_claims). The four verify tests
(`test_verify_supported`, `test_verify_refuted`,
`test_verify_unverifiable`, `test_verify_twice_fails`) are marked
`xfail(strict=True)` — NOT because the contract is wrong, but because of
a harness bug in gltest 0.30's Direct Mode mock: its `_handle_llm_request`
auto-parses a valid-JSON mock string into a dict and returns
`{"ok": dict}`, while the v0.4 stdlib's `exec_prompt(response_format="json")`
decodes via `_decode_nondet_json`, which requires the `ok` value to be
TEXT (it runs `json.loads` itself). Result: `NondetException: JSON result
is not text` before the contract ever sees the verdict. On the real
network (Studio/Bradbury) the LLM returns text and the stdlib parses it,
so the contract is correct — the verify path must be verified on
Studionet (below), not in Direct Mode, until gltest fixes the mock
handler.

## Deploy (Studionet)

Studionet (chain 61999) is gasless. Requires the `genlayer` CLI 0.40.1
(`npm install -g genlayer` if missing) and a funded/keystore account.

```bash
genlayer network set studionet
genlayer deploy --contract contracts/ClaimVerifier.py
genlayer call <CONTRACT_ADDRESS> get_claim_count
```

## Studionet deployment

- Contract address: **0x14B2376778E406Ce64F8f3901b42B7BE64da491d**
- Deploy tx: **0x4bbaf115c64a0d3826def4bb179ee9abdf58f7385c2f516040d50e837f185693**
- Consensus: **ACCEPTED** (validator votes AGREE/IDLE/IDLE/AGREE/AGREE, lifecycle decided/accepted)
- Verified live 2026-11-26 ~17:15 WIB: `get_claim_count` returns 0 (deployed 2026-11-26, deployer bountyjudge-deployer 0x283657b980ab88b8a39ebd9e070d301d116d640e)
- **Live verify VERIFIED 2026-11-26 ~17:20 WIB (first end-to-end judge check):** claim 0 "The Eiffel Tower is in Paris." (source https://en.wikipedia.org/wiki/Eiffel_Tower) — submit ACCEPTED, `verify_claim` ACCEPTED, read-back shows status `verified`, verdict `supported`, confidence 100, reasons "Claim supported. Sources supporting: 0. Sources refuting: none. Confidence: 100%." The judge path works live on Studionet (the Direct Mode xfail tests above only fail in the gltest mock, not on the real network).

## Portal submission

Submit under the **Intelligent Contracts** contribution type with:

- Contract source: `contracts/ClaimVerifier.py` in the repo
- Tests: `tests/direct/test_claim_verifier.py` (Direct Mode; see the xfail note above)
- This README (purpose, consensus design, usage, test/deploy steps)
- Studionet contract address + explorer link once deployed

The user submits the Portal form themselves; nothing in this repo
submits it.
