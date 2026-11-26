# { "Depends": "py-genlayer:kzybg95x1gn21dw72m7hyg0maaap04n4nx55j9yt6fkdqxtz6bz0" }

"""AppealableBountyJudge — BountyJudge with a Kleros appeal layer (GenLayer Intelligent Contract).

First instance: the GenLayer AI judge (same as BountyJudge). A poster creates
a bounty with a rubric and locks testnet GEN in escrow; a hunter submits a
deliverable (summary + evidence URL); anyone can call judge_bounty and the
contract's LLM jury records a structured verdict (accepted / rejected).

NEW: the verdict does NOT pay out immediately. Instead the bounty enters
status "judged" and an appeal window opens:

- finalize_bounty — called when nobody appeals: pays out per the GenLayer
  verdict (accepted -> hunter, rejected -> poster) and closes the bounty.
- appeal_bounty — called (by the relay) after a Kleros dispute has been
  created for this bounty on Arbitrum Sepolia: records the Kleros dispute id
  and moves the bounty to status "appealed". The Kleros case is created
  through the already-deployed Kleros DisputeResolver in the Agentic
  Commerce Court (court 8), with the GenLayer verdict + bounty data as
  evidence and ruling options 1 = refund poster, 2 = pay hunter.
- resolve_appeal — called (by the relay) once Kleros jurors have ruled:
  pays per the Kleros ruling (1 -> refund poster, 2 -> pay hunter,
  0 -> GenLayer verdict stands) and closes the bounty.

Trust model (demo): GenLayer cannot read Arbitrum, so the relay is a
trusted off-chain bridge. It reads the Kleros ruling on-chain
(DisputeResolver.disputes + KlerosCore.currentRuling) and submits it here.
A production version would verify the ruling with a light client or an
attestation instead of trusting the relayer.

Judging uses gl.eq_principle.strict_eq over a strictly-structured verdict,
exactly as in BountyJudge: the leader's LLM returns ONLY JSON (verdict +
rubric item numbers met / failed), normalised with json.dumps(sort_keys=True)
before consensus; human-readable reasons are built deterministically
in-contract. Non-deterministic work (web fetch, LLM call) happens inside the
function the equivalence principle invokes.
"""

import json
from dataclasses import dataclass

import genlayer as gl
from genlayer.types import *


@gl.storage.allow
@dataclass
class Bounty:
    id: u256
    poster: str  # hex address of the poster
    title: str
    rubric: str
    reward: u256  # GEN in wei, locked in escrow
    status: str  # open | submitted | judged | appealed | accepted | rejected | resolved | cancelled
    hunter: str  # hex address of the hunter ("" when none)
    deliverable: str
    evidence_url: str
    verdict: str  # accepted | rejected | ""
    reasons: str
    kleros_dispute_id: u256  # Kleros dispute id on Arbitrum Sepolia (0 = none)
    kleros_ruling: u256  # 0 = none/refuse, 1 = refund poster, 2 = pay hunter


