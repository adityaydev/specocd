# phase-4-polish

Baseline requirements. Folded in from changes on archive.

<!-- from change: phase-4-polish, archived 2026-09-22T22:37:57.595Z -->

## R1: Machine-readable output for CI

- **WHEN** `specdd status` or `specdd verify` is run with `--json`
- **THEN** the system shall print the report as JSON and, for `verify`, exit non-zero when blockers exist

## R2: Publishable package

- **WHEN** the package is packed for npm
- **THEN** the system shall ship only `dist/` plus README and LICENSE, and build automatically on publish

## R3: Continuous integration

- **WHEN** a commit is pushed or a pull request is opened
- **THEN** CI shall build and run the full test suite on supported Node versions

## R4: Self-hosting

- **WHEN** SpecOCD is initialized on its own repository
- **THEN** the framework shall manage its own changes without special-casing, proving the brownfield adoption requirement
