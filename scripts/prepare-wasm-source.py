# SPDX-License-Identifier: GPL-3.0-only
"""Build an isolated host source tree and apply a stage-specific patch."""
import argparse
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--voices', type=int, choices=[16, 32, 64, 128, 256], default=16)
parser.add_argument('--daw', action='store_true', help='Apply the isolated DAW runtime slots to the 256-voice build')
args=parser.parse_args()
voices = args.voices
if args.daw and voices!=256:
    parser.error('DAW runtime is validated only with the 256-voice stage')
root = Path(__file__).resolve().parents[1]
upstream = root / 'upstream/SMKSYNTH'
target = root / f'.local/build/source-{voices}'
if target.exists():
    shutil.rmtree(target)
for relative in ['firmware', 'web/sim']:
    shutil.copytree(upstream / relative, target / relative)
(target / 'tests').mkdir(parents=True)
shutil.copy2(upstream / 'tests/host.c', target / 'tests/host.c')
subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(root / f'patches/polyphony-{voices}.patch')], cwd=target, check=True)
if args.daw:
    subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(root/'patches/daw-runtime.patch')],cwd=target,check=True)
# Optional host observation of the dry per-part bus, aligned with the buffered ISR.
# No algorithm changes; the historical reference compiles with this hook absent.
sim = target / 'web/sim/sim.c'
text = sim.read_text()
anchor = '        blk_pos++;'
assert text.count(anchor) == 1
sim.write_text(text.replace(anchor, '        #ifdef WASWAN_DAW_SAMPLE\n        WASWAN_DAW_SAMPLE(i, blk_pos);\n        #endif\n' + anchor))
print(f'Isolated {voices}-voice source: {target}')
