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

## Docker deployment

The frontend and backend use separate Compose files. They can run independently on
one host or be copied to different servers. The backend stack includes PostgreSQL,
Prisma migrations and the API; the frontend stack contains Nginx and static assets.

```bash
chmod +x deploy.sh
./deploy.sh
```

Deploy them independently:

```bash
./deploy-backend.sh
./deploy-frontend.sh
```

For different servers, copy the repository and `.env.docker` to both hosts. Set
`MIA_API_UPSTREAM` on the frontend host to the reachable backend URL, and set
`MIA_PUBLIC_BASE_URL` plus `MIA_CORS_ORIGINS` on the backend host to the frontend URL.

For a Baota Panel deployment with HTTPS and SSE proxy settings, see
[`docs/baota-nginx-deployment.md`](docs/baota-nginx-deployment.md).

On first run, the script creates `.env.docker` with random database and application
secrets. Before exposing Mia outside the host, set `MIA_PUBLIC_BASE_URL` to the HTTPS
URL and set `MIA_AUTH_COOKIE_SECURE=true`, then run `./deploy.sh` again.

Useful operations:

```bash
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml logs -f
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml logs -f
docker compose -p mia-backend --env-file .env.docker -f docker-compose.backend.yml down
docker compose -p mia-frontend --env-file .env.docker -f docker-compose.frontend.yml down
```

## Agent Widget

Production embed code should use the minified widget:

```html
<script
  src="https://your-mia-host/mia-agent-widget.min.js"
  data-agent-token="YOUR_SHARE_TOKEN"
  data-api-base="https://your-mia-host"
  async
></script>
```

Use `frontend/public/mia-agent-widget.js` for development and debugging only.
After changing it, run `npm run build:widget` in `frontend/` to regenerate
`frontend/public/mia-agent-widget.min.js`.

## Checks

```bash
npm run typecheck
npm run build
```
