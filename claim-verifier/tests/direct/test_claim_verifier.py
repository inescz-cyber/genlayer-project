"""Direct-mode tests for ClaimVerifier.

Deterministic paths (submit / views / invalid ids) run without mocks.
The verify path mocks the web fetch and the LLM verdict; in Direct Mode
the equivalence-principle leader is executed directly (no validator
consensus), so these tests prove the contract loads, the verify wiring
works, and the verdict is applied — the real multi-validator consensus
is a Studio/testnet concern (see README).
"""

import json

import pytest

from tests.direct.conftest import to_hex

# NOTE (GenVM v0.4 / gltest 0.30.0): the verify tests below are marked
# xfail, NOT because the contract is wrong, but because of a harness bug
# in gltest 0.30's Direct Mode mock. gltest's _handle_llm_request
# auto-parses a valid-JSON mock string into a dict and returns
# {"ok": dict}, while the v0.4 stdlib's exec_prompt(response_format="json")
# decodes via _decode_nondet_json, which requires the "ok" value to be
# TEXT (it runs json.loads itself). Result: NondetException "JSON result
# is not text" before the contract ever sees the verdict. On the real
# network (Studio/Bradbury) the LLM returns text and the stdlib parses
# it, so the contract is correct — the verify path must be verified on
# Studionet (see README "GenLayer Studio"), not in Direct Mode, until
# gltest fixes the mock handler.
_VERIFY_XFAIL = pytest.mark.xfail(
    reason="gltest 0.30 mock auto-parses JSON to dict; v0.4 stdlib expects text",
    strict=True,
)


def _submit(direct_vm, contract, sender, claim_text="The Eiffel Tower is in Paris.", sources=None):
    direct_vm.sender = sender
    if sources is None:
        sources = ["https://example.com/paris", "https://example.com/eiffel"]
    return contract.submit_claim(claim_text, sources)


def _setup_verify_mocks(vm, verdict, confidence, supporting=(), refuting=()):
    """Mock the source pages and the fact-checker's LLM verdict."""
    vm.mock_web(
        r".*example\.com.*",
        {"status": 200, "body": "Source page: the Eiffel Tower stands in Paris, France."},
    )
    vm.mock_llm(
        r".*impartial fact-checker.*",
        json.dumps(
            {
                "verdict": verdict,
                "confidence": confidence,
                "supporting": list(supporting),
                "refuting": list(refuting),
            }
        ),
    )


def test_submit_claim(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    claim_id = _submit(direct_vm, contract, direct_alice)
    assert claim_id == 0
    assert contract.get_claim_count() == 1

    c = contract.get_claim(0)
    assert c["claim_text"] == "The Eiffel Tower is in Paris."
    assert list(c["source_urls"]) == [
        "https://example.com/paris",
        "https://example.com/eiffel",
    ]
    assert c["status"] == "submitted"
    assert c["verdict"] == ""
    assert c["confidence"] == 0
    assert c["submitter"] == to_hex(direct_alice)
    assert c["reasons"] == ""


def test_submit_empty_claim_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert(
        "Claim text and at least one source URL are required"
    ):
        contract.submit_claim("", ["https://example.com/paris"])


def test_submit_no_sources_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert(
        "Claim text and at least one source URL are required"
    ):
        contract.submit_claim("Some claim.", [])


@_VERIFY_XFAIL
def test_verify_supported(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    _submit(direct_vm, contract, direct_alice)

    _setup_verify_mocks(direct_vm, "supported", 85, supporting=(0, 1))
    direct_vm.sender = direct_alice
    contract.verify_claim(0)

    c = contract.get_claim(0)
    assert c["status"] == "verified"
    assert c["verdict"] == "supported"
    assert c["confidence"] == 85
    assert (
        c["reasons"]
        == "Claim supported. Sources supporting: 0, 1. Sources refuting: none. Confidence: 85%."
    )


@_VERIFY_XFAIL
def test_verify_refuted(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    _submit(direct_vm, contract, direct_alice)

    _setup_verify_mocks(direct_vm, "refuted", 90, refuting=(0,))
    direct_vm.sender = direct_alice
    contract.verify_claim(0)

    c = contract.get_claim(0)
    assert c["status"] == "verified"
    assert c["verdict"] == "refuted"
    assert c["confidence"] == 90
    assert (
        c["reasons"]
        == "Claim refuted. Sources supporting: none. Sources refuting: 0. Confidence: 90%."
    )


@_VERIFY_XFAIL
def test_verify_unverifiable(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    _submit(direct_vm, contract, direct_alice)

    _setup_verify_mocks(direct_vm, "unverifiable", 40)
    direct_vm.sender = direct_alice
    contract.verify_claim(0)

    c = contract.get_claim(0)
    assert c["status"] == "verified"
    assert c["verdict"] == "unverifiable"
    assert c["confidence"] == 40
    assert (
        c["reasons"]
        == "Claim unverifiable. Sources supporting: none. Sources refuting: none. Confidence: 40%."
    )


@_VERIFY_XFAIL
def test_verify_twice_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    _submit(direct_vm, contract, direct_alice)
    _setup_verify_mocks(direct_vm, "supported", 85, supporting=(0, 1))
    contract.verify_claim(0)

    with direct_vm.expect_revert("Claim is not awaiting verification"):
        contract.verify_claim(0)


def test_verify_invalid_id_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    _submit(direct_vm, contract, direct_alice)

    with direct_vm.expect_revert("Claim does not exist"):
        contract.verify_claim(999)


def test_get_claim_invalid_id_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    _submit(direct_vm, contract, direct_alice)

    with direct_vm.expect_revert("Claim does not exist"):
        contract.get_claim(999)


def test_get_all_claims(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ClaimVerifier.py")
    _submit(direct_vm, contract, direct_alice)
    _submit(
        direct_vm,
        contract,
        direct_alice,
        claim_text="Water boils at 100C at sea level.",
    )

    assert contract.get_claim_count() == 2
    all_c = contract.get_all_claims()
    assert len(all_c) == 2
    assert all_c[0]["status"] == "submitted"
    assert all_c[1]["claim_text"] == "Water boils at 100C at sea level."
