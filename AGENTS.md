# Repository Guidelines

## Project Structure & Module Organization

- `upstream/SMKSYNTH/` is the pinned original submodule. Preserve its revision, firmware, licensing, and attribution.
- `web/` contains WASWAN browser extensions: MIDI profiles, knob control, polyphony panels, and DSP diagnostics.
- `wasm/waswan-sim.c` provides the host adapter; `patches/` contains isolated polyphony changes applied to build copies.
- `scripts/` prepares tools, builds WASM, stages the simulator, and serves it locally.
- `tests/` contains Node assertions and Playwright browser checks. `docs/` holds architectural decisions, validation reports, and selected screenshots.
- `.tools/` and `.local/` are ignored tool, build, and evidence directories. Never edit generated simulator files as source.

## Build, Test, and Development Commands

Run commands from the repository root:

```sh
git submodule update --init
sh scripts/setup-tools.sh
sh scripts/build-simulator.sh
sh scripts/check-upstream.sh
python3 scripts/serve-simulator.py
```

These initialize the pinned source, install local tools, build/stage WASM, verify upstream integrity, and serve `http://localhost:8737/simulator/`. The default build includes stages through 256 voices. Use `sh scripts/stage-simulator.sh` for browser-only changes after building. There is no production npm installation step.

## Coding Style & Naming Conventions

Use JavaScript ES modules and descriptive kebab-case filenames. Follow adjacent formatting; readable browser modules generally use two-space indentation and semicolons. Preserve SPDX headers. Keep host adapters and extensions separate from upstream. No repository-wide formatter or linter is configured; avoid unrelated formatting changes and unnecessary dependencies.

## Testing Guidelines

Tests use Node's assertions and Playwright with real Chrome. Examples:

```sh
node tests/midi-profile.test.mjs
node tests/knob-pickup.test.mjs
node tests/polyphony-256.test.mjs
node tests/dsp-monitor.test.mjs
node tests/browser-knob-pickup.mjs
```

Build first; browser checks additionally require the local server and their documented Playwright setup. Name engine tests `*.test.mjs` and browser tests `browser-*.mjs`. Run relevant MIDI, audio, DSP-monitor, and polyphony regressions, including earlier voice stages when allocation changes. No numerical coverage threshold exists. Record measured evidence in `.local/validation/`; distinguish automated results from physical SMK-37 Pro validation.

## Commit & Pull Request Guidelines

Inspect status, branch, HEAD, and remote references before changes. Preserve local work and use an isolated branch based on the actual functional reference; `main` may lag development. Follow history prefixes such as `fix:`, `test:`, and `docs:` with concrete descriptions. Separate implementation, tests, and documentation where useful. Publish the development branch after validation; do not merge or tag without authorization. PR descriptions should explain behavior, validation, limitations, and relevant screenshots. Preserve preset/profile compatibility and musical behavior; additional polyphony or DSP expansions require explicit approval.
