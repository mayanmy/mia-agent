# Mia Backend

FastAPI backend for Mia.

## Run Locally

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

## Database

Start PostgreSQL with pgvector from the repository root:

```bash
docker compose up -d postgres
```

Run migrations from the backend directory:

```bash
alembic upgrade head
```

Health check:

```bash
curl http://127.0.0.1:8000/api/v1/health
```
