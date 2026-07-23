import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { AppError, ErrorCodes } from "../../../core/errors";
import { RequestWithId } from "../../../core/request-id.middleware";
import { AgentApiKeysService } from "../agent-api-keys.service";

export type AgentApiKeyRequest = Request & {
  requestId?: RequestWithId["requestId"];
  agentApiKey?: {
    id: string;
    agentId: string;
  };
};

@Injectable()
export class AgentApiKeyGuard implements CanActivate {
  constructor(private readonly agentApiKeysService: AgentApiKeysService) {}

  /**
   * 仅接受服务端通过 Authorization Header 传入的 Agent API Key。
   *
   * 这个 Guard 不复用工作台 JWT Guard：两种凭证的轮换、失效与审计规则完全不同，
   * 复用会使公开 Service API 意外接受员工登录 Token。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentApiKeyRequest>();
    const apiKey = this.extractBearerToken(request.headers.authorization);

    if (!apiKey) {
      throw this.createUnauthorizedError();
    }

    const record = await this.agentApiKeysService.authenticate(apiKey);

    if (!record) {
      throw this.createUnauthorizedError();
    }

    request.agentApiKey = record;
    return true;
  }

  /** 只解析单一 Bearer Header，不允许从 Query/Cookie 回退读取服务端密钥。 */
  private extractBearerToken(authorization: string | undefined): string | null {
    const [scheme, token, ...rest] = authorization?.trim().split(/\s+/u) ?? [];

    if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
      return null;
    }

    return token;
  }

  /** 统一认证失败文案，不区分格式、撤销和过期等内部原因。 */
  private createUnauthorizedError(): AppError {
    return new AppError(
      ErrorCodes.externalAccess.invalidApiKey,
      "Agent API Key 无效或已失效",
      HttpStatus.UNAUTHORIZED
    );
  }
}
