"""Compatibility entry for the current fixed-scale six-action production pipeline."""
import runpy
import sys
from pathlib import Path

if __name__ == '__main__':
    entry = Path(__file__).with_name('rebuild-animations-20260830.py')
    sys.argv = [str(entry), 'repair-middles', *sys.argv[1:]]
    runpy.run_path(str(entry), run_name='__main__')
