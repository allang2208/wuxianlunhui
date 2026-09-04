"""Retain clean approved f61 keys and the sharper walking f51 midpoint."""
import importlib.util
import json
import sys
from pathlib import Path

import av
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1]))


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def main():
    build = module('runtime_build', 'build-runtime-sprites.py')
    task = build.read(ROOT/'task-index.json')
    if not task['allSourcesUserApproved']:
        raise RuntimeError('Approved video required')
    model = None
    original = module('original_export', 'build-sprites.py')
    for job in task['jobs']:
        if job['state'] == 'idle':
            continue
        if not job['approved']:
            raise RuntimeError(f"Unapproved video: {job['state']}")
        for index in ((51, 61) if job['state'] == 'walking' else (61,)):
            output = build.OUT/f"native-source/{job['state']}-f{index:03d}.png"
            if output.exists():
                continue
            with av.open(str(ROOT/job['video'])) as video:
                rgb = next(f.to_image().convert('RGB') for i, f in enumerate(video.decode(video=0)) if i == index)
            from rmbg_cutout import get_model, predict_alpha
            if model is None:
                model = get_model()
            rgba = original.clean(np.asarray(rgb), predict_alpha(model, rgb))
            output.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rgba).save(output)
            build.save(output.with_suffix('.json'), dict(sourceVideo=job['video'], sourceVideoFrame=index,
                outputFrame=17 if index == 51 else 20, cutout='local ComfyUI-RMBG BiRefNet-general',
                sourceTrajectoryPreserved=True, reason='Sharper real midpoint' if index == 51 else 'Avoid source f60 color artifact'))
            print(f"Retained {job['state']} source f{index}", flush=True)
    print('Clean native source samples retained. Rebuild keys, interpolate and finish before installation.', flush=True)


if __name__ == '__main__':
    main()
