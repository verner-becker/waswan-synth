#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Empacota a UI original com o adaptador WASWAN, sem recompilar o DSP.
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
upstream="$root/upstream/SMKSYNTH"
voices="${WASWAN_VOICES:-64}"
case "$voices" in 8|16|32|64) ;; *) echo 'Somente as etapas até 64 estão autorizadas.' >&2; exit 1;; esac
test -f ".local/build/waswan-$voices.wasm" || { echo "Execute sh scripts/build-simulator.sh para compilar a etapa de $voices vozes." >&2; exit 1; }
mkdir -p .local/www/simulator
cp "$upstream"/web/simulator/* .local/www/simulator/
cp ".local/build/waswan-$voices.wasm" .local/www/simulator/obervave-voice.wasm
cp "$upstream/web/simulator/midi.js" .local/www/simulator/midi-original.js
cp "$upstream/web/simulator/engine.js" .local/www/simulator/engine-original.js
cp web/midi.js web/midi-profile.js web/midi-profile-panel.js web/midi-profile.css web/engine.js web/polyphony-panel.js web/polyphony.css .local/www/simulator/
# One explicit hook in the derived app; never edit the submodule.
python3 - <<'PY'
from pathlib import Path
p = Path('.local/www/simulator/app.js')
s = p.read_text()
anchor = 'function frame(m){state=m;'
if s.count(anchor) != 1:
    raise SystemExit('Contrato de frame upstream mudou; revisar integração de polifonia.')
s = "import {updatePolyphony} from './polyphony-panel.js';\n" + s.replace(anchor, 'function frame(m){updatePolyphony(m);state=m;')
p.write_text(s)
PY
cp "$upstream/web/site/i18n.js" .local/www/i18n.js
cp "$upstream/LICENSE" .local/www/LICENSE.txt
cp "$upstream/LICENSING.md" "$upstream/CREDITS.md" .local/www/
echo "Simulador de $voices vozes e perfil MIDI prontos em .local/www/simulator/"
