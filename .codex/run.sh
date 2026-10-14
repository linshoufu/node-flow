#!/bin/zsh
set -eu
project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
export PATH="$HOME/.local/bin:$project_root/.venv/bin:$PATH"
export NO_PROXY="${NO_PROXY:-},localhost,127.0.0.1,::1"
export no_proxy="$NO_PROXY"
case "${1:-}" in
  install) uv sync --frozen --extra test --python 3.12; exec pnpm install --frozen-lockfile ;;
  dev:web|dev:api|build:web|lint:web|lint:api|test:web|test:api|doctor:nodes)
    action="$1"; shift; exec uv run --frozen --extra test pnpm "$action" "$@" ;;
  *) print -u2 '用法：.codex/run.sh install|dev:web|dev:api|build:web|lint:web|lint:api|test:web|test:api|doctor:nodes'; exit 2 ;;
esac
