from __future__ import annotations

import json
from pathlib import Path


def test_local_project_ports_are_shifted_up_by_100() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    checked_roots = [
        repo_root / "apps",
        repo_root / "docs",
        repo_root / "examples",
        repo_root / "reports",
        repo_root / "tests",
        repo_root / "tmp",
        repo_root / "README.md",
        repo_root / "package.json",
    ]
    legacy_ports = {"51" + "73", "51" + "74", "80" + "50"}
    ignored_names = {".pytest_cache", "__pycache__", "node_modules"}
    ignored_suffixes = {".pyc", ".sqlite3"}
    this_file = Path(__file__).resolve()

    offenders: list[str] = []
    for root in checked_roots:
        if not root.exists():
            continue
        paths = [root] if root.is_file() else root.rglob("*")
        for path in paths:
            if path == this_file or not path.is_file():
                continue
            if ignored_names.intersection(path.parts) or path.suffix in ignored_suffixes:
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if any(port in content for port in legacy_ports):
                offenders.append(str(path.relative_to(repo_root)))

    assert offenders == []


def test_local_dev_scripts_use_fixed_shifted_ports() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    root_package = json.loads((repo_root / "package.json").read_text(encoding="utf-8"))
    web_package = json.loads((repo_root / "apps" / "web" / "package.json").read_text(encoding="utf-8"))

    assert root_package["scripts"]["dev:api"] == (
        "uvicorn apps.api.nodeflow_api.main:create_app --factory --reload --host 127.0.0.1 --port 8150"
    )
    assert web_package["scripts"]["dev"] == "vite --host 127.0.0.1 --port 5273 --strictPort"
