from __future__ import annotations

import os
from pathlib import Path


def pytest_configure(config):
    if config.option.basetemp:
        return

    config.option.basetemp = str(Path(".tmp") / f"pytest-{os.getpid()}")
