# Node Flow

Node Flow is a workflow automation editor with a React Flow frontend and a FastAPI backend. Python classes registered with decorators become workflow node types.

## Development

Install frontend dependencies:

```powershell
pnpm install
```

Install backend dependencies:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
```

Run the backend:

```powershell
pnpm dev:api
```

Run the frontend:

```powershell
pnpm dev:web
```

Run tests:

```powershell
pnpm test
```
