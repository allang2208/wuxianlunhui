"""Apply only the five scoped foreman attachment hooks to the current scene."""
from pathlib import Path

p=Path(__file__).resolve().parents[3]/'src/phaser/scenes/GameScene.js'
original_stamp=p.stat().st_mtime_ns
s=p.read_bytes().decode('utf-8')
nl='\r\n' if '\r\n' in s else '\n'
edits=[
    ("import { FogVisualAdapter } from '../../effects/fog-visual-adapter.js';",
     "import { FogVisualAdapter } from '../../effects/fog-visual-adapter.js';\nimport { ForemanWhipVisuals } from '../../effects/foreman-whip-visual.js';"),
    ('        this._syncRedWolfPounceSmoke(_game);',
     '        this._syncRedWolfPounceSmoke(_game);\n        // 工头鞭层读取本帧最终人体脚点、镜像与遮挡深度。\n        if (!this._foremanWhips) this._foremanWhips = new ForemanWhipVisuals(this);\n        this._foremanWhips.sync(_game);'),
    ('        const radius = Math.max(\n            16,',
     '        const radius = Math.max(\n            16,\n            Number(entity.config?.render?.visualCullRadius) || 0,'),
    ('        this._setViewportVisualHidden(this._redWolfPounceSmokeFx?.get(entity)?.emitters, hidden);',
     '        this._setViewportVisualHidden(this._redWolfPounceSmokeFx?.get(entity)?.emitters, hidden);\n        this._setViewportVisualHidden(this._foremanWhips?.getVisual(entity), hidden);'),
    ('        FogVisualAdapter.setHidden(this._redWolfPounceSmokeFx?.get(entity)?.emitters, hidden);',
     '        FogVisualAdapter.setHidden(this._redWolfPounceSmokeFx?.get(entity)?.emitters, hidden);\n        FogVisualAdapter.setHidden(this._foremanWhips?.getVisual(entity), hidden);'),
]
for a,b in edits:
    a,b=a.replace('\n',nl),b.replace('\n',nl)
    if b in s: continue
    if s.count(a)!=1: raise RuntimeError('Scene hook has changed; refusing a broad replacement')
    s=s.replace(a,b,1)
# Direct truncation of this file returns Windows EINVAL. Commit the same
# scoped edit atomically, refusing to overwrite an intervening writer.
temporary=p.with_name('GameScene.foreman-patch.tmp')
temporary.write_bytes(s.encode('utf-8'))
if p.stat().st_mtime_ns!=original_stamp:
    temporary.unlink()
    raise RuntimeError('Scene changed during editing; retry from current content')
temporary.replace(p)
print('Applied scoped foreman scene hooks without replacing other edits.')
