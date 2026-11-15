#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
upstream="$root/upstream/SMKSYNTH"
test -f "$upstream/web/sim/sim.c" || { echo 'Execute git submodule update --init.' >&2; exit 1; }
if [ -z "${ZIG:-}" ]; then
  ZIG=$("$root/.tools/venv/bin/python" -c 'import pathlib,ziglang; print(pathlib.Path(ziglang.__file__).parent / "zig")')
fi
export ZIG
export WASM_OPT="${WASM_OPT:-$root/.tools/binaryen-version_133/bin/wasm-opt}"
export ZIG_GLOBAL_CACHE_DIR="$root/.tools/zig-cache"
export SIM_VERSION=1.2.0
export SIM_OUT="$root/.local/build"
export WASWAN_VOICES="${WASWAN_VOICES:-16}"
case "$WASWAN_VOICES" in 8|16) ;; *) echo 'Somente as etapas 8 e 16 estão autorizadas.' >&2; exit 1;; esac
sh "$upstream/tools/build_controls_sim.sh"
# Thin host extension: original DSP/allocator compiled unchanged, plus mode API and telemetry.
"$ZIG" cc --target=wasm32-freestanding -mcpu=generic+bulk_memory -O2 \
  '-DAPP_VER="1.2.0"' -DOBV_EXPERIMENTAL=1 -fno-builtin -ffreestanding -nostdlib \
  -Wno-unused-function -Wno-unused-variable -Wno-unused-but-set-variable \
  -I"$upstream/firmware/src" -I"$upstream/firmware/gen" \
  -Wl,--no-entry -Wl,--export-memory -Wl,--export-dynamic -Wl,-z,stack-size=262144 \
  -o "$SIM_OUT/waswan-8-raw.wasm" "$root/wasm/waswan-sim.c"
"$WASM_OPT" "$SIM_OUT/waswan-8-raw.wasm" --enable-bulk-memory --asyncify \
  -O2 --strip-debug --strip-producers -o "$SIM_OUT/waswan-8.wasm"
if [ "$WASWAN_VOICES" = 16 ]; then
  python3 "$root/scripts/prepare-wasm-source.py"
  source16="$SIM_OUT/source-16"
  "$ZIG" cc --target=wasm32-freestanding -mcpu=generic+bulk_memory -O2 \
    '-DAPP_VER="1.2.0"' -DOBV_EXPERIMENTAL=1 -DWASWAN_VOICES=16 \
    "-DWASWAN_SIM_SOURCE=\"$source16/web/sim/sim.c\"" \
    -fno-builtin -ffreestanding -nostdlib \
    -Wno-unused-function -Wno-unused-variable -Wno-unused-but-set-variable \
    -I"$source16/firmware/src" -I"$source16/firmware/gen" \
    -Wl,--no-entry -Wl,--export-memory -Wl,--export-dynamic -Wl,-z,stack-size=262144 \
    -o "$SIM_OUT/waswan-16-raw.wasm" "$root/wasm/waswan-sim.c"
  "$WASM_OPT" "$SIM_OUT/waswan-16-raw.wasm" --enable-bulk-memory --asyncify \
    -O2 --strip-debug --strip-producers -o "$SIM_OUT/waswan-16.wasm"
fi
sh "$root/scripts/stage-simulator.sh"
sha256sum "$SIM_OUT/SMKSYNTH-$SIM_VERSION.wasm" "$upstream/web/simulator/obervave-voice.wasm"
echo 'Build local pronto. Execute python3 scripts/serve-simulator.py'
