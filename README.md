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

## MVP Workflow

Start the API:

```powershell
pnpm dev:api
```

Start the web app:

```powershell
pnpm dev:web
```

Open `http://127.0.0.1:5173`.

Create a small workflow:

1. Add a Manual Trigger node.
2. Add a Log node.
3. Connect Manual Trigger `success` to Log `input`.
4. Validate the workflow.
5. Run the workflow.
6. Inspect the run events to confirm the Log node succeeded.

Python node files live under `nodes/` and become available through `@node(...)` discovery.
