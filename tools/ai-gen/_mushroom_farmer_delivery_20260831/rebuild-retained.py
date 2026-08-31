"""Rebuild approved keys once with the frozen RIFE producer; no game writes."""
from pathlib import Path
import argparse
import subprocess
import sys

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--rife', type=Path, required=True)
args = parser.parse_args()
output = root / '_rebuild'
output.mkdir(exist_ok=True)
for state, columns, final_columns, options in [
    ('mushroom_loaded_running', 8, 5, ['--preserve-vertical-motion', '--despill-blue-middle']),
    ('empty_running', 5, 6, []),
]:
    subprocess.run([
        sys.executable, '-X', 'utf8', str(root/'producer/rife-spritesheet-interpolate.py'),
        '--rife', str(args.rife.resolve()), '--sheet', str(root/f'video-sheets/{state}-base.png'),
        '--out', str(output/f'{state}.png'), '--name', state,
        '--frame-width', '256', '--frame-height', '256', '--cols', str(columns),
        '--frame-count', '15', '--frame-rate', '12', '--mode', 'loop',
        '--out-cols', str(final_columns), '--preview-dir', str(output/'previews'),
        '--report', str(output/f'{state}-report.json'), *options,
    ], check=True)
