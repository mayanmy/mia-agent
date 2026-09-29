import { ExternalUserSource } from "@prisma/client";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { AgentApiKeysService } from "./agent-api-keys.service";
import { PublicAgentsController } from "./external-access.controller";
import { ExternalAccessService } from "./external-access.service";
import { PublicAccessService } from "./public-access.service";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export const tests: TestCase[] = [
  {
    name: "AgentApiKeysService only stores a hash and returns the raw key once",
    async run() {
      let createdData: Record<string, unknown> | null = null;
      const service = new AgentApiKeysService(
        {
          agentApiKey: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              createdData = data;
              return {
                id: "key-1",
                name: data.name,
                keyPrefix: data.keyPrefix,
                lastUsedAt: null,
                expiresAt: null,
                revokedAt: null,
                createdAt: new Date("2026-07-21T00:00:00.000Z")
              };
            }
          }
        } as never,
        {
          getAgent: async () => ({ id: "agent-1" })
        } as never
      );

      const result = await service.create("agent-1", "user-1", { name: "衣间录生产环境" });

      assert(result.apiKey.startsWith("mia_agent_"), "创建响应应返回 Agent API Key 明文");
      assert(createdData !== null, "应创建数据库记录");
      const savedData = createdData as Record<string, unknown>;
      assert(savedData.keyHash !== result.apiKey, "数据库不能保存 API Key 明文");
      assert(
        savedData.keyHash === createHash("sha256").update(result.apiKey).digest("hex"),
        "数据库应保存 API Key 的 SHA-256 哈希"
      );
    }
  },
  {
    name: "AgentApiKeysService rejects malformed keys before querying the database",
    async run() {
      let queried = false;
      const service = new AgentApiKeysService(
        {
          agentApiKey: {
            findFirst: async () => {
              queried = true;
              return null;
            }
          }
        } as never,
        {} as never
      );

      const result = await service.authenticate("not-an-agent-key");

      assert(result === null, "格式不合法的 Key 应被拒绝");
      assert(!queried, "格式不合法的 Key 不应触发数据库查询");
    }
  },
  {
    name: "PublicAccessService rejects requests whose Origin is not in the Agent allowlist",
    async run() {
      const service = new PublicAccessService(
        {
          getPublicAccessRuntime: async () => ({
            id: "agent-1",
            workspaceId: "00000000-0000-4000-8000-000000000001",
            name: "受保护 Agent",
            description: "",
            modelName: "qwen",
            providerName: "Ollama",
            passwordRequired: false,
            publicExpiresAt: null,
            publicAllowedOrigins: ["https://widget.example.com"],
            publicPasswordHash: null
          })
        } as never,
        {} as never
      );
      let rejected = false;

      try {
        await service.getPublicProfile("share-token", "https://untrusted.example.com");
      } catch (error) {
        rejected = error instanceof Error && error.message === "公开访问来源未获授权";
      }

      assert(rejected, "配置来源白名单后，其他域名不能加载公开 Agent 资料");
    }
  },
  {
    name: "PublicAccessService verifies a configured public access password",
    async run() {
      const service = new PublicAccessService(
        {
          getPublicAccessRuntime: async () => ({
            id: "agent-1",
            workspaceId: "00000000-0000-4000-8000-000000000001",
            name: "受密码保护 Agent",
            description: "",
            modelName: "qwen",
            providerName: "Ollama",
            passwordRequired: true,
            publicExpiresAt: null,
            publicAllowedOrigins: [],
            publicPasswordHash: "stored-hash"
          })
        } as never,
        {
          verifyPassword: async (_hash: string, password: string) => password === "Mia12345"
        } as never
      );
      let rejected = false;

      try {
        await service.verifyAccess("share-token", undefined, "wrong-password");
      } catch (error) {
        rejected = error instanceof Error && error.message === "公开访问密码错误";
      }
      assert(rejected, "错误密码必须被公开访问入口拒绝");

      await service.verifyAccess("share-token", undefined, "Mia12345");
    }
  },
  {
    name: "PublicAgentsController injects the token-derived workspace into Widget history calls",
    async run() {
      const workspaceId = "00000000-0000-4000-8000-000000000001";
      let observedWorkspaceId: string | null = null;
      const controller = new PublicAgentsController(
        {
          listConversationMessages: async () => {
            observedWorkspaceId = requireWorkspaceId();
            return [];
          }
        } as never,
        {
          assertAllowed: () => undefined
        } as never,
        {
          resolvePublicAgent: async () => ({
            id: "agent-1",
            workspaceId
          })
        } as never
      );

      await controller.getMessages(
        "conversation-1",
        {
          agentToken: "share-token",
          sessionId: "widget-session-1"
        },
        {
          headers: {},
          socket: { remoteAddress: "127.0.0.1" }
        } as never
      );

      assert(
        observedWorkspaceId === workspaceId,
        "Widget 的下游调用必须读取到分享令牌对应的可信空间"
      );
    }
  },
  {
    name: "PublicAgentsController preserves the token-derived workspace while consuming Widget SSE",
    async run() {
      const workspaceId = "00000000-0000-4000-8000-000000000001";
      let observedWorkspaceId: string | null = null;
      const controller = new PublicAgentsController(
        {
          async *streamMessage() {
            observedWorkspaceId = requireWorkspaceId();
            yield { type: "message_end", data: { content: "ok" } };
          }
        } as never,
        {
          assertAllowed: () => undefined
        } as never,
        {
          resolvePublicAgent: async () => ({
            id: "agent-1",
            workspaceId
          })
        } as never
      );
      const request = Object.assign(new EventEmitter(), {
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
        requestId: "request-1"
      });
      const response = Object.assign(new EventEmitter(), {
        statusCode: 0,
        setHeader: () => undefined,
        flushHeaders: () => undefined,
        write: () => true,
        end: () => undefined
      });

      await controller.chat(
        {
          agentToken: "share-token",
          sessionId: "widget-session-1",
          message: "为什么流水线取消了"
        },
        request as never,
        response as never
      );

      assert(
        observedWorkspaceId === workspaceId,
        "Widget SSE 的 AsyncGenerator 迭代期间必须保持可信空间上下文"
      );
    }
  },
  {
    name: "ExternalAccessService prevents a service user from reading another user's conversation",
    async run() {
      const service = new ExternalAccessService(
        {
          externalEndUser: {
            findFirst: async () => ({ id: "end-user-1" })
          },
          externalConversation: {
            findFirst: async () => null
          }
        } as never,
        {} as never,
        {} as never
      );
      let failed = false;

      try {
        await service.listMessages("agent-1", "ootd:user-a", "conversation-of-user-b");
      } catch (error) {
        failed = error instanceof Error && error.message === "会话不存在或无权访问";
      }

      assert(failed, "不同 Service user 读取会话必须返回统一的无权限错误");
    }
  },
  {
    name: "ExternalAccessService persists completed public assistant messages",
    async run() {
      const createdMessages: Array<Record<string, unknown>> = [];
      const service = new ExternalAccessService(
        {
          agent: {
            findUniqueOrThrow: async () => ({
              workspaceId: "00000000-0000-4000-8000-000000000001"
            })
          },
          externalEndUser: {
            upsert: async () => ({
              id: "end-user-1",
              workspaceId: "00000000-0000-4000-8000-000000000001"
            })
          },
          externalConversation: {
            create: async () => ({ id: "conversation-1" }),
            update: async () => ({})
          },
          externalMessage: {
            findMany: async () => [],
            create: async ({ data }: { data: Record<string, unknown> }) => {
              createdMessages.push(data);
              return {};
            }
          }
        } as never,
        {
          getAgentRuntimeConfig: async () => ({ historyTurns: 6 })
        } as never,
        {
          async *streamCompletion() {
            yield { type: "message_start", data: {} };
            yield { type: "message_end", data: { content: "Workflow 最终答案" } };
          }
        } as never
      );
      const events = [];

      for await (const event of service.streamMessage(
        {
          agentId: "agent-1",
          source: ExternalUserSource.WIDGET,
          externalId: "widget-session-1"
        },
        { message: "你好" }
      )) {
        events.push(event);
      }

      assert(events[0]?.data.conversationId === "conversation-1", "首个 SSE 事件应返回会话 ID");
      assert(createdMessages.length === 2, "完成响应应保存用户与助手两条消息");
      assert(
        createdMessages[1]?.content === "Workflow 最终答案",
        "无 token 的 Workflow End answer 也应在 message_end 后写入"
      );
    }
  }
];
