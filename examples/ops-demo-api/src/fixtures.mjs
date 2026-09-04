const serviceFixtures = {
  "mia-api": {
    status: "degraded",
    health_check: "failed",
    cpu_percent: 48,
    memory_percent: 72,
    latency_ms: 3800,
    logs: [
      ["timeout", "database connection acquisition timeout"],
      ["connection", "remaining connection slots are reserved"],
      ["502", "upstream returned 502 while waiting for database"]
    ]
  },
  "mia-llm-gateway": {
    status: "degraded",
    health_check: "passed",
    cpu_percent: 31,
    memory_percent: 55,
    latency_ms: 18200,
    logs: [
      ["timeout", "provider first token timeout after 15000ms"],
      ["provider", "upstream model provider request failed"],
      ["502", "provider gateway returned 502"]
    ]
  },
  "mia-indexer": {
    status: "degraded",
    health_check: "passed",
    cpu_percent: 36,
    memory_percent: 61,
    latency_ms: 920,
    logs: [
      ["429", "embedding provider rate limit exceeded"],
      ["embedding", "document indexing retry scheduled"],
      ["index", "knowledge document remains in processing state"]
    ]
  },
  "mia-web": {
    status: "healthy",
    health_check: "passed",
    cpu_percent: 18,
    memory_percent: 42,
    latency_ms: 86,
    logs: []
  }
};

export function getServiceFixture(serviceName) {
  return serviceFixtures[serviceName];
}

export function searchLogFixtures(serviceName, keywords) {
  const fixture = getServiceFixture(serviceName);
  if (!fixture) return [];
  const normalized = keywords.map((keyword) => keyword.toLowerCase());
  return fixture.logs
    .filter(([keyword, sample]) =>
      normalized.some((query) => keyword.includes(query) || sample.toLowerCase().includes(query))
    )
    .map(([keyword, sample], index) => ({ keyword, count: 4 - index, sample }));
}

export const knownServices = Object.keys(serviceFixtures);
