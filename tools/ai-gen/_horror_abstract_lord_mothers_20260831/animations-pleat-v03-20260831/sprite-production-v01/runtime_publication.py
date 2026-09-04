"""Preserve this immutable asset version's explicit publication record on repack."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def annotate_publication(manifest, parameters):
    path = ROOT / 'runtime-integration.json'
    if not path.exists():
        return
    publication = json.loads(path.read_text(encoding='utf-8'))
    manifest.update(stage='runtime_integrated_pending_user_validation', approvedForRuntime=True,
        runtimeIntegrated=True, runtimeIntegration='runtime-integration.json',
        worldScale=publication['scale']['runtimeScale'],
        normalZoomBodyPixels=publication['scale']['normalZoomBodyPixels'],
        maximumZoomBodyPixels=publication['scale']['maximumZoomBodyPixels'],
        collider=publication['collider'], dependencyNote=publication['dependencyNote'])
    for record in manifest['actions']:
        entry = publication['actions'][record['action']]
        record.update(registered=True, runtimeTextureKey=entry['textureKey'], runtimeTexture=entry['texture'])
        if record['action'] == 'attack':
            record['runtimeContact'] = publication['attack']
            record['visualPressPoseCandidate']['status'] = 'Historical pose candidate; runtime contact is frame 26, the earlier forward press.'
    parameters.update(status='runtime_registered', runtimeIntegration='runtime-integration.json',
        collision=publication['collider'], displaySize=448, attackReach=publication['attack']['reach'],
        warning='Publication metadata only. Game consumes data/enemy-config.json; runtime visual acceptance remains pending.')
    for action, entry in publication['actions'].items():
        parameters['actions'][action].update(textureKey=entry['textureKey'], runtimeTexture=entry['texture'])
