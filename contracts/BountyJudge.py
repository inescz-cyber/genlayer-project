# { "Depends": "py-genlayer:kzybg95x1gn21dw72m7hyg0maaap04n4nx55j9yt6fkdqxtz6bz0" }

"""BountyJudge — an on-chain AI bounty judge (GenLayer Intelligent Contract).

A poster creates a bounty with a rubric and locks testnet GEN in escrow.
A hunter submits a deliverable (a summary + an evidence URL).
Anyone can then call judge_bounty: the contract fetches the evidence page,
asks an LLM to judge the deliverable against the rubric, and records a
structured verdict (accepted / rejected + reasons).

- accepted  -> the escrowed reward is paid to the hunter, bounty closes.
- rejected  -> the full reward is refunded to the poster, bounty closes.
  (Refund-on-reject is the simplest, safest rule: no funds ever get stuck
  in a bounty that keeps failing. The poster can re-post a new bounty.)

A poster may also cancel an open (not yet submitted) bounty for a full refund.

Judging uses gl.eq_principle.strict_eq over a strictly-structured verdict:
the leader's LLM returns ONLY JSON — a verdict plus the lists of rubric
item numbers met / failed, no free text — normalised with
json.dumps(sort_keys=True) before consensus. The human-readable reasons
string is then built deterministically in the contract from those numbers,
so it never depends on LLM wording. (strict_eq is the right tool here
precisely because the output is constrained to numbers; free-text reasons
would need the criteria-based prompt_non_comparative instead.)
Non-deterministic work (web fetch, LLM call) happens inside the function
the equivalence principle invokes, so validators re-run it independently.
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
    status: str  # open | submitted | accepted | rejected | cancelled
    hunter: str  # hex address of the hunter ("" when none)
    deliverable: str
    evidence_url: str
    verdict: str  # accepted | rejected | ""
    reasons: str


class BountyJudge(gl.contract.Contract):
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
        """Run the AI judge. Returns {"verdict": ..., "reasons": ...}.

        Uses gl.eq_principle.strict_eq over a strictly-structured verdict:
        the LLM returns ONLY JSON with a verdict and lists of rubric item
        numbers met / failed — no free text. The JSON is normalised with
        json.dumps(sort_keys=True) before consensus, so validators agree
        whenever they agree on the substance. The human-readable reasons
        string is then built deterministically in the contract from those
        numbers, so it never depends on LLM wording.
        (strict_eq is the right tool here precisely because the output is
        constrained to numbers; free-text reasons would need the
        criteria-based prompt_non_comparative instead.)
        """

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
        if result["verdict"] == "accepted":
            bounty.status = "accepted"
            self.bounties[bounty_id] = bounty
            gl.chain.Account(Address(bounty.hunter)).emit_transfer(bounty.reward)
        else:
            # Rejected: refund the poster in full and close the bounty.
            bounty.status = "rejected"
            self.bounties[bounty_id] = bounty
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
            }
            for bounty_id, b in self.bounties.items()
        }
