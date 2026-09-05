"""Replace distorted v01 walking/death sources; never submit an existing output twice."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENTRY = ROOT.parents[1] / 'ai-asset.py'

def main():
    # H3 is intentional: the walk requires pixel-locked first/last geometry,
    # and both repairs retain the existing H3 character source. Execution
    # requires authorization to upload these materials to the LAN service.
    for action, seed in [('walking', 2026083022), ('dying', 2026083026)]:
        output = ROOT / 'videos' / f'{action}-minimax-h3-v02.mp4'
        if output.exists():
            print(f'Already generated: {output.name}', flush=True)
            continue
        command = [
            sys.executable, str(ENTRY), 'video', 'generate', '--provider', 'h3',
            '--ref', str(ROOT / 'references' / 'crystal-bore-video-safe-v02.png'),
            '--prompt', str(ROOT / 'prompts' / f'{action}-minimax-h3-v02.txt'),
            '--out', str(output), '--duration', '5.17', '--size', '1024x576',
            '--steps', '20', '--seed', str(seed), '--timeout', '3600',
            '--h3-audio-mode', 'visual-only', '--h3-visual-profile', 'character-asset',
        ]
        command += ['--loop'] if action == 'walking' else ['--motion-mode', 'one-way']
        print(f'Generating {action} with the undistorted 16:9 source', flush=True)
        subprocess.run(command, check=True)


if __name__ == '__main__':
    main()
