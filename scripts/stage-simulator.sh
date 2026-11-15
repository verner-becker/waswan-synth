#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Empacota a UI original com o adaptador WASWAN, sem recompilar o DSP.
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
upstream="$root/upstream/SMKSYNTH"
test -f .local/build/SMKSYNTH-1.2.0.wasm || { echo 'Compile o WASM primeiro.' >&2; exit 1; }
mkdir -p .local/www/simulator
cp "$upstream"/web/simulator/* .local/www/simulator/
cp .local/build/SMKSYNTH-1.2.0.wasm .local/www/simulator/obervave-voice.wasm
cp "$upstream/web/simulator/midi.js" .local/www/simulator/midi-original.js
cp web/midi.js web/midi-profile.js web/midi-profile-panel.js web/midi-profile.css .local/www/simulator/
cp "$upstream/web/site/i18n.js" .local/www/i18n.js
cp "$upstream/LICENSE" .local/www/LICENSE.txt
cp "$upstream/LICENSING.md" "$upstream/CREDITS.md" .local/www/
echo 'Simulador e perfil MIDI prontos em .local/www/simulator/'
