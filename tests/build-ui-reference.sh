#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Rebuild the audited pre-UI host wrapper for a reproducible audio baseline.
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
export ZIG_GLOBAL_CACHE_DIR="$root/.tools/zig-cache"
# The reference shares the pinned upstream and 256-voice patch, not the new host API.
git diff --exit-code 7dc36c8d97eb19ac084d5401864d51532a5c16e6 -- patches/polyphony-256.patch upstream/SMKSYNTH
python3 scripts/prepare-wasm-source.py --voices 256
mkdir -p .local/validation/ui-foundation
reference="$root/.local/build/ui-reference.c"
git show 7dc36c8d97eb19ac084d5401864d51532a5c16e6:wasm/waswan-sim.c > "$reference"
ZIG="${ZIG:-$(.tools/venv/bin/python -c 'import pathlib,ziglang; print(pathlib.Path(ziglang.__file__).parent / "zig")')}"
"$ZIG" cc --target=wasm32-freestanding -mcpu=generic+bulk_memory -O2 \
 '-DAPP_VER="1.2.0"' -DOBV_EXPERIMENTAL=1 -DWASWAN_VOICES=256 \
 "-DWASWAN_SIM_SOURCE=\"$root/.local/build/source-256/web/sim/sim.c\"" \
 -fno-builtin -ffreestanding -nostdlib -Wno-unused-function -Wno-unused-variable -Wno-unused-but-set-variable \
 -I"$root/.local/build/source-256/firmware/src" -I"$root/.local/build/source-256/firmware/gen" \
 -Wl,--no-entry -Wl,--export-memory -Wl,--export-dynamic -Wl,-z,stack-size=262144 \
 -o .local/build/ui-reference-raw.wasm "$reference"
"${WASM_OPT:-$root/.tools/binaryen-version_133/bin/wasm-opt}" .local/build/ui-reference-raw.wasm \
 --enable-bulk-memory --asyncify -O2 --strip-debug --strip-producers -o .local/validation/ui-foundation/reference-256.wasm
