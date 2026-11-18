/* SPDX-License-Identifier: GPL-3.0-only */
/* Test-only build: deliberately bypass the public validated note API. */
#include "../wasm/waswan-sim.c"
EXPORT void waswan_test_queue(uint32_t part) {note_event_p(part,1,62,100);}
