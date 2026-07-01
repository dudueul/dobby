"""Pure chain tests. One assertion per fact; English-sentence names.

Run:  python -m pytest services/archive-job/test_audit_chain.py
"""
import audit_chain

G = audit_chain.GENESIS


def extendChain_returnsTheHeadUnchangedForNoRows():
    assert audit_chain.extend_chain(G, []) == G


def extendChain_isOrderSensitive():
    assert audit_chain.extend_chain(G, ["a", "b"]) != audit_chain.extend_chain(G, ["b", "a"])


def extendChain_changesWhenAnyRowChanges():
    assert audit_chain.extend_chain(G, ["a", "b"]) != audit_chain.extend_chain(G, ["a", "c"])


def extendChain_isDeterministicForTheSameHistory():
    assert audit_chain.extend_chain(G, ["a", "b"]) == audit_chain.extend_chain(G, ["a", "b"])


def extendChain_composesLikeSealingInBatches():
    whole = audit_chain.extend_chain(G, ["a", "b", "c"])
    batched = audit_chain.extend_chain(audit_chain.extend_chain(G, ["a", "b"]), ["c"])
    assert whole == batched


def canonicalRow_preventsFieldBleedBetweenColumns():
    assert audit_chain.canonical_row(("ab", "c")) != audit_chain.canonical_row(("a", "bc"))


def canonicalRow_encodesNoneAsEmpty():
    assert audit_chain.canonical_row((None,)) == ""
