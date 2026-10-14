from __future__ import annotations

import os
from pathlib import Path


def pytest_configure(config):
    if config.option.basetemp:
        return

    temp_root = Path(config.rootpath) / ".tmp"
    temp_root.mkdir(parents=True, exist_ok=True)
    config.option.basetemp = str(temp_root / f"pytest-{os.getpid()}")
