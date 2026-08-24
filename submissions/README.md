# DALI Identity Submissions

This folder is for community-submitted DALI identity association evidence.

DALI may encounter native HoboWars imagery that she cannot yet identify deterministically. When that happens, she may collect evidence and prepare a pending association for human review.

That review is performed manually by the repository maintainer.

Please allow reasonable time for submissions to be reviewed. A submission may remain pending for more than a few minutes, hours, or days depending on availability and the amount of evidence involved.

## What belongs here

Submissions should contain evidence for a native image source that DALI believes may correspond to a known catalog identity.

Useful evidence may include:

- native image `src`
- FNV hash
- page URL where the image appeared
- native filename
- `alt`, `title`, or `aria-label`
- nearby or structural identity cues
- repeated observations
- DALI's proposed catalog identity
- any other information that helps establish or disprove the association

## Pending associations

Pending associations are not authoritative.

They are proposals awaiting human review.

A pending submission must not be treated as part of DALI's core identity registry until the maintainer explicitly promotes it into `assets/dali-id-registry.json`.

## Rejections

Users may submit evidence that a pending association is incorrect.

If you can show that a proposed source-to-identity association is wrong, contradictory, ambiguous, or unsafe to treat as deterministic, that information is welcome.

Please identify the association being challenged and include the evidence supporting the rejection.

A rejection does not need to propose a replacement identity.

Erroneous local rejection records are reversible. If DALI has learned or stored an incorrect rejection locally, reinstalling DALI will clear that local rejection state and allow the association to be reconsidered.

## Do not submit already-rejected associations as new submissions

If an association has already been rejected, please do not recreate the same proposal as a new submission unless you have materially new evidence that changes the case.

Repeatedly resubmitting an unchanged rejected association only creates duplicate review work.

## Do not submit already-rejected associations as new submissions

If an association has already been rejected, please do not recreate the same proposal as a new submission unless you have materially new evidence that changes the case.

Repeatedly resubmitting an unchanged rejected association only creates duplicate review work.

## Approval authority

Community users may:

- submit pending associations
- provide additional evidence
- challenge pending associations
- recommend rejection

Community users may not approve or promote associations into DALI's authoritative registry.

Final approval is performed only by the repository maintainer.

Approval occurs when the maintainer deliberately adds or promotes the association into:

`assets/dali-id-registry.json`

Until that happens, the association remains non-authoritative.

## Why this review exists

DALI's deterministic registry is intended to provide exact source-to-identity mappings.

A mistaken association can cause the same native source to be misidentified everywhere it appears, so uncertain discoveries are deliberately reviewed before they become permanent registry authority.

The goal is not to make submissions difficult.

The goal is to let DALI learn aggressively while keeping one human checkpoint between inference and permanent memory.
