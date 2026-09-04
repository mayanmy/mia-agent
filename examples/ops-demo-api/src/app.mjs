import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { getServiceFixture, knownServices, searchLogFixtures } from "./fixtures.mjs";

const MAX_BODY_BYTES = 256 * 1024;

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store"
  });
  response.end(payload);
}

function badRequest(response, message, details) {
  sendJson(response, 400, {
    error: { type: "invalid_request", message, ...(details ? { details } : {}) }
  });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error("request body must be a JSON object");
  }
}

function requiredString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function handleServiceHealth(url, response) {
  const serviceName = requiredString(url.searchParams.get("service_name"));
  const environment = requiredString(url.searchParams.get("environment"));
  if (!serviceName || !environment) {
    return badRequest(response, "service_name and environment are required");
  }
  const fixture = getServiceFixture(serviceName);
  if (!fixture) {
    return sendJson(response, 404, {
      error: {
        type: "service_not_found",
        message: `unknown demo service: ${serviceName}`,
        known_services: knownServices
      }
    });
  }
  return sendJson(response, 200, {
    service_name: serviceName,
    environment,
    status: fixture.status,
    health_check: fixture.health_check,
    cpu_percent: fixture.cpu_percent,
    memory_percent: fixture.memory_percent,
    latency_ms: fixture.latency_ms,
    checked_at: new Date().toISOString()
  });
}

async function handleLogSearch(request, response) {
  const body = await readJson(request);
  const serviceName = requiredString(body.service_name);
  const environment = requiredString(body.environment);
  const timeRangeMinutes = body.time_range_minutes;
  const keywords = body.keywords;
  if (!serviceName || !environment) {
    return badRequest(response, "service_name and environment are required");
  }
  if (!Number.isInteger(timeRangeMinutes) || timeRangeMinutes < 1 || timeRangeMinutes > 1440) {
    return badRequest(response, "time_range_minutes must be an integer between 1 and 1440");
  }
  if (!Array.isArray(keywords) || keywords.some((item) => !requiredString(item))) {
    return badRequest(response, "keywords must be an array of non-empty strings");
  }
  if (!getServiceFixture(serviceName)) {
    return sendJson(response, 404, {
      error: { type: "service_not_found", message: `unknown demo service: ${serviceName}` }
    });
  }
  const patterns = searchLogFixtures(serviceName, keywords);
  return sendJson(response, 200, {
    service_name: serviceName,
    environment,
    time_range_minutes: timeRangeMinutes,
    total: patterns.reduce((sum, pattern) => sum + pattern.count, 0),
    patterns,
    searched_at: new Date().toISOString()
  });
}

async function handleCreateIncident(request, response, incidents) {
  const body = await readJson(request);
  const required = ["service_name", "environment", "severity", "summary"];
  const missing = required.filter((key) => !requiredString(body[key]));
  if (missing.length > 0) return badRequest(response, "required fields are missing", missing);
  if (!body.diagnosis || typeof body.diagnosis !== "object" || Array.isArray(body.diagnosis)) {
    return badRequest(response, "diagnosis must be an object");
  }
  const sequence = incidents.length + 1;
  const date = new Date();
  const datePart = date.toISOString().slice(0, 10).replaceAll("-", "");
  const incident = {
    ticket_id: `INC-${datePart}-${String(sequence).padStart(3, "0")}`,
    request_id: randomUUID(),
    status: "open",
    service_name: body.service_name.trim(),
    environment: body.environment.trim(),
    severity: body.severity.trim(),
    summary: body.summary.trim(),
    diagnosis: body.diagnosis,
    sources: Array.isArray(body.sources) ? body.sources : [],
    created_at: date.toISOString()
  };
  incidents.push(incident);
  return sendJson(response, 201, incident);
}

export function createOpsDemoServer() {
  // 工单仅保存在当前进程内，使演示环境重启后自动恢复干净状态。
  const incidents = [];
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://ops-demo-api.local");
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { status: "ok" });
      }
      if (request.method === "GET" && url.pathname === "/api/services/health") {
        return handleServiceHealth(url, response);
      }
      if (request.method === "POST" && url.pathname === "/api/logs/search") {
        return await handleLogSearch(request, response);
      }
      if (request.method === "POST" && url.pathname === "/api/incidents") {
        return await handleCreateIncident(request, response, incidents);
      }
      if (request.method === "GET" && url.pathname === "/api/incidents") {
        return sendJson(response, 200, { items: incidents });
      }
      return sendJson(response, 404, {
        error: { type: "route_not_found", message: "route not found" }
      });
    } catch (error) {
      return badRequest(response, error instanceof Error ? error.message : "invalid request");
    }
  });
}
