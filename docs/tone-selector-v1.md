# Tone Selector v1 — UI Foundation v0.3

## Baseline and Git

UI Foundation v0.2 was approved by the user and fast-forwarded into `main` at
`c9341f057c56217a6a082b69620f3e040b534be8`. Publication and ancestry were confirmed
before deleting `feat/ui-foundation-v2` locally and remotely. No merge commit was
needed; the integration preserves the three original commits. Tags remain intact.

`feat/tone-selector-v1` starts at that exact main commit. It requires separate user
approval before integration. The pinned SMKSYNTH submodule remains
`3f751bc2be066414f204cf44e1aa05d9c7467d7f`; firmware and DSP sources are unchanged.

## Reused architecture

- Upstream `obv_params.h` defines `NPROG=99` and ten-character names. Programs
  1–64 use factory patches, 65–70 the VIBE bank, 71–99 INIT unless overwritten by
  the user. `prog_get()` resolves user overrides in RAM `psect[]` before factory
  defaults. Those sectors already belong to the original persisted session.
- Original `sim_program_name()` supplies names. No new bank or browser storage
  key is introduced. `waswan_program_count/catalog` expose count and a small
  fingerprint of saved-name metadata. Engine reads all names only when that
  fingerprint changes, sending `programLibrary` on the next frame. Reboot and
  session restoration create a fresh Engine and refresh the catalog.
- A host-only `waswan_program_select` calls **the same `trk_load()`** used by the
  Legacy PRESETS encoder and MIDI Program Change. It then sets the same display
  dirty flags. This is an adapter in `wasm/waswan-sim.c`, not an upstream edit.
- Engine validates the `program-select` command and returns its result in a
  subsequent snapshot. Existing `programs[]`, `track`, live name, controls and
  `edited` remain authoritative. UI does not optimistically replace them.
- `web/ui-tone-selector.js` is presentation and confirmation. Its native select
  replaces the former header name line, retains the information line, and uses
  the existing dark/teal tokens and dialog styling. Native keyboard navigation,
  accessible name and described-by information are retained.

## Selection and unsaved edits

The list shows real program numbers and names. The selected item uses the live
name, including any unsaved renaming performed in Legacy. Changing parts updates
the header; changing programs through Legacy or restored patterns also updates it.
The current selected option does not reload its patch.

If the current snapshot says `Edited`, an English modal offers **Cancel** and
**Discard and load**. Cancel is initially focused; Escape cancels. No command is
sent on cancellation. There is no automatic SAVE. Saving remains in Legacy SMK.

Commands carry the original part/program scope and a fingerprint of the live
80-byte patch. The host rejects stale confirmation, unapproved discard, queued
part/program navigation, MIDI MODE, SAVE/confirmation/layer/held-step contexts,
and queued pattern changes. A rejected request leaves the real selection intact
and displays `Selection not applied; retry`. The 32-bit fingerprints are lightweight
change guards, not cryptographic identifiers.

The confirmation protects **this selector**. Original Legacy, MIDI Program Change,
patterns and favorites keep their original policies; they are not intercepted.

## Musical and persistence behavior

`trk_load()` changes only the target live patch and program/edit metadata. It does
not send panic, reboot the engine or recreate AudioContext. Shared effects remain
preserved by upstream `fx_keep()`. Existing voices, envelopes and note-off handling
follow the original engine. Patch parameters, including its stored voice mode and
arp settings, are recalled normally; the selector sends no separate mode command.

Patterns can carry four live patches plus program/edit marks and mixer state.
Their existing sound-set capture/restore policy remains unchanged. A session boot
may restore that pattern sound set rather than merely the last selected program.
Favorites, patterns, program sectors and the 21-sector export format are unchanged.
There is no new automatic persistence or guarantee that unsaved live edits survive
reboot; use the original SAVE operations and session export as before.

## Validation

All executed suites passed on the final implementation. Local logs and JSON
results are in `.local/validation/tone-selector-v1/`; browser regressions also write
their usual ignored validation directories. No physical SMK-37 Pro test was
performed for this selector.

