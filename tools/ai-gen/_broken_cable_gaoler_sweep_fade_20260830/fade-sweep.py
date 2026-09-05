"""Fade the top-row third animation (chainSweep); never fade hookWinch."""
from pathlib import Path
import importlib.util
import json
import shutil
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = ROOT.parent / '_abandoned_mine_lords_20260829/broken_cable_gaoler'


def main():
    config = json.loads((REPO/'data/enemy-config.json').read_text(encoding='utf-8'))['brokenCableGaoler']
    layout = config['textures']['frameLayouts']['chainSweep'].copy()
    effects = json.loads((SOURCE/'runtime-alpha-effects.json').read_text(encoding='utf-8'))['actions']['chainSweep']
    layout.update(effects)
    spec = importlib.util.spec_from_file_location('gaoler_runtime_sheets', SOURCE/'build-runtime-sheets.py')
    production = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(production)
    target = REPO/config['textures']['chainSweep']
    backup = ROOT/'chain-sweep-before-fade.png'
    if not backup.exists():
        shutil.copyfile(target, backup)
    before = Image.open(backup).convert('RGBA')
    after = before.copy()
    width, height, columns = (layout[k] for k in ('frameWidth', 'frameHeight', 'columns'))
    scale = config['render']['bodyDisplayHeight']/layout['authoredBodyHeight']
    previews, delays = [], []
    for i in range(layout['frameCount']):
        x, y = i % columns * width, i // columns * height
        cell = before.crop((x, y, x+width, y+height))
        faded = production.apply_cable_edge_fade(cell, i, layout)
        after.paste(faded, (x, y))
        canvas = Image.new('RGB', (800, 740), '#667480')
        draw = ImageDraw.Draw(canvas)
        for row, frame in enumerate((cell, faded)):
            sprite = frame.resize((round(width*scale),round(height*scale)),Image.Resampling.LANCZOS)
            px = round(300-layout['anchorXByFrame'][i]*scale)
            py = round(row*370+320-layout['footYByFrame'][i]*scale)
            canvas.paste(sprite, (px, py), sprite)
            draw.text((12, row*370+345), f'TOP ROW #3 / chainSweep f{i}: '+('BEFORE' if row == 0 else 'CABLE EDGE FADE / authored preview'), fill='white')
        previews.append(canvas)
        delays.append(round((i+1)*layout['duration']/layout['frameCount']/10)*10-round(i*layout['duration']/layout['frameCount']/10)*10)
    after.save(target)
    previews[0].save(ROOT/'sweep-fade-comparison.gif', save_all=True, append_images=previews[1:], duration=delays, loop=0, disposal=2)
    previews[20].save(ROOT/'sweep-left-fade-comparison.png')
    previews[23].save(ROOT/'sweep-right-fade-comparison.png')
    new_only = [image.crop((0,370,800,740)) for image in previews]
    new_only[0].save(ROOT/'sweep-fade-final.gif', save_all=True, append_images=new_only[1:], duration=delays, loop=0, disposal=2)

    for path in (SOURCE/'runtime-layouts.json', REPO/'assets/enemies/broken_cable_gaoler/spritesheet-manifest.json'):
        value = json.loads(path.read_text(encoding='utf-8'))
        value['actions']['hookWinch'].pop('farHookFade',None)
        value['actions']['chainSweep'].update(effects)
        path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    path = SOURCE/'task-index.json'
    value = json.loads(path.read_text(encoding='utf-8'))
    value['actions']['hookWinch'].pop('runtimeFullWidthPreview',None)
    value['actions']['chainSweep']['runtimeFullWidthPreview'] = '../../_broken_cable_gaoler_sweep_fade_20260830/sweep-fade-final.gif'
    value['runtimeAlphaEffectCorrection'] = 'User selected top row third: chainSweep. Prior hookWinch fade reverted from exact pre-fade PNG.'
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Applied only chainSweep edge fade; all 55 frames, body roots and 4583ms timing preserved.')


if __name__ == '__main__':
    main()
