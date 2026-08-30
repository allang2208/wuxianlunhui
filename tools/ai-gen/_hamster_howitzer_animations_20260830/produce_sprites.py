"""Offline sprite production only; does not run the game or tests."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
for python, stage in [(sys.executable,'keys'), (str(REPO/'.venv-sprites/Scripts/python.exe'),'interpolate')]:
    with (ROOT/f'logs/production-{stage}.log').open('w',encoding='utf-8') as log:
        subprocess.run([python,str(ROOT/'make_sprites.py'),stage],stdout=log,stderr=subprocess.STDOUT,check=True)
    print(f'{stage}: complete',flush=True)
