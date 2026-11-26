# BountyJudge Appeal — Dispute Policy (Kleros Agentic Commerce Court)

## What this is

A bounty was posted on GenLayer (AppealableBountyJudge, an intelligent
contract). The poster locked a reward in escrow and published a numbered
rubric. A hunter submitted a deliverable (a summary + an evidence URL).
GenLayer's AI jury judged the deliverable against the rubric and recorded a
verdict. The losing party appealed to Kleros Court.

## What jurors decide

**Question: did the hunter's deliverable satisfy every numbered item of the
bounty rubric?**

The GenLayer verdict is evidence, not binding. Rule on the rubric itself,
using the deliverable summary, the evidence page, and the rubric text
(all linked in the dispute template).

## Ruling criteria

- **Pay the hunter (ruling 2)** — only if the deliverable satisfies
  **every** numbered rubric item. If even one item is not satisfied, this
  is the wrong ruling.
- **Refund the poster (ruling 1)** — if any numbered rubric item is not
  satisfied, partially satisfied, or not evidenced. Partial fulfilment
  does not earn payment; the rubric is all-or-nothing.
- **Refuse to arbitrate (ruling 0)** — only if the dispute is malformed
  (no rubric, no deliverable, no evidence URL), out of scope, or the
  evidence is missing/unreadable so no ruling on the merits is possible.

## Edge cases

- **Evidence URL is dead or empty:** if the deliverable cannot be checked
  at all, rule 0 (refuse). If it loads but does not prove an item, that
  item is not satisfied → rule 1 (refund).
- **Deliverable matches the rubric in spirit but not in text:** the rubric
  text governs. Do not invent requirements that are not in the rubric, and
  do not waive requirements that are.
- **GenLayer verdict disagrees with your reading:** your reading governs.
  The GenLayer verdict is one AI jury's opinion; Kleros is the appeal
  court precisely so a human jury can overrule it.

## Evidence

Acceptable evidence: the deliverable summary, the evidence URL content
(a live page, repo, or document), and the rubric text. Screenshots alone,
without a reachable source, are weak evidence for an item.
