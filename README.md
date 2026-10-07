# JoTrip Weather Lab - legacy / R&D only

> **Role lock (2026-10-07): this repository is the Weather Lab, not the production Weather product.**

Canonical production terminology:

- **Production Weather Product**: `https://openphuquoc.com/weather` (short name: `/weather`)
- **Weather Lab**: `https://weather.openphuquoc.com` (this repository)
- **Owned Weather Engine/Data**: `kenzuko/openpq-intelligence/producers/weather` + branch `data-weather`

The Weather Lab is retained for historical comparison, replay, visual experiments, regression testing and R&D.

It has **no canonical authority** and must never be an automatic fallback or runtime dependency of `/weather`.

## Historical implementation

This repository contains the former standalone Weather UI and its historical bridge code. Some files still refer to legacy `Jotrip-Lab` data paths because they are part of the archived implementation. Those references are not a production contract.

## Shutdown boundary

Production `/weather` is considered cleanly detached only when this site and its scheduled workflows can be unavailable without affecting:

- current conditions
- ground truth
- cloud / nowcast
- forecast
- marine
- metadata / health
- critical summary
- regional forecast

New production development must occur in the OpenPQ-owned Weather path, not here.
