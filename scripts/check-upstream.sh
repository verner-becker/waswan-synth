#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Executa os testes existentes sobre o WASM recompilado, sem alterar o upstream.
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
voices="${WASWAN_VOICES:-128}"
case "$voices" in 8|16|32|64|128) ;; *) echo 'Somente as etapas planejadas até 128 estão autorizadas.' >&2; exit 1;; esac
test -f ".local/build/waswan-$voices.wasm" || { echo 'Compile o simulador primeiro.' >&2; exit 1; }
mkdir -p .local
fixture=$(mktemp -d "$root/.local/check.XXXXXX")
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/web/simulator" "$fixture/tests"
cp upstream/SMKSYNTH/web/simulator/engine.js upstream/SMKSYNTH/web/simulator/midi.js upstream/SMKSYNTH/web/simulator/package.json upstream/SMKSYNTH/web/simulator/factory-session.bin "$fixture/web/simulator/"
cp ".local/build/waswan-$voices.wasm" "$fixture/web/simulator/obervave-voice.wasm"
cp upstream/SMKSYNTH/tests/simulator_midi_test.mjs upstream/SMKSYNTH/tests/release_demo_wasm_test.mjs "$fixture/tests/"
node "$fixture/tests/simulator_midi_test.mjs"
node "$fixture/tests/release_demo_wasm_test.mjs"
