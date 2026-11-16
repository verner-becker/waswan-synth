# Repository Guidelines

## Current Baseline

`main` contains UI Foundation v0.1, 256 voices, DSP Monitor, MIDI diagnostics, knob soft takeover, and the UX audit. Earlier branches were merged and removed; historical branch names are not checkout instructions. Use commit SHAs or existing tags for earlier versions.

## Project Structure

- `upstream/SMKSYNTH/`: pinned original submodule; preserve its revision, firmware, licenses, and attribution.
- `web/ui-foundation.js`, `ui-primitives.js`, `ui-controls.js`, `ui-foundation.css`: shell composition, reusable controls, parameter catalog, and design tokens.
- `wasm/waswan-sim.c` and `patches/`: isolated host APIs and polyphony patches applied to build copies.
- `scripts/`, `tests/`, `docs/`: build/server tooling, validation, architecture, and screenshots.
- `.tools/` and `.local/`: ignored tools, generated artifacts, and local evidence. Never edit generated files as source.

## Architecture & Musical Behaviour

Keep one instrument instance. Workspace navigation changes presentation only: never restart AudioContext/WASM, send panic, release notes, change presets, or replace mappings. Reuse the original keyboard/pad handlers and preserve Legacy SMK access.

The English shell targets the SMK-37 Pro's eight knobs and four faders. Preserve contextual `enc:*`/`fader:*` mappings and explicit `control:*` assignments. Reassignment requires user action; absolute semantic controls use soft takeover. Preserve preset/session formats and original parameter scales, including cutoff tables. Planned editors must remain visibly identified as planned.

Consult `docs/ux-audit.md`, `docs/ui-foundation-v1.md`, and MIDI/DSP reports. Additional DSP capabilities or polyphony require explicit approval.

## Build & Validation

Run from the repository root:

```sh
sh scripts/setup-tools.sh
sh scripts/build-simulator.sh
python3 scripts/serve-simulator.py
```

Open `http://localhost:8737/simulator/`; use Start audio and Settings. `sh scripts/stage-simulator.sh` updates browser files after building. No production npm install is needed.

Node assertion suites use `tests/*.test.mjs`; Chrome checks use `tests/browser-*.mjs`. Run regressions relevant to the change: MIDI/profile/pickup, 256 voices, DSP Monitor, presets, and audio. Allocation changes also require earlier voice stages. For UI work, run `sh tests/build-ui-reference.sh`, `node tests/ui-foundation.test.mjs`, and `node tests/browser-ui-foundation.mjs`. Browser tests need the server and documented Playwright setup. Keep evidence in `.local/validation/`; distinguish software results from physical validation.

## Style & Git Workflow

Use ES modules, kebab-case filenames, adjacent formatting (generally two spaces and semicolons), and SPDX headers. No formatter/linter is configured. Avoid unnecessary frameworks, dependencies, CI/CD, and refactoring.

Inspect status, HEAD, and remote references; preserve local work. Start functional changes on an isolated branch from updated `main`. Finish with descriptive commits (`feat:`, `fix:`, `test:`, `docs:`) and push. Merge/tag only with authorization; remove completed branches only after verifying incorporation. Preserve tags and history; never use force push or `reset --hard`. PR descriptions explain behaviour, validation, limitations, and screenshots.
