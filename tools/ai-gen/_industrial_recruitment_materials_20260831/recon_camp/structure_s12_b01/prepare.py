"""Prepare the next 12-step building batch without submitting network jobs."""
from datetime import datetime
import importlib.util
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
MODEL_DIR = HERE.parent
KEY = 'recon_camp_industrial'
NOW = datetime.now().astimezone().isoformat()


def relative(path):
    return path.relative_to(REPO).as_posix()


manifest = {
    'host': '192.168.3.142', 'port': 8188,
    'model': 'flux2-dev-depth',
    'styleVersion': 'world122-building-v5',
    'styleTemplate': 'tools/ai-gen/prompts/world122-building-style.md',
    'size': '1024x1024', 'cfg': 3.5, 'sampler': 'euler', 'scheduler': 'simple',
    'generationTimeout': 1800, 'steps': 12, 'structureSteps': 12,
    'structureVariants': 3, 'structureDepthStrength': 0.78,
    'useEdgeControl': False, 'maskEdgePad': 16,
    'stage': 'structure', 'batchId': 'industrial-recon-camp-s12-b01',
    'structureSeedBase': 831750,
    'outputRoot': relative(HERE / 'candidates'),
    'status': 'prepared_not_submitted',
    'runtimeIntegrationActive': False,
    'continuation': {
        'recordedAt': NOW,
        'userStatement': '继续',
        'earlierDirection': '同意，接下来开始逐步12步生图',
        'interpretation': 'Continue the intermediate-era building art sequence with recon camp, the first remaining building. Keep the completed city-hall cutout unchanged.',
        'scope': 'Three 12-step raw candidates only; no 48-step refinement, cutout, era configuration or runtime installation.',
    },
    'submission': {
        'destination': 'http://192.168.3.142:8188',
        'payload': 'Only the industrial recon-camp Depth PNG and prepared prompt with generation parameters.',
        'excluded': 'Blender models, source code, saves, other images and other destinations.',
        'generatedCandidates': 0, 'submitted': False,
    },
    'assets': [{
        'id': KEY, 'label': '近代侦察营地',
        'assetClass': 'scout_command_compound',
        'assetType': 'World-122 compact industrial-era reconnaissance camp',
        'footprintCells': 2, 'footprintMode': 'authored',
        'foundationStyle': 'rubble_stone',
        'foundationRoutingNote': 'Retain the source model fieldstone foundation; this is an intermediate-era candidate, not the accepted modern tier.',
        'model': relative(MODEL_DIR / 'recon_camp_material_model.blend'),
        'modelPreview': relative(MODEL_DIR / 'recon_camp_material_approval_preview.png'),
        'controlImage': relative(MODEL_DIR / 'recon_camp_depth.png'),
        'postprocessDepthImage': relative(MODEL_DIR / 'recon_camp_depth.png'),
        'primaryRequest': (
            'Render the supplied reconnaissance-camp model as its industrial-era material evolution. '
            'Use gray-beige brick walls, muted gray-green painted sheet-metal on the continuous gable roof, '
            'lookout cap and attached supply awning, matte dark-steel tower posts and ladder, '
            'khaki supply packs, subdued wood doors and restrained aged-brass compass fittings. '
            'Keep the two plain narrow signal pennants, the shallow shuttered windows and every existing opening. '
            'Metal roofing has sparse seams and broad quiet panels.'
        ),
        'negativeRequest': 'No clay roof tiles, thatch, camouflage pattern, extra storey, sealed lookout supports or bright colored pennants.',
        'removeAllGreen': False,
    }],
}

for field in ('model', 'modelPreview', 'controlImage'):
    if not (REPO / manifest['assets'][0][field]).is_file():
        raise FileNotFoundError(manifest['assets'][0][field])

spec = importlib.util.spec_from_file_location('building_candidates', REPO / 'tools/ai-gen/generate-world122-building-candidates.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
prompt = generator.prompt_for(manifest['assets'][0], manifest, 'structure')
(HERE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(HERE / 'prepared-prompt.txt').write_text(prompt, encoding='utf-8')
print(f'Prepared {KEY}: 3 x 12 steps; {len(prompt.split())} prompt words. No upload performed.')
