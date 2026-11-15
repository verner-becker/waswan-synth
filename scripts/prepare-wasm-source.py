# SPDX-License-Identifier: GPL-3.0-only
"""Build an isolated host source tree and apply a stage-specific patch."""
import argparse
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--voices', type=int, choices=[16, 32, 64, 128], default=16)
voices = parser.parse_args().voices
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
print(f'Isolated {voices}-voice source: {target}')