| Executed check | Result |
| --- | --- |
| `tone-selector.test.mjs` | PASS: 99 canonical names, independent A–D loads, edit/discard guards, stale patch/part rejection, original rename/SAVE-as and restored user names |
| Native deterministic selection comparison | PASS: 128,000 scalar samples bit-identical between adapter and original PRESETS encoder, including held notes/note-off |
| Native v0.2 comparison without selection | PASS: 128,000 scalar samples bit-identical to the approved v0.2 artifact |
| `midi-profile`, `midi-diagnostic`, `knob-fine-control`, `knob-pickup`, `voice-mode-action` Node suites | PASS |
| `polyphony`, `polyphony-16/32/64/128/256` Node suites | PASS: original regressions, allocator/stealing, sustain/release and progressive pool tests |
| `ui-foundation.test.mjs` | PASS: host controls, storage shape, profiles and 256,000 scalar samples identical to pre-UI reference |
| `dsp-monitor.test.mjs` | PASS: bounded statistics/capture and audio identical off/live/capture (384,000 scalar samples per run) |
| `browser-tone-selector.mjs` | PASS in real Chrome 157: real list, A–D, knobs, Cancel/Escape/discard, Legacy/part synchronization, held notes, one running AudioContext, keyboard navigation, export/import and 390px layout; no JavaScript exceptions |
| `browser-ui-foundation-v2.mjs` | PASS: connection/selection, denied/empty MIDI, startup failure/retry, shared mode state, sustained notes/navigation and unchanged desktop panel geometry |
| `browser-ui-foundation.mjs` | PASS: pointer/touch/keyboard controls, MIDI Learn/pickup, presets, sessions, navigation/audio and DSP JSONL export |
| `browser-polyphony-256.mjs` | PASS: 256 voices, DUAL, stealing, stale note-off, sustain, MONO/UNISON, mappings and finite nonzero browser audio |

The first browser run exposed a delayed `close` event clearing the intent after
rapid Cancel/reopen. Intent cleanup now occurs synchronously on each action or
native cancel, and a stale close event cannot clear a new intent. The final browser
suite passes both Cancel/reopen and Escape/reopen. During validation the previously
running HTTP server stopped; it was restarted before rerunning browser checks.
An initial test assertion also incorrectly treated the bundled 19-sector seed as
the current 21-sector export; the original Engine already performs this migration.
No production persistence code was changed.

The v0.2 baseline was rebuilt with the reference script and its SHA-256 matched the
artifact copied before implementation:
`3f4eb21d69f9610021b4f4cd72cc5309dbc41829f67ef339983b5d5c99dfc602`.
These are deterministic software comparisons, not hardware loopback recordings.
No new prolonged DSP soak or instrument-overhead benchmark is claimed in this UI
phase. The usual DSP Node suite ran; its timings include concurrent validation and
are not a controlled v0.2/v0.3 performance comparison.

### Screenshots

[Desktop Performance](assets/tone-selector-v1/selector-desktop.png) ·
[390px viewport](assets/tone-selector-v1/selector-mobile.png) ·
[Unsaved-edit confirmation](assets/tone-selector-v1/edited-confirmation.png).

### Reproduce

After tool setup and the normal simulator build, stage and serve as usual. In
another terminal, build the approved baseline if the ignored artifact is absent:

```sh
UI_REFERENCE_COMMIT=c9341f057c56217a6a082b69620f3e040b534be8 \
UI_REFERENCE_DIR=.local/validation/tone-selector-v1 \
sh tests/build-ui-reference.sh
node tests/tone-selector.test.mjs
node tests/browser-tone-selector.mjs
node tests/browser-ui-foundation-v2.mjs
node tests/browser-ui-foundation.mjs
node tests/browser-polyphony-256.mjs
```

The reference helper retains its pre-UI defaults for the existing UI suite; run
`sh tests/build-ui-reference.sh` without overrides for that suite. Other Node suites
are named in the table and run with `node tests/<name>.test.mjs`. Browser tests use
the existing local Playwright installation and `/usr/bin/google-chrome`. They create
isolated browser contexts and never use the user's saved profile.

## Changed files and limits

- `wasm/waswan-sim.c`: host-only library metadata and guarded original loader.
- `web/engine.js`: typed command, cached catalog and authoritative snapshots.
- `web/ui-tone-selector.js`: native dropdown and discard confirmation.
- `web/ui-foundation.js`, `web/ui-foundation.css`: header integration and small styles.
- `tests/tone-selector.test.mjs`, `tests/browser-tone-selector.mjs`: focused coverage.
- `tests/build-ui-reference.sh`: optional reference SHA/output directory for reproducibility.
- `AGENTS.md`: official main baseline is now v0.2.
- This report and three screenshots.

Names keep the original ten-character limit; no renaming UI, categories, new banks,
or new favorites were added. A queued pattern change or Legacy SAVE/configuration
context temporarily disables selection. Existing pattern/favorite recall can
replace live patches under original rules. TONES remains a future workspace.
The native select popup uses the browser/platform's keyboard and rendering behavior;
the closed control is styled to match the cockpit.

## Manual validation on Ubuntu

1. Run `sh scripts/build-simulator.sh` after tool setup if necessary, then
   `python3 scripts/serve-simulator.py` and open `http://localhost:8737/simulator/`.
2. Reload with Ctrl+F5. Start audio, connect/select MIDI if desired, and click OK.
3. Open the tone dropdown in the header. Choose a numbered program and play.
4. Edit cutoff, choose another tone, and try Cancel before Discard and load.
5. Use the existing A–D performance pads (or Legacy Part selector) to choose B, C
   and D; select independent tones.
   Change PRESETS in Legacy and confirm the header follows it.
6. Save through Legacy and export through Settings when retaining your work.
   Compare desktop and narrow-window layouts.
