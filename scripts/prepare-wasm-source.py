# SPDX-License-Identifier: GPL-3.0-only
"""Build an isolated host source tree and apply a stage-specific patch."""
import argparse
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--voices', type=int, choices=[16, 32, 64, 128, 256], default=16)
parser.add_argument('--daw', action='store_true', help='Apply the isolated DAW runtime slots to the 256-voice build')
parser.add_argument('--mellotron-probe', action='store_true', help='Prepare the isolated milestone A host')
args=parser.parse_args()
voices = args.voices
if args.daw and voices!=256:
    parser.error('DAW runtime is validated only with the 256-voice stage')
root = Path(__file__).resolve().parents[1]
upstream = root / 'upstream/SMKSYNTH'
target = root / f'.local/build/source-{voices}'
if args.mellotron_probe:
    if not args.daw:
        parser.error('The Mellotron probe requires the DAW host')
    target = root / '.local/build/source-mellotron-a'
if target.exists():
    shutil.rmtree(target)
for relative in ['firmware', 'web/sim']:
    shutil.copytree(upstream / relative, target / relative)
(target / 'tests').mkdir(parents=True)
shutil.copy2(upstream / 'tests/host.c', target / 'tests/host.c')
subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(root / f'patches/polyphony-{voices}.patch')], cwd=target, check=True)
if args.daw:
    subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(root/'patches/daw-runtime.patch')],cwd=target,check=True)
    subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(root/'patches/daw-monitor.patch')],cwd=target,check=True)
    for header in ['analog-oscillators.h', 'analog-waveforms.h', 'fm-voice.h', 'fm-patch.h', 'fm-storage.h']:
        shutil.copy2(root / 'wasm' / header, target / 'firmware/src')
    subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(root / 'patches/analog-oscillators.patch')], cwd=target, check=True)
    subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(root / 'patches/analog-fine-pulse.patch')], cwd=target, check=True)
    shutil.copytree(root/'wasm/vendor/sloopdx',target/'firmware/src/vendor/sloopdx')
    subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(root/'patches/fm-layer.patch')],cwd=target,check=True)
if args.mellotron_probe:
    probe = root / 'tests/mellotron-a'
    shutil.copy2(probe / 'sample-head.h', target / 'firmware/src')
    subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(probe / 'voice.patch')], cwd=target, check=True)
elif args.daw:
    shutil.copy2(root / 'wasm/mellotron.h', target / 'firmware/src')
    subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(root / 'patches/mellotron.patch')], cwd=target, check=True)
    for header in ['sampler-voice.h','sampler-modulation.h','sampler-reader.h']:
        shutil.copy2(root / 'wasm' / header, target / 'firmware/src')
    subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(root / 'patches/sampler-voice.patch')], cwd=target, check=True)
# Optional host observation of the dry per-part bus, aligned with the buffered ISR.
# No algorithm changes; the historical reference compiles with this hook absent.
sim = target / 'web/sim/sim.c'
text = sim.read_text()
anchor = '        blk_pos++;'
assert text.count(anchor) == 1
sim.write_text(text.replace(anchor, '        #ifdef WASWAN_DAW_SAMPLE\n        WASWAN_DAW_SAMPLE(i, blk_pos);\n        #endif\n' + anchor))
print(f'Isolated {voices}-voice source: {target}')
