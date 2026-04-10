# Mia Backend

NestJS backend for Mia.

## Install

```bash
cd backend
npm install
```

## Database

Start PostgreSQL with pgvector from the repository root:

```bash
docker compose up -d postgres
```

Run migrations:

```bash
cd backend
npm run prisma:generate
npm run prisma:deploy
```

## Run Locally

```bash
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:8000/api/v1/health
```

