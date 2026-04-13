# Mia

Mia is a locally deployed internal AI Agent platform for small teams.

## Structure

```text
mia/
  backend/          NestJS + Prisma API
  frontend/         React + Vite web app
  docker-compose.yml
  AGENTS.md
  docs/
```

## Install

```bash
cd backend
npm install

cd ../frontend
npm install
```

## Database

Start PostgreSQL with pgvector:

```bash
npm run db:up
```

Run Prisma migrations:

```bash
npm run prisma:generate
npm run prisma:deploy
```

## Development

Start backend:

```bash
npm run dev:api
```

Start frontend:

```bash
npm run dev:web
```

URLs:

```text
Backend:  http://127.0.0.1:8000/api/v1/health
Frontend: http://127.0.0.1:5173/
```

## Checks

```bash
npm run typecheck
npm run build
```

