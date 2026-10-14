#!/usr/bin/env python3
"""Build a source-only snapshot; never copy local accounts or market databases."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from release_tools import build_snapshot

if __name__ == '__main__':
    print(build_snapshot(ROOT))
