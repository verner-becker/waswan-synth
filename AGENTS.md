# Repository Guidelines

## Current Baseline

`main` is the official functional reference: UI Foundation v0.3 with the tone selector and ANALOG Tone Editor (TONES, Save/Save as), 256 voices, DSP Monitor, MIDI diagnostics, knob soft takeover, Studio waves 0–5, the revised SEQ project/recording workflow, the root Portuguese PDF manual, and the DAW MVP through `21bd5bc`. The user approved the Studio integration and branch cleanup on 2026-11-17 and the DAW MVP integration and branch cleanup on 2026-11-18. Historical branch names are not checkout instructions; use commit SHAs or tags.

## Studio Evolution

For DAW MVP history and physical acceptance, see `docs/daw-mvp-discovery/README.md` and its assessment/source documents. For the UX evolution, use `docs/ux-evolution-plan.md` and `docs/ux-evolution-astra.md`. On 2026-11-18 the user approved proceeding through the mapped UX stages, including Legacy SMK removal after parity checks, and asked for a follow-up Astra UX review. Use one stacked branch per stage. Keep one instance, pinned upstream and the global 256-voice pool. Further integration into `main`, additional DSP capabilities and polyphony expansion require explicit approval. Stop a blocked line without repetitive retries and bring evidence/options to the user.

Track scope, approvals, wave status, decisions, and handoffs in `docs/studio-waves.md`; keep technical evidence for wave 0 in `docs/studio-wave-0.md`. The user has authorized continuing through the planned waves, starting with wave 1 and the wave 0 recommendations. Close each wave with a short record of implementation, actual validation, limitations, decisions, and next step. Prefer the browser, subject to measured feasibility. Challenge proposals when evidence warrants it. If a real blocker persists or a decision exceeds approved scope, preserve the work and ask the user for a decision rather than retrying indefinitely. Integration into `main`, additional DSP capabilities, and polyphony changes still require explicit approval.

## Project Structure

- `upstream/SMKSYNTH/`: pinned original submodule; preserve its revision, firmware, licenses, and attribution.
- `web/ui-foundation.js`, `ui-primitives.js`, `ui-controls.js`, `ui-tone-editor.js`, `ui-foundation.css`: shell composition, reusable controls, parameter catalog, and design tokens.
- `wasm/waswan-sim.c` and `patches/`: isolated host APIs and polyphony patches applied to build copies.
- `scripts/`, `tests/`, `docs/`: build/server tooling, validation, architecture, and screenshots.
- `.tools/` and `.local/`: ignored tools, generated artifacts, and local evidence. Never edit generated files as source.

## Architecture & Musical Behaviour

Keep one instrument instance. Workspace navigation changes presentation only: never restart AudioContext/WASM, send panic, release notes, change presets, or replace mappings. Reuse the original keyboard/pad handlers and preserve Legacy SMK access.

The English shell targets the SMK-37 Pro's eight knobs and four faders. Preserve contextual `enc:*`/`fader:*` mappings and explicit `control:*` assignments. Reassignment requires user action; absolute semantic controls use soft takeover. Preserve preset/session formats and original parameter scales, including cutoff tables. Planned editors must remain visibly identified as planned.

Consult `docs/ux-audit.md`, `docs/ui-foundation-v1.md`, `docs/ui-foundation-v2.md`, and MIDI/DSP reports. Additional DSP capabilities or polyphony require explicit approval.

## Build & Validation

Run from the repository root:

```sh
sh scripts/setup-tools.sh
sh scripts/build-simulator.sh
python3 scripts/serve-simulator.py
```

Open `http://localhost:8737/simulator/`; use Start audio and Settings. `sh scripts/stage-simulator.sh` updates browser files after building.

Node assertion suites use `tests/*.test.mjs`; Chrome checks use `tests/browser-*.mjs`. Run regressions relevant to the change: MIDI/profile/pickup, 256 voices, DSP Monitor, presets, and audio. Allocation changes also require earlier voice stages. For UI work, run `sh tests/build-ui-reference.sh`, `node tests/ui-foundation.test.mjs`, `node tests/browser-ui-foundation.mjs`, and `node tests/browser-ui-foundation-v2.mjs`. Browser tests need the server and documented Playwright setup. For tone editing, also run `tests/tone-editor.test.mjs` and `tests/browser-tone-editor.mjs`; preserve original Save/Save as semantics and distinguish RAM, instrument write, and browser persistence. Keep evidence in `.local/validation/`; distinguish software results from physical validation.

## Style & Git Workflow

Use ES modules, kebab-case filenames, adjacent formatting (generally two spaces and semicolons), and SPDX headers. No formatter/linter is configured. Avoid unnecessary frameworks, dependencies, CI/CD, and refactoring.

Inspect status, HEAD, and remote references; preserve local work. Development branches are temporary and start from updated `main`. Test changes before integration, use commits (`feat:`, `fix:`, `test:`, `docs:`), and push the branch. Integration requires explicit user approval. Remove completed branches only after confirming their commits are preserved in `main`. Never create tags automatically, force push, or use `reset --hard`. PR descriptions explain behaviour, validation, limitations, and screenshots.
