import * as assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { McpClientCredentialsProvider } from "./mcp-client-credentials.provider";

async function withTokenServer(
  run: (tokenUrl: string, requestCount: () => number) => Promise<void>
): Promise<void> {
  let count = 0;
  const server = createServer((request, response) => {
    count += 1;
    assert.equal(request.method, "POST");
    assert.equal(request.headers["content-type"], "application/x-www-form-urlencoded");
    const token = `token-${count}`;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: 300 }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}/token`, () => count);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

function createProvider(tokenUrl: string): McpClientCredentialsProvider {
  return new McpClientCredentialsProvider({
    cacheKey: "server-1:version-1",
    serverId: "server-1",
    tokenUrl,
    clientAuthMethod: "body",
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenField: "access_token",
    expiresInField: "expires_in",
    tokenTypeField: "token_type",
    defaultTtlSeconds: 300,
    refreshBeforeSeconds: 60,
    timeoutMs: 1_000,
    allowPrivateNetwork: true
  });
}

export const tests = [
  {
    name: "McpClientCredentialsProvider coalesces concurrent token refreshes",
    run: async () =>
      withTokenServer(async (tokenUrl, requestCount) => {
        const provider = createProvider(tokenUrl);
        const tokens = await Promise.all([provider.token(), provider.token(), provider.token()]);
        assert.deepEqual(tokens, ["Bearer token-1", "Bearer token-1", "Bearer token-1"]);
        assert.equal(requestCount(), 1);
      })
  },
  {
    name: "McpClientCredentialsProvider refreshes once after unauthorized",
    run: async () =>
      withTokenServer(async (tokenUrl, requestCount) => {
        const provider = createProvider(tokenUrl);
        assert.equal(await provider.token(), "Bearer token-1");
        await provider.onUnauthorized();
        assert.equal(await provider.token(), "Bearer token-2");
        assert.equal(requestCount(), 2);
      })
  }
];
