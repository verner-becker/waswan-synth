#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Run after build-simulator, using its already prepared, isolated DAW sources.
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
source_tree="$root/.local/build/source-256"
test -f "$source_tree/firmware/src/obv_engine.h"
if ! rg -q '^#define WASWAN_DAW_RUNTIME 1' "$source_tree/firmware/src/obv_engine.h"; then
  echo 'Prepare the 256-voice --daw build before the fault harness (UI reference build replaces that tree).' >&2
  exit 1
fi
ZIG="${ZIG:-$(.tools/venv/bin/python -c 'import pathlib,ziglang; print(pathlib.Path(ziglang.__file__).parent / "zig")')}"
export ZIG_GLOBAL_CACHE_DIR="$root/.tools/zig-cache"
mkdir -p .local/validation/daw-mvp-wave-3
"$ZIG" cc --target=wasm32-freestanding -mcpu=generic+bulk_memory -O2 \
 '-DAPP_VER="1.2.0"' -DOBV_EXPERIMENTAL=1 -DWASWAN_VOICES=256 \
 "-DWASWAN_SIM_SOURCE=\"$source_tree/web/sim/sim.c\"" \
 -fno-builtin -ffreestanding -nostdlib -Wno-unused-function -Wno-unused-variable -Wno-unused-but-set-variable \
 -I"$source_tree/firmware/src" -I"$source_tree/firmware/gen" \
 -Wl,--no-entry -Wl,--export-memory -Wl,--export-dynamic -Wl,-z,stack-size=262144 \
 -o .local/validation/daw-mvp-wave-3/fault-raw.wasm tests/daw-fault.c
"${WASM_OPT:-$root/.tools/binaryen-version_133/bin/wasm-opt}" .local/validation/daw-mvp-wave-3/fault-raw.wasm \
 --enable-bulk-memory --asyncify -O2 --strip-debug --strip-producers -o .local/validation/daw-mvp-wave-3/fault.wasm