class AppealableBountyJudge(gl.contract.Contract):
    bounties: gl.storage.TreeMap[u256, Bounty]
    bounty_count: u256

    def __init__(self):
        self.bounty_count = 0

    @gl.public.write.payable
    def create_bounty(self, title: str, rubric: str) -> u256:
        reward = gl.message.value
        if reward <= 0:
            raise Exception("Bounty reward must be greater than 0")
        if len(title) == 0 or len(rubric) == 0:
            raise Exception("Title and rubric are required")
        bounty_id = self.bounty_count
        self.bounty_count += 1
        self.bounties[bounty_id] = Bounty(
            id=bounty_id,
            poster=gl.message.sender_address.as_hex,
            title=title,
            rubric=rubric,
            reward=reward,
            status="open",
            hunter="",
            deliverable="",
            evidence_url="",
            verdict="",
            reasons="",
            kleros_dispute_id=0,
            kleros_ruling=0,
        )
        return bounty_id

    @gl.public.write
    def submit_deliverable(
        self, bounty_id: u256, deliverable: str, evidence_url: str
    ) -> None:
        bounty = self.bounties[bounty_id]
        if bounty.status != "open":
            raise Exception("Bounty is not open")
        if gl.message.sender_address.as_hex == bounty.poster:
            raise Exception("Poster cannot submit to their own bounty")
        if len(deliverable) == 0 or len(evidence_url) == 0:
            raise Exception("Deliverable and evidence URL are required")
        bounty.hunter = gl.message.sender_address.as_hex
        bounty.deliverable = deliverable
        bounty.evidence_url = evidence_url
        bounty.status = "submitted"
        self.bounties[bounty_id] = bounty

    def _judge(self, rubric: str, deliverable: str, evidence_url: str) -> dict:
        """Run the AI judge. Returns {"verdict": ..., "reasons": ...}."""

        def get_verdict() -> str:
            evidence = gl.nondet.web.render(evidence_url, mode="text")
            task = (
                "You are an impartial judge. The rubric lists numbered "
                "requirements. Decide whether the deliverable satisfies "
                "the rubric, using the evidence page text.\n\n"
                "Rubric:\n"
                + rubric
                + "\n\nDeliverable summary:\n"
                + deliverable
                + "\n\nEvidence page text:\n"
                + evidence[:4000]
                + "\n\nRespond with JSON only, no other text: "
                '{"verdict": "accepted" or "rejected", '
                '"met": [numbers of rubric items satisfied], '
                '"failed": [numbers of rubric items not satisfied]}. '
                "Accept only if every rubric item is satisfied."
            )
            result = gl.nondet.exec_prompt(task, response_format="json")
            return json.dumps(result, sort_keys=True)

        verdict_json = gl.eq_principle.strict_eq(get_verdict)
        try:
            result = json.loads(verdict_json)
        except Exception:
            raise Exception("Judge returned output that is not valid JSON")
        verdict = result.get("verdict", "")
        if verdict not in ("accepted", "rejected"):
            raise Exception("Judge returned an invalid verdict")
        met = result.get("met", [])
        failed = result.get("failed", [])
        met_s = ", ".join(str(x) for x in met) if met else "none"
        failed_s = ", ".join(str(x) for x in failed) if failed else "none"
        reasons = "Rubric items met: " + met_s + ". Items failed: " + failed_s + "."
        return {"verdict": verdict, "reasons": reasons}

    @gl.public.write
    def judge_bounty(self, bounty_id: u256) -> None:
        bounty = self.bounties[bounty_id]
        if bounty.status != "submitted":
            raise Exception("Bounty has no submission to judge")
        result = self._judge(bounty.rubric, bounty.deliverable, bounty.evidence_url)
        bounty.verdict = result["verdict"]
        bounty.reasons = result["reasons"]
        # Verdict recorded, but NO payout yet — the appeal window opens.
        bounty.status = "judged"
        self.bounties[bounty_id] = bounty

    @gl.public.write
    def appeal_bounty(self, bounty_id: u256, kleros_dispute_id: u256) -> None:
        """Record that a Kleros appeal has been opened for a judged bounty.

        Called by the relay AFTER it creates the Kleros dispute on
        Arbitrum Sepolia (Agentic Commerce Court) via the DisputeResolver.
        """
        bounty = self.bounties[bounty_id]
        if bounty.status != "judged":
            raise Exception("Only a judged bounty can be appealed")
        if kleros_dispute_id <= 0:
            raise Exception("A Kleros dispute id is required")
        bounty.kleros_dispute_id = kleros_dispute_id
        bounty.status = "appealed"
        self.bounties[bounty_id] = bounty

    @gl.public.write
    def resolve_appeal(self, bounty_id: u256, kleros_ruling: u256) -> None:
        """Execute the Kleros ruling and close the bounty.

        kleros_ruling: 1 = refund poster, 2 = pay hunter,
        0 = refuse to arbitrate -> GenLayer verdict stands.
        Called by the relay after it reads the ruling on-chain from
        the DisputeResolver / KlerosCore on Arbitrum Sepolia.
        """
        bounty = self.bounties[bounty_id]
        if bounty.status != "appealed":
            raise Exception("Bounty has no open appeal to resolve")
        if kleros_ruling not in (0, 1, 2):
            raise Exception("Invalid Kleros ruling")
        bounty.kleros_ruling = kleros_ruling
        if kleros_ruling == 1:
            # Kleros: refund the poster.
            bounty.status = "resolved"
            self.bounties[bounty_id] = bounty
            gl.chain.Account(Address(bounty.poster)).emit_transfer(bounty.reward)
        elif kleros_ruling == 2:
            # Kleros: pay the hunter.
            bounty.status = "resolved"
            self.bounties[bounty_id] = bounty
            gl.chain.Account(Address(bounty.hunter)).emit_transfer(bounty.reward)
        else:
            # Refuse to arbitrate: fall back to the GenLayer verdict.
            self._pay_per_verdict(bounty)

    @gl.public.write
    def finalize_bounty(self, bounty_id: u256) -> None:
        """Close a judged bounty with no appeal: pay per GenLayer verdict."""
        bounty = self.bounties[bounty_id]
        if bounty.status != "judged":
            raise Exception("Only a judged bounty can be finalized")
        self._pay_per_verdict(bounty)

    def _pay_per_verdict(self, bounty: Bounty) -> None:
        if bounty.verdict == "accepted":
            bounty.status = "accepted"
            self.bounties[bounty.id] = bounty
            gl.chain.Account(Address(bounty.hunter)).emit_transfer(bounty.reward)
        else:
            bounty.status = "rejected"
            self.bounties[bounty.id] = bounty
            gl.chain.Account(Address(bounty.poster)).emit_transfer(bounty.reward)

    @gl.public.write
    def cancel_bounty(self, bounty_id: u256) -> None:
        bounty = self.bounties[bounty_id]
        if bounty.status != "open":
            raise Exception("Only an open bounty can be cancelled")
        if gl.message.sender_address.as_hex != bounty.poster:
            raise Exception("Only the poster can cancel")
        bounty.status = "cancelled"
        self.bounties[bounty_id] = bounty
        gl.chain.Account(Address(bounty.poster)).emit_transfer(bounty.reward)

    @gl.public.view
    def get_bounty(self, bounty_id: u256) -> dict:
        b = self.bounties[bounty_id]
        return {
            "id": b.id,
            "poster": b.poster,
            "title": b.title,
            "rubric": b.rubric,
            "reward": b.reward,
            "status": b.status,
            "hunter": b.hunter,
            "deliverable": b.deliverable,
            "evidence_url": b.evidence_url,
            "verdict": b.verdict,
            "reasons": b.reasons,
            "kleros_dispute_id": b.kleros_dispute_id,
            "kleros_ruling": b.kleros_ruling,
        }

    @gl.public.view
    def get_bounty_count(self) -> u256:
        return self.bounty_count

    @gl.public.view
    def get_all_bounties(self) -> dict:
        return {
            bounty_id: {
                "id": b.id,
                "poster": b.poster,
                "title": b.title,
                "rubric": b.rubric,
                "reward": b.reward,
                "status": b.status,
                "hunter": b.hunter,
                "deliverable": b.deliverable,
                "evidence_url": b.evidence_url,
                "verdict": b.verdict,
                "reasons": b.reasons,
                "kleros_dispute_id": b.kleros_dispute_id,
                "kleros_ruling": b.kleros_ruling,
            }
            for bounty_id, b in self.bounties.items()
        }
