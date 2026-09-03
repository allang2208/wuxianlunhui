"""Rebuild selected horror sprites from retained key sheets, without reinstalling config.

Explicit asset-production command; requires the project's ComfyUI Python/RIFE setup.
Original source videos, approved key timing, runtime config and provenance are not changed.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import subprocess
import sys

from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
TOOLS = ROOT.parents[1]
ACTORS = {
    'coffin-ward': 'coffinWard',
    'shroud-thrall': 'shroudThrall',
    'ossuary-caster': 'ossuaryCaster',
    'knell-attendant': 'knellAttendant',
}
STATES = {'idle': 'idle', 'walking': 'walk', 'attacking': 'attack', 'dying': 'death'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', choices=ACTORS, help='Omit to rebuild all four actors.')
    parser.add_argument('--action', choices=STATES, help='Omit to rebuild all four actions.')
    args = parser.parse_args()
    config = json.loads((REPO/'data/enemy-config.json').read_text(encoding='utf-8'))
    spec = importlib.util.spec_from_file_location('horror_preview_helpers', ROOT/'coffin-ward/build-sprites.py')
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    for actor in ([args.actor] if args.actor else ACTORS):
        actor_root = ROOT/'coffin-ward' if actor == 'coffin-ward' else ROOT
        build = ROOT/'coffin-ward/sprite-build' if actor == 'coffin-ward' else ROOT/'remaining-sprite-build-v01'/actor
        source = json.loads((build/'source-manifest.json').read_text(encoding='utf-8'))
        textures = config[ACTORS[actor]]['textures']
        for record in source['actions']:
            action = record['action']
            if args.action and action != args.action:
                continue
            state = STATES[action]
            output = REPO/textures[state]
            output.parent.mkdir(parents=True, exist_ok=True)
            report = build/'reports'/f'{action}-rife.json'
            report.parent.mkdir(parents=True, exist_ok=True)
            cmd = [sys.executable, str(TOOLS/'rife-spritesheet-interpolate.py'),
                   '--sheet', str(actor_root/record['sourceSheet']), '--out', str(output),
                   '--name', f'{actor}-{action}',
                   '--frame-width', str(record['frameWidth']), '--frame-height', str(record['frameHeight']),
                   '--cols', str(record['sourceCols']), '--frame-count', str(record['sourceKeyCount']),
                   '--frame-rate', str(record['keyFps']), '--mode', record['mode'],
                   '--out-cols', str(record['cols']), '--report', str(report),
                   '--preview-dir', str(build/'previews/rife'), '--repair-red-outliers']
            if actor != 'coffin-ward':
                cmd.append('--hold-large-repair')
            if actor == 'coffin-ward' or action == 'dying':
                cmd.append('--preserve-vertical-motion')
            subprocess.run(cmd, check=True)
            # Authoritative variable frame timing, never the interpolator's mean FPS.
            layout = textures['frameLayouts'][state]
            with Image.open(output) as image:
                sheet = np.asarray(image.convert('RGBA'))
            width, height, cols = layout['frameWidth'], layout['frameHeight'], layout['columns']
            cells = [sheet[i//cols*height:(i//cols+1)*height, i%cols*width:(i%cols+1)*width].copy()
                     for i in range(layout['frameCount'])]
            helpers.save_preview(cells, layout['frameDurations'], build/'previews/final'/f'{action}.gif')
            print(f'Rebuilt {actor}/{action}: {output.relative_to(REPO)}', flush=True)


if __name__ == '__main__':
    main()
