import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createOpsDemoServer } from "../src/app.mjs";

const server = createOpsDemoServer();
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

test("returns deterministic health data", async () => {
  const response = await fetch(
    `${baseUrl}/api/services/health?service_name=mia-api&environment=production`
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "degraded");
  assert.equal(body.health_check, "failed");
});

test("filters log patterns by keywords", async () => {
  const response = await fetch(`${baseUrl}/api/logs/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      service_name: "mia-indexer",
      environment: "production",
      time_range_minutes: 30,
      keywords: ["429"]
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.patterns.length, 1);
  assert.equal(body.patterns[0].keyword, "429");
});

test("creates and lists an incident", async () => {
  const createResponse = await fetch(`${baseUrl}/api/incidents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      service_name: "mia-api",
      environment: "production",
      severity: "P2",
      summary: "数据库连接池耗尽",
      diagnosis: { root_cause: "connection pool exhausted" },
      sources: []
    })
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.ticket_id, /^INC-\d{8}-001$/);

  const listResponse = await fetch(`${baseUrl}/api/incidents`);
  const list = await listResponse.json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].ticket_id, created.ticket_id);
});

test("rejects unknown services and invalid input", async () => {
  const missing = await fetch(
    `${baseUrl}/api/services/health?service_name=unknown&environment=production`
  );
  assert.equal(missing.status, 404);

  const invalid = await fetch(`${baseUrl}/api/logs/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ service_name: "mia-api" })
  });
  assert.equal(invalid.status, 400);
});
