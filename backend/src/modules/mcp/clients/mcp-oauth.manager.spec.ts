import * as assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { McpAuthType } from "@prisma/client";

import { decryptSecret, encryptSecret } from "../../../core/crypto";
import { McpOAuthManager } from "./mcp-oauth.manager";

type OAuthRecord = {
  id: string;
  serverId: string;
  encryptedState: string;
  stateHash: string | null;
  stateExpiresAt: Date | null;
  authorizedAt: Date | null;
  createdByUserId: string;
};

async function startOAuthServer(): Promise<{
  issuer: string;
  tokenRequest: () => URLSearchParams | undefined;
  close: () => Promise<void>;
}> {
  let issuer = "";
  let tokenRequest: URLSearchParams | undefined;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", issuer);
    if (url.pathname.includes("oauth-protected-resource")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ resource: `${issuer}/mcp`, authorization_servers: [issuer] }));
      return;
    }
    if (url.pathname.includes("oauth-authorization-server")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"]
        })
      );
      return;
    }
    if (url.pathname === "/token") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        tokenRequest = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            access_token: "oauth-access-token",
            refresh_token: "oauth-refresh-token",
            token_type: "Bearer",
            expires_in: 300,
            scope: "mcp.read"
          })
        );
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    tokenRequest: () => tokenRequest,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

function createPrisma(endpoint: string) {
  const server = {
    id: "11111111-1111-4111-8111-111111111111",
    endpoint,
    authType: McpAuthType.OAUTH,
    authConfig: { scope: "mcp.read", clientAuthMethod: "client_secret_basic" },
    allowPrivateNetwork: true,
    deletedAt: null,
    secret: {
      encryptedValue: encryptSecret(
        JSON.stringify({ clientId: "mia-test-client", clientSecret: "mia-test-secret" })
      )
    }
  };
  let authorization: OAuthRecord | undefined;
  const apply = (data: Record<string, unknown>) => {
    if (!authorization) return;
    Object.assign(authorization, data);
  };
  const prisma = {
    mcpServer: {
      findFirst: async () => server,
      update: async () => server
    },
    mcpOAuthAuthorization: {
      upsert: async ({ create }: { create: OAuthRecord }) => {
        authorization ??= {
          ...create,
          stateHash: null,
          stateExpiresAt: null,
          authorizedAt: null
        };
        return authorization;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        apply(data);
        return authorization;
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        apply(data);
        return { count: authorization ? 1 : 0 };
      },
      findUnique: async ({ where }: { where: { serverId?: string; stateHash?: string } }) => {
        if (!authorization) return null;
        if (where.serverId && where.serverId !== authorization.serverId) return null;
        if (where.stateHash && where.stateHash !== authorization.stateHash) return null;
        return where.stateHash ? { ...authorization, server } : authorization;
      }
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations)
  };
  return { prisma, getAuthorization: () => authorization };
}

export const tests = [
  {
    name: "McpOAuthManager completes discovery PKCE and authorization code exchange",
    run: async () => {
      const oauthServer = await startOAuthServer();
      try {
        const { prisma, getAuthorization } = createPrisma(`${oauthServer.issuer}/mcp`);
        const manager = new McpOAuthManager(prisma as never);
        const start = await manager.startAuthorization(
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222"
        );
        const authorizationUrl = new URL(start.authorizationUrl);
        assert.equal(authorizationUrl.origin, oauthServer.issuer);
        assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
        assert.ok(authorizationUrl.searchParams.get("code_challenge"));
        assert.equal(authorizationUrl.searchParams.get("resource"), `${oauthServer.issuer}/mcp`);
        const state = authorizationUrl.searchParams.get("state");
        assert.ok(state);

        const serverId = await manager.completeAuthorization({
          state,
          code: "authorization-code"
        });
        assert.equal(serverId, "11111111-1111-4111-8111-111111111111");
        const tokenRequest = oauthServer.tokenRequest();
        assert.equal(tokenRequest?.get("grant_type"), "authorization_code");
        assert.equal(tokenRequest?.get("code"), "authorization-code");
        assert.ok(tokenRequest?.get("code_verifier"));
        assert.equal(tokenRequest?.get("resource"), `${oauthServer.issuer}/mcp`);

        const authorization = getAuthorization();
        assert.ok(authorization?.authorizedAt);
        assert.equal(authorization?.stateHash, null);
        const persisted = JSON.parse(decryptSecret(authorization!.encryptedState)) as {
          tokens?: { access_token?: string; refresh_token?: string };
          codeVerifier?: string;
        };
        assert.equal(persisted.tokens?.access_token, "oauth-access-token");
        assert.equal(persisted.tokens?.refresh_token, "oauth-refresh-token");
        assert.equal(persisted.codeVerifier, undefined);
      } finally {
        await oauthServer.close();
      }
    }
  }
];
