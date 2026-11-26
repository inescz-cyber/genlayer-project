# Demo video — storyboard + script (≤45s)

## Format
- 16:9, 1080p, ≤45 seconds. Motion-graphics video built with Hyperframes
  (HTML/CSS/JS → MP4) from real on-chain evidence (tx hashes, addresses,
  verdicts). No voiceover; bold on-screen captions + the three logos.
- Logos (all local, verified SVG): `internet-court-logo.svg`,
  `genlayer-logo.svg`, `kleros-logo.svg`.

## Verified facts to show (fill in Kleros ids after the appeal runs)

- GenLayer contract (Studionet): `0x24Dac525620FEf55A65508B6F26Bf6B2DE03516b`
- Bounty #1: "Document BountyJudge in the public repo README", reward 1 GEN
- GenLayer verdict: **accepted** — "Rubric items met: 1, 2, 3."
  - create tx `0xb7594a583c44c335c0ba3061a5ed59c98053733edb51c170633e0be687ec58f7`
  - submit tx `0x0e618c66d5f8cde07bcd229dd0fff56548d2ebbee80ee8233a5ceb44849a6597`
  - judge tx `0x575c984aa33f972dccfc16bea3b70805d827bf21d73180ee719a651b60cdaec9`
- Kleros dispute: id **220** (Agentic Commerce Court, id 8, Arbitrum Sepolia)
  - create tx `0xa67ce300ea6e00d7b889fec7b206f42a7d61f8b1265858faa0630c70716d52d3`, case URL `https://v2.kleros.builders/#/cases/220`
  - arbitration cost 0.00135 ETH, 5 jurors
- Kleros ruling: **0 = Refuse to Arbitrate → GenLayer verdict stands** (the GenLayer "accepted" verdict holds, so the hunter is paid 1 GEN)
- GenLayer resolve tx: `0x6518c0c4858b2b22b9b6bebc230a606d86fbcacc004600f76fc19ef902756e15` — bounty #1 status "accepted", hunter paid 1 GEN (verified on-chain)

## Scenes (45s total)

| t | Visual | Caption |
|---|---|---|
| 0–4s | Three logos in a row on dark background: Internet Court · GenLayer · Kleros. Title card. | "Two courts. One bounty. A verdict that sticks." |
| 4–10s | GenLayer panel: bounty #1 card (title, rubric 1-2-3, 1 GEN escrow). | "A bounty is posted on GenLayer. 1 GEN locked in escrow." |
| 10–16s | Hunter submits; AI jury verdict card: "accepted — Rubric items met: 1, 2, 3." | "GenLayer's AI jury rules: accepted. But the poster appeals." |
| 16–24s | Arrow GenLayer → Kleros. Kleros case card: Agentic Commerce Court, dispute #220, 5 jurors, 0.00135 ETH. | "The appeal goes to Kleros Court — human jurors, on Arbitrum Sepolia." |
| 24–32s | Juror votes animate (5 juror dots → ruling). Ruling card: "Refuse to Arbitrate — GenLayer verdict stands". | "Five jurors vote. Kleros rules: Refuse to Arbitrate. GenLayer verdict stands." |
| 32–40s | Arrow Kleros → GenLayer. GenLayer bounty card flips to "accepted", 1 GEN paid to the hunter. Tx hash shown. | "The ruling executes back on GenLayer. Escrow paid. Case closed." |
| 40–45s | Three logos again + repo URL + "Testnet demo — Internet Court Partner Demo Lab". | "BountyJudge × Kleros. Built on GenLayer. github.com/inescz-cyber/genlayer-project" |

## Build
- Tool: Hyperframes (`hyperframes` skill, CLI 0.9.92) — HTML/CSS/JS scenes
  rendered to MP4. Fallback: Remotion.
- Screen evidence: terminal/CLI output for the GenLayer txs is already
  captured in this repo's run log; Kleros case page + Arbiscan tx pages
  are captured as screenshots once the dispute exists (parent agent /
  browser task — a subagent cannot screenshot a live browser).
- Narration: none (captions only). Music: none (keep it clean) or a
  single royalty-free bed if the builder adds one.

## Status
- Storyboard + script: DONE (this file).
- Logos: DONE (3 verified SVGs in this directory).
- GenLayer half: VERIFIED live (bounty #1 judged "accepted").
- Kleros half: DONE 2026-11-26 ~20:42 WIB — dispute 220 ruled 0 (Refuse to Arbitrate, GenLayer verdict stands); resolve tx 0x6518c0c4858b2b22b9b6bebc230a606d86fbcacc004600f76fc19ef902756e15; bounty #1 "accepted", hunter paid 1 GEN (verified on-chain). All `<FILL>` values above are now real.
- Video: build from this storyboard with Hyperframes (logos + captions + tx hashes, no voiceover, ≤45s, 16:9 1080p).
- Repo push + Portal submit (Mission 101, deadline Nov 30): repo module push via browser web UI; user submits the Portal form himself as 0xsyifa.
