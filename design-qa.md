# UI Foundation v0.1 — visual QA

**Source visual truth:** the three mockups supplied by the user, retained locally in `.local/validation/ui-foundation/references/{performance,sound-design,sequencer}.png` (1667×999 each, including browser chrome). They are directional references, explicitly not a fidelity contract or proof of implemented functionality. No personal browser chrome was published.

**Implementation:** real Chrome 157.0.8103.78, 1560×1100 CSS viewport, deviceScaleFactor 1; screenshots in `docs/assets/ui-foundation/`. Performance is 1560×1115 full-page, Sound Design/Sequencer 1560×1100, Legacy 1560×1272. Mobile is 390×844 CSS, 390×2979 full-page. Mock application region is approximately 1562×881; comparison excludes browser chrome and allows the additional four real knobs explicitly requested by the user. No pixel-perfect or mobile-reference fidelity is claimed.

## Findings and comparison history

- **Resolved P2 — desktop density:** initial two-row knob composition placed the shared keyboard too far below the controls (`.local/validation/ui-foundation/running.png`, 1560×1332). At wide viewports, eight knobs now form one row, faders are compact, middle cards have shorter headings, and the old language strip stays out of the new English shell. Post-fix evidence: `performance-desktop.png`; controls, measured output, chord and playable keyboard share the main working area.
- **Resolved P2 — transport wording:** the performance card now says “Transport stopped/playing”, distinguishing sequencer transport from live MIDI notes and active voices.
- No remaining actionable P0/P1/P2 issues were found within the agreed foundation scope. Narrow layout is vertically scrollable, with no global horizontal overflow. Its keyboard remains compact; larger mobile playing surfaces are a follow-up, with the physical SMK-37 Pro the current target.

## Required surfaces checked

- **Typography:** legible system sans, hierarchy in product name, preset, section headings, parameter values and secondary technical labels. No external font dependency; exact mock font is unavailable. Small raw-value labels are supplementary, not the only way to read a parameter.
- **Spacing/layout:** persistent header and module navigation, bounded panels, eight functional knobs/four faders, central musical information and shared bottom dock. Desktop and narrow layouts opened and inspected.
- **Colors/tokens:** near-black graphite, muted borders, white arcs, teal selection/focus and MIDI state; restrained glow. Focus is visible on navigation and sliders.
- **Assets:** no raster illustrations are needed. The mock's decorative logo/icons were deliberately not reproduced; text navigation avoids an unnecessary icon dependency. Canvas arcs and the real waveform are functional primitives expressly requested by the brief, not substitutes for raster artwork.
- **Copy/content:** English shell; operational values come from the actual engine/AnalyserNode. Placeholder editors clearly say PLANNED. Legacy tools retain their original translations, including some Portuguese.

Source and rendered full-resolution images were opened in the same comparison input. Focused review covered arc/value/assignment regions, output labels, chord state and shared keyboard; these were readable at full resolution, so no additional cropped image exports were needed. Sound Design, Sequencer, Legacy and mobile captures were inspected separately for their different scope/state.

## Interaction checks

Real Chrome tests cover startup, all navigation, keyboard navigation, Legacy access, pointer/touch/keyboard controls, MIDI learning/pickup, preserved mappings, preset SAVE/recall, session export/import, DSP JSONL export and reload. Held notes continue across navigation with one AudioContext and zero navigation commands; no JavaScript exceptions. The synth and MIDI remain real; scenes, piano roll, multiple LFOs and extra oscillators are not simulated.

## Follow-up polish

- Consider a larger scrollable/mobile keyboard in a later ergonomic increment.
- Unify remaining legacy translations and refine supplementary label sizes after physical use.
- Review direct part/preset selection before adding new editors.

Implementation checklist: completed for the authorized foundation; physical SMK-37 Pro validation remains a user review step.

final result: passed
