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

## Environment

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
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

## Agent Widget

Production embed code should use the minified widget:

```html
<script src="https://your-mia-host/mia-agent-widget.min.js" data-agent-token="YOUR_SHARE_TOKEN" data-api-base="https://your-mia-host" async></script>
```

Use `frontend/public/mia-agent-widget.js` for development and debugging only.
After changing it, run `npm run build:widget` in `frontend/` to regenerate
`frontend/public/mia-agent-widget.min.js`.

## Checks

```bash
npm run typecheck
npm run build
```
