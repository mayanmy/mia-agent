# Mia Backend

NestJS backend for Mia.

## Install

```bash
cd backend
npm install
cp .env.example .env
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

## Tools

`http_request` blocks localhost and private network addresses by default. To restrict
the tool to specific hosts, configure:

```bash
TOOLS_HTTP_ALLOWED_HOSTS=api.example.com,*.trusted.example.com
```

When this variable is set, `http_request` only allows exact host matches or
wildcard subdomain matches. Exact matches may include a port, for example
`localhost:5174`.

For local development only, localhost can be enabled explicitly:

```bash
MIA_TOOLS_HTTP_ALLOW_LOCALHOST=true
MIA_TOOLS_HTTP_ALLOWED_HOSTS=localhost:5174
```

Private network addresses remain blocked.
