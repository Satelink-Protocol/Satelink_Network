# DO NOT RUN

These SQL files are pre-runner legacy schema fragments (layers 009–013, 030–032, layer70).
They are **not** part of the migration history and must never be applied to any database.
The only migration path is `npx tsx database/runner.ts migrate` over `database/migrations/`.
Archived 2026-10-07 — see `docs/CLEANUP_MANIFEST.md`.
