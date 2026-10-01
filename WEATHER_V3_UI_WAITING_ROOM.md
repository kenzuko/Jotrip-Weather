# WEATHER V3 UI - WAITING ROOM

Status: PREPARED / NOT WIRED TO PUBLIC DOM
Date: 2026-10-01

This branch exists so Weather V3 can be exposed quickly after the current Weather V2 update set is finished.

## Current lock

Do not wire this branch into the public page yet.

The V3 adapter is intentionally dormant unless BOTH conditions are true:

- contract.status == PUBLIC_READY
- contract.public_ui_enabled == true

The current V3 contract is PREPARED_DISABLED, so accidental loading still renders nothing publicly.

Weather V2 remains the public authority.

## Prepared consumer

File:

weather-v3-preview-contract.js

It can consume:

weather-v3-ui-preview-v1

and exposes:

- readiness(payload)
- internalPointView(payload, pointId)
- publicPointView(payload, pointId)

Internal preview can inspect:
- ACTUAL rain when present
- radar coverage / nearby reflectivity
- satellite convective signal
- learning-stage nowcast candidates

Public view remains null while the gate is closed.

## Intended public presentation after V2 is stable

Keep it small and human-readable. Do not expose the technical engine.

Suggested block title:

**Mưa quanh đảo**

Public copy hierarchy:

1. ACTUAL wins
   - “An Thới đang có mưa rào nhẹ.”
   - timestamped observation only

2. Validated short nowcast
   - “Có vùng mưa cần để ý trong khoảng 30 phút tới.”
   - must remain DERIVED/NOWCAST internally
   - never phrase an ETA candidate as rain already occurring

3. Radar context
   - show only when public source/right gate and skill gate are both satisfied
   - never say “không mưa” from missing/invalid radar pixels
   - if coverage is poor, hide or say the observation is insufficient rather than a dry conclusion

4. Satellite context
   - supplementary only
   - convective cloud signal is not lightning and not surface rain

## Mobile behavior

- one compact card, not a technical dashboard
- current situation first
- 0-30 / 30-60 / 60-120 minute windows only when public-usable
- technical details belong in the lower “Chuyên sâu” section
- no source URLs or system labels in end-user copy

## Integration after Weather V2 update completion

1. rebase this branch onto the final V2 commit
2. run existing Weather Lab QA
3. sync/fetch the V3 public contract through the existing runtime path
4. wire the adapter after weather-human-contract.js
5. add the small “Mưa quanh đảo” view
6. keep a runtime kill switch
7. enable internal preview first
8. enable public only after the V3 contract itself reports PUBLIC_READY

Do not merge an old DOM patch over the final V2 UI. Rebase first, then wire against the final markup.
