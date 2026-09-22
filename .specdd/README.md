# .specdd/

Spec-driven development artifacts for this project.

- `specs/` — persistent baseline requirements (source of truth)
- `changes/<slug>/` — in-flight changes: proposal, requirement deltas, tasks,
  claim registry (`claims.yaml`) and append-only event log (`events.jsonl`)
- `changes/archive/` — completed changes, frozen
- `config.yaml` — size caps, staleness window, approval gate, enabled bindings

Everything here is plain text and meant to be committed. Never put credentials,
tokens or PII in these files.
