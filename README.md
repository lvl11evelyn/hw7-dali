# hw7-dali

HW1 Dynamically Adapted Legacy Images (DALI) modernizes native HoboWars imagery while preserving the original image dimensions and page layout.

DALI identifies supported native images, resolves them against its replacement catalog, and substitutes a same-size modern variant where an authoritative match exists. Unknown or ambiguous imagery is deliberately left untouched.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) if you do not already have a userscript manager.
2. [Install HW Dynamically Adapted Legacy Images](https://raw.githubusercontent.com/lvl11evelyn/hw7-dali/main/HW%20Dynamically%20Adapted%20Legacy%20Images.user.js)

The install link opens the current release directly in your userscript manager.

## How DALI Works

DALI scans native HoboWars imagery and attempts to resolve each source to a known catalog identity.

Its deterministic identity system can use:

- exact native filenames
- normalized filenames
- native image-content hashes
- canonical catalog identity mappings

A replacement is applied only when DALI can resolve the native image to a known identity with sufficient authority. The system is intentionally fail-closed: an unknown or ambiguous image remains native rather than being replaced speculatively.

DALI retains the native image's intended dimensions so the modernization does not alter the surrounding HoboWars interface.

## Dynamic Image Discovery

Not every native HoboWars image exposes a stable or immediately recognizable identity.

When DALI encounters imagery it cannot deterministically resolve, it can retain evidence for later review rather than permanently guessing. Pending associations can be reviewed or exported through DALI's userscript menu.

The current review commands are:

- **Review Proposals**
- **Export Proposals**
- **Review Rejected Proposals**

A proposal is not authoritative merely because DALI discovered it.

## Canonical Identity Registry

DALI's permanent source-to-identity mappings are maintained in:

`assets/dali-id-registry.json`

The registry is authoritative for accepted native identities.

A mistaken mapping can cause the same native image to be misidentified everywhere it appears, so permanent associations are intentionally subject to human review before being added to the registry.

Rejected associations are maintained separately so previously investigated false matches do not need to be repeatedly rediscovered.

## Local Approval Extension

The optional **HW DALI Local Approval Extension** provides a local review and submission workflow for unresolved DALI proposals.

It can:

- locally approve proposed associations for the current user
- display a summary of approved associations
- submit approved associations directly to this repository through GitHub Issues
- configure the GitHub token used for submission
- clear locally stored approvals

Local approval does **not** modify DALI's canonical registry. It only provides local runtime authority until the repository maintainer reviews the submitted evidence. :contentReference[oaicite:2]{index=2}

## Community Submissions

Community users may submit proposed identity associations and supporting evidence through the DALI Local Approval Extension.

Submissions use the repository's GitHub Issues workflow so there is one consistent delivery path for review.

Community users may:

- submit pending associations
- provide additional evidence
- challenge pending associations
- recommend rejection

Community users may not promote an association into DALI's authoritative registry.

Final approval is performed by the repository maintainer when an association is deliberately added or promoted into:

`assets/dali-id-registry.json`

Submissions that result in a canonical registry or rejection-registry change are retained in the repository's submissions archive so the resulting authority has a traceable origin. :contentReference[oaicite:3]{index=3}

## Why Manual Review Exists

DALI is intended to learn aggressively without turning uncertain inference into permanent global behavior.

An incorrect source association can affect every occurrence of the same native image. The review process therefore keeps one human checkpoint between discovery and permanent registry authority.

The goal is not to make contributions difficult. The goal is to keep DALI's deterministic memory trustworthy.

## Project Scope

DALI is a presentation and quality-of-life project for HoboWars 1.

It changes supported imagery only. It does not automate gameplay, navigation, combat, resource acquisition, transactions, or other game actions.

## License

## License

[MIT License.](LICENSE)

Copyright © 2026 lvl11evelyn.
