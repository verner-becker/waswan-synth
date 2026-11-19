# sloopDX voice core

These two source files come from [sloopDX at 8c1035b](https://github.com/zvenson/dxsloop/tree/8c1035b79d860edcb6f23556910206332669dac8/firmware/src). The integer port is copyright 2026 Sven Trogus, GPL-3.0-only. The underlying msfa/Dexed code and table expressions are copyright 2012 Google Inc. and 2016–2025 Pascal Gauthier, Apache-2.0. See Apache-2.0.txt and the project LICENSE. WASWAN integrates the core at 44.1 kHz. Factory banks are outside this distribution.

WASWAN changes the feedback loop of algorithms 4 and 6 to include the complete stack described in the original MSFA routing table and bounds frequency shifts at extreme pitches.
