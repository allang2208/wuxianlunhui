"""Prepare the accepted recon-camp V03 for two standard 48-step candidates."""
from datetime import datetime
import importlib.util
import json
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
STRUCTURE_DIR = HERE.parent / 'structure_s12_b01'
KEY = 'recon_camp_industrial'
USER_REQUEST = '同意继续 48 步'


def relative(path):
    return path.relative_to(REPO).as_posix()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if (HERE / 'manifest.json').exists():
    raise SystemExit('Batch already prepared; do not overwrite its state.')

original = json.loads((STRUCTURE_DIR / 'manifest.json').read_text(encoding='utf-8'))
selected = STRUCTURE_DIR / 'candidates' / KEY / f'{KEY}_structure_v03_raw.png'
with Image.open(selected) as source:
    if source.mode != 'RGB' or source.size != (1024, 1024):
        raise SystemExit('Expected the unmodified 1024-square RGB V03 raw source.')

approval = {
    'recordedAt': datetime.now().astimezone().isoformat(),
    'userStatement': USER_REQUEST,
    'acceptedSource': relative(selected), 'selectedCandidate': 3, 'seed': 831753,
    'selectionBasis': 'User agreed to continue with 48 steps immediately after the recommendation of V03 and its compass/color corrections.',
    'scope': 'Two standard 48-step raw candidates with a smaller subdued compass and calmer roof rust. No cutout or runtime replacement.',
}
asset = dict(original['assets'][0])
request = (
    'Refine the selected industrial reconnaissance camp V03 supplied as the initial image. '
    'Preserve its hall, single lookout cabin, tower supports, railings, ladder, doors, windows, '
    'two narrow muted pennants, supply awning, packs, complete stone foundation and sparse metal roof seams. '
    'The sole local shape correction is the existing compass emblem: reduce its diameter to about '
    '65 percent of the current size, remove the pendant loop and pocket-watch fittings, and retain '
    'one simple attached compass medallion near the lower roof above the entrance. '
    'Make its brass dull and understated. Soften the orange roof rust into faint neutral wear. '
    'Improve only material clarity, with quiet gray-green sheet metal, gray-beige brick, dark steel, '
    'subdued wood and khaki fabric; keep all other geometry and colors.'
)
asset.update(
    primaryRequest=request, detailRequest=request,
    negativeRequest='No second emblem, hanging pocket watch, enlarged bright-gold crest, dense roof corrugation, vivid orange rust, added supplies, changed flag count, clay tiles, extra building or cast shadow.',
)
manifest = {name: original[name] for name in (
    'host', 'port', 'model', 'styleVersion', 'styleTemplate', 'size', 'cfg', 'sampler',
    'scheduler', 'generationTimeout', 'useEdgeControl', 'maskEdgePad',
)}
manifest.update(
    steps=48, refineSteps=48, refineVariants=2, refineDepthStrength=0.75, refineDenoise=0.30,
    refineSeedBase=831760, stage='refine', batchId='industrial-recon-camp-s48-v03-b01',
    outputRoot=relative(HERE / 'candidates'), initImage=relative(selected),
    status='approved_refinement_prepared', runtimeIntegrationActive=False,
    refinementApproval=approval,
    sourcePreparation={
        'source': relative(selected), 'sourceSize': [1024, 1024], 'sourceMode': 'RGB',
        'input': relative(selected), 'inputSize': [1024, 1024],
        'operation': 'Use the complete original RGB raw directly; no resize, crop, recolor, cutout or duplicate input copy.',
    },
    controlNotes={
        'depth': asset['controlImage'],
        'basis': 'Same authored model Depth for view and massing; selected V03 raw is the appearance source.',
        'postprocessing': 'Raw-only. Do not use the older Depth as a hard Alpha mask for changed fine details.',
    },
    submission={
        'destination': 'http://192.168.3.142:8188',
        'payload': 'Only the selected recon-camp V03 raw PNG, the same recon-camp Depth PNG, and prepared refinement prompt with standard generation parameters.',
        'excluded': 'Blender models, source code, saves, unrelated images, other destinations and runtime replacement.',
        'authorizationBasis': 'User explicitly requested 48-step continuation after authorizing this building at the same LAN service; the earlier 12-step permission record is retained unchanged.',
        'userRequest': USER_REQUEST, 'generatedCandidates': 0, 'submitted': False,
    },
    assets=[asset],
)
spec = importlib.util.spec_from_file_location('building_refine_generator', REPO / 'tools/ai-gen/generate-world122-building-candidates.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
prompt = generator.prompt_for(asset, manifest, 'refine')
(HERE / 'prepared-prompt.txt').write_text(prompt, encoding='utf-8')
write_json(HERE / 'manifest.json', manifest)

original['status'] = 'v03_accepted_for_48_step_refinement'
original['review'].update(
    userSelected=True, selectedCandidate=3, approvedForRefinement=True,
    refinementApproval=approval, refinementManifest=relative(HERE / 'manifest.json'),
    summary='User accepted continuation from recommended V03 into 48 steps, with a smaller calmer compass and subdued roof rust. Source and all sibling candidates remain; no runtime installation.',
)
write_json(STRUCTURE_DIR / 'manifest.json', original)
write_json(HERE.parent / 'selection.json', {
    **approval, 'stage': 'selected_12_step_source_for_refinement',
    'refinementManifest': relative(HERE / 'manifest.json'), 'runtimeIntegrationActive': False,
})
print(f'Prepared {KEY}: V03 direct raw -> 2 x 48 steps, Depth .75, denoise .30, {len(prompt.split())} prompt words. No upload yet.')
