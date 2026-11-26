# { "Depends": "py-genlayer:kzybg95x1gn21dw72m7hyg0maaap04n4nx55j9yt6fkdqxtz6bz0" }

"""ClaimVerifier — a reusable on-chain fact-checking primitive (GenLayer Intelligent Contract).

Anyone submits a factual claim plus the source URLs it should be checked
against. Anyone can then call verify_claim: the contract fetches the
sources, asks an LLM to judge the claim, and records a structured verdict
on-chain.

- supported     -> the sources back the claim.
- refuted       -> the sources contradict the claim.
- unverifiable  -> the sources do not contain enough information to decide.

There is no bounty, no escrow, no rubric, and no hunter — this is pure
verification. It is a building block: AI agents can check a claim before
acting on it, content pipelines can verify statements before publishing,
and other contracts can read verdicts as an oracle for real-world facts.

Verification uses gl.eq_principle.strict_eq over a strictly-structured
verdict: the leader's LLM returns ONLY JSON — a verdict, a confidence
score (0-100), and the indices of the sources that support / refute the
claim — no free text — normalised with json.dumps(sort_keys=True) before
consensus. The human-readable reasons string is then built
deterministically in the contract from those values, so it never depends
on LLM wording. (strict_eq is the right tool here precisely because the
output is constrained to a verdict plus numbers; free-text reasons would
need the criteria-based prompt_non_comparative instead.)
Non-deterministic work (web fetch, LLM call) happens inside the function
the equivalence principle invokes, so validators re-run it independently.

The contract has NO owner/admin: after deployment nobody has special
power over it. Testnet only.
"""

import json
from dataclasses import dataclass

import genlayer as gl
from genlayer.types import *


@gl.storage.allow
@dataclass
class Claim:
    id: u256
    submitter: str  # hex address of the submitter
    claim_text: str
    source_urls: str  # newline-delimited URLs (GenVM v0.4 storage has no plain list type and DynArray can't be user-instantiated, so the record stays flat; split on read)
    status: str  # submitted | verified
    verdict: str  # supported | refuted | unverifiable | ""
    confidence: u256  # 0-100
    reasons: str


class ClaimVerifier(gl.contract.Contract):
    claims: gl.storage.TreeMap[u256, Claim]
    claim_count: u256

    def __init__(self):
        self.claim_count = 0

    @gl.public.write
    def submit_claim(self, claim_text: str, source_urls: list[str]) -> u256:
        if len(claim_text) == 0 or len(source_urls) == 0:
            raise Exception("Claim text and at least one source URL are required")
        claim_id = self.claim_count
        self.claim_count += 1
        self.claims[claim_id] = Claim(
            id=claim_id,
            submitter=gl.message.sender_address.as_hex,
            claim_text=claim_text,
            source_urls="\n".join(source_urls),
            status="submitted",
            verdict="",
            confidence=0,
            reasons="",
        )
        return claim_id

    def _verify(self, claim_text: str, source_urls_str: str) -> dict:
        """Run the fact-check. Returns {"verdict", "confidence", "reasons"}.

        Uses gl.eq_principle.strict_eq over a strictly-structured verdict:
        the LLM returns ONLY JSON with a verdict, a confidence score, and
        the indices of the sources that support / refute the claim — no
        free text. The JSON is normalised with json.dumps(sort_keys=True)
        before consensus, so validators agree whenever they agree on the
        substance. The human-readable reasons string is then built
        deterministically in the contract from those values, so it never
        depends on LLM wording.
        (strict_eq is the right tool here precisely because the output is
        constrained to a verdict plus numbers; free-text reasons would
        need the criteria-based prompt_non_comparative instead.)
        """

        source_urls = source_urls_str.split("\n")

        def get_verdict() -> str:
            sources_text = ""
            for i, url in enumerate(source_urls):
                page = gl.nondet.web.render(url, mode="text")
                sources_text += (
                    "Source " + str(i) + " (" + url + "):\n" + page[:2000] + "\n\n"
                )
            task = (
                "You are an impartial fact-checker. Decide whether the "
                "claim is supported or refuted by the given sources, "
                "using only what the sources say.\n\n"
                "Claim:\n"
                + claim_text
                + "\n\nSources:\n"
                + sources_text
                + "\n\nRespond with JSON only, no other text: "
                '{"verdict": "supported" or "refuted" or "unverifiable", '
                '"confidence": 0-100, '
                '"supporting": [indices of sources that support the claim], '
                '"refuting": [indices of sources that refute the claim]}. '
                "Use \"unverifiable\" when the sources do not contain "
                "enough information to decide either way."
            )
            result = gl.nondet.exec_prompt(task, response_format="json")
            return json.dumps(result, sort_keys=True)

        verdict_json = gl.eq_principle.strict_eq(get_verdict)
        try:
            result = json.loads(verdict_json)
        except Exception:
            raise Exception("Verifier returned output that is not valid JSON")
        verdict = result.get("verdict", "")
        if verdict not in ("supported", "refuted", "unverifiable"):
            raise Exception("Verifier returned an invalid verdict")
        confidence = result.get("confidence", 0)
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            raise Exception("Verifier returned an invalid confidence")
        confidence = int(confidence)
        if confidence < 0 or confidence > 100:
            raise Exception("Verifier returned an invalid confidence")
        supporting = result.get("supporting", [])
        refuting = result.get("refuting", [])
        if not isinstance(supporting, list) or not isinstance(refuting, list):
            raise Exception("Verifier returned invalid source indices")
        try:
            sup_s = (
                ", ".join(str(int(x)) for x in supporting) if supporting else "none"
            )
            ref_s = (
                ", ".join(str(int(x)) for x in refuting) if refuting else "none"
            )
        except Exception:
            raise Exception("Verifier returned invalid source indices")
        reasons = (
            "Claim " + verdict + ". "
            "Sources supporting: " + sup_s + ". "
            "Sources refuting: " + ref_s + ". "
            "Confidence: " + str(confidence) + "%."
        )
        return {"verdict": verdict, "confidence": confidence, "reasons": reasons}

    @gl.public.write
    def verify_claim(self, claim_id: u256) -> None:
        if claim_id >= self.claim_count:
            raise Exception("Claim does not exist")
        claim = self.claims[claim_id]
        if claim.status != "submitted":
            raise Exception("Claim is not awaiting verification")
        result = self._verify(claim.claim_text, claim.source_urls)
        claim.verdict = result["verdict"]
        claim.confidence = result["confidence"]
        claim.reasons = result["reasons"]
        claim.status = "verified"
        self.claims[claim_id] = claim

    @gl.public.view
    def get_claim(self, claim_id: u256) -> dict:
        if claim_id >= self.claim_count:
            raise Exception("Claim does not exist")
        c = self.claims[claim_id]
        return {
            "id": c.id,
            "submitter": c.submitter,
            "claim_text": c.claim_text,
            "source_urls": c.source_urls.split("\n"),
            "status": c.status,
            "verdict": c.verdict,
            "confidence": c.confidence,
            "reasons": c.reasons,
        }

    @gl.public.view
    def get_claim_count(self) -> u256:
        return self.claim_count

    @gl.public.view
    def get_all_claims(self) -> dict:
        return {
            claim_id: {
                "id": c.id,
                "submitter": c.submitter,
                "claim_text": c.claim_text,
                "source_urls": c.source_urls.split("\n"),
                "status": c.status,
                "verdict": c.verdict,
                "confidence": c.confidence,
                "reasons": c.reasons,
            }
            for claim_id, c in self.claims.items()
        }
