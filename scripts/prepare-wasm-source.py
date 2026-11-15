# SPDX-License-Identifier: GPL-3.0-only
"""Build an isolated host source tree and apply the approved 16-voice patch."""
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
upstream = root / 'upstream/SMKSYNTH'
target = root / '.local/build/source-16'
if target.exists():
    shutil.rmtree(target)
for relative in ['firmware', 'web/sim']:
    shutil.copytree(upstream / relative, target / relative)
(target / 'tests').mkdir(parents=True)
shutil.copy2(upstream / 'tests/host.c', target / 'tests/host.c')
subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(root / 'patches/polyphony-16.patch')], cwd=target, check=True)
print(f'Isolated 16-voice source: {target}')
