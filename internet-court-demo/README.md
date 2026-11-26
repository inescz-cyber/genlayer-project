# Internet Court × GenLayer × Kleros — BountyJudge Appeal Demo

**Mission:** GenLayer Portal, Builders Working Group — Internet Court:
Partner Demo Lab (ends Nov 30, 2026, 300 pts).

**One line:** GenLayer's AI jury is the first-instance judge for a bounty
dispute; a disputed verdict escalates to a Kleros human jury for appeal,
and the Kleros ruling executes back on GenLayer.

## The flow

```
Poster creates bounty (GEN locked in escrow)      GenLayer / Studionet
        │
Hunter submits deliverable + evidence URL          GenLayer / Studionet
        │
GenLayer AI jury judges (strict_eq JSON verdict)   GenLayer / Studionet
        │  status "judged" — escrow stays locked
        ├─ no appeal → finalize_bounty pays per GenLayer verdict
        │
        └─ appeal → relay creates a Kleros dispute
                        │
                   Kleros Court V2, Agentic Commerce Court (id 8)
                   Arbitrum Sepolia — 5 jurors, ~1–2h to a ruling
                   ruling 1 = refund poster, 2 = pay hunter
                        │
                   relay reads the ruling on-chain
                        │
                   resolve_appeal executes it on GenLayer
```

## Why this partner, why this court

- **Kleros** is an Internet Court consortium member (appeals layer).
- **Agentic Commerce Court (id 8)** is the live court for agent commerce:
  verified 2026-11-26 via the Kleros CLI — 152 active disputes, disputes
  created 2026-11-25 were ruled and executed the same day (~1h), 5 jurors,
  fee 0.00027 ETH/juror. The General Court (id 1) has 0 staked jurors and
  43 stuck disputes — it cannot rule on testnet. Court 8 is the one that
  actually resolves.
- **No custom arbitrable deployment needed.** Disputes are created through
  Kleros's already-deployed, whitelisted `DisputeResolver`
  (`0xed31bEE8b1F7cE89E93033C0d3B2ccF4cEb27652`) — it registers the dispute
  template on the fly and calls `KlerosCore.createDispute`. This sidesteps
  the V2 arbitrable-whitelisting requirement for custom contracts.
- **Arbitration cost** (court 8, 5 jurors, Classic kit): **0.00135 ETH**
  on Arbitrum Sepolia testnet. Verified by `arbitrationCost` eth_call.
  extraData encoding is `abi.encode(uint256 court, uint256 minJurors,
  uint256 kit)` — verified empirically (the packed-uint96 encoding in some
  Kleros docs returns the wrong court's fee on this deployment).

## Contracts

| Piece | Chain | Address / file |
|---|---|---|
| AppealableBountyJudge (GenVM v0.4) | GenLayer Studionet (61999) | `0x24Dac525620FEf55A65508B6F26Bf6B2DE03516b` |
| KlerosCore (V2 proxy) | Arbitrum Sepolia (421614) | `0xE8442307d36e9bf6aB27F1A009F95CE8E11C3479` |
| DisputeResolver | Arbitrum Sepolia (421614) | `0xed31bEE8b1F7cE89E93033C0d3B2ccF4cEb27652` |
| Dispute template (JSON) | — | `contracts/BountyJudgeAppeal.template.json` |
| Dispute policy | — | `POLICY.md` |

GenLayer contract source: `contracts/AppealableBountyJudge.py`.
Direct-mode tests: `tests/` — 11 passed, 5 xfailed (gltest 0.30 mock bug,
same as BountyJudge; judge path verified live on Studionet instead).

## Relay

`relay/relay.js` (Node, ethers v6 + genlayer CLI + genlayer-js SDK).

```
# one-time: fund the relay key with ~0.01 Arbitrum Sepolia testnet ETH
export ARBITRUM_SEPOLIA_PRIVATE_KEY=<testnet-only key>
export GENLAYER_CONTRACT=0x24Dac525620FEf55A65508B6F26Bf6B2DE03516b

node relay.js cost                 # arbitration cost (0.00135 ETH)
node relay.js status <bountyId>    # GenLayer + Kleros state
node relay.js appeal <bountyId>    # create Kleros dispute + record appeal
node relay.js resolve <bountyId>   # read Kleros ruling, execute on GenLayer
node relay.js finalize <bountyId>  # no appeal: pay per GenLayer verdict
```

`relay/genlayer-write.js` — payable GenLayer writes via the genlayer-js
SDK (the `genlayer` CLI has no `--value` flag). It decrypts the
bountyjudge-deployer keystore in memory; the private key is never printed.

`relay/verify-kleros.js` and `relay/verify-extradata.js` — the live
verifications behind the numbers above (court list, dispute 219, fee
encoding). Re-run them any time to re-check the court.

## Demo run (testnet)

1. Create a bounty (1 GEN reward) on Studionet:
   `node relay/genlayer-write.js <contract> create_bounty 1 "Build a landing page" "1) Page renders. 2) Has a signup form. 3) Loads in under 2s."`
2. Submit a deliverable (a second account / the hunter):
   `genlayer write <contract> submit_deliverable --args 0 "Landing page built." "https://example.com/landing"`
3. Judge: `genlayer write <contract> judge_bounty --args 0` → status "judged".
4. Appeal: `node relay.js appeal 0` → Kleros dispute created (tx hash +
   case URL printed), GenLayer status "appealed".
5. Wait ~1–2h for the Kleros jurors. `node relay.js status 0` to poll.
6. Resolve: `node relay.js resolve 0` → Kleros ruling executes on GenLayer.

## Trust model (demo)

GenLayer cannot read Arbitrum, so the relay is a trusted off-chain bridge.
It reads the Kleros ruling **on-chain** (DisputeResolver.disputes +
KlerosCore.currentRuling) before submitting it to GenLayer, and prints
every transaction hash so each step is independently verifiable. A
production version would verify the ruling with a light client or an
attestation instead of trusting the relayer.

## Budget

Zero. Testnet only — GenLayer Studionet (gasless) + Arbitrum Sepolia
testnet ETH (free faucet). No mainnet, no paid services.

## Links

- Kleros Court V2 docs: https://docs.kleros.io
- KlerosCore (Arbitrum Sepolia): https://sepolia.arbiscan.io/address/0xE8442307d36e9bf6aB27F1A009F95CE8E11C3479
- DisputeResolver (Arbitrum Sepolia): https://sepolia.arbiscan.io/address/0xed31bEE8b1F7cE89E93033C0d3B2ccF4cEb27652
- GenLayer contract (Studionet): https://studio.genlayer.com (contract 0x24Dac525620FEf55A65508B6F26Bf6B2DE03516b)
- BountyJudge repo: https://github.com/inescz-cyber/genlayer-project
