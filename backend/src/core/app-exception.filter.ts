import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";

import { AppError, ErrorCodes } from "./errors";
import { failure } from "./result";

/** Nest HttpException 可能返回的结构化错误字段子集。 */
type HttpExceptionResponse = {
  message?: string | string[];
  error?: string;
  code?: number;
};

/** 对 Express/Fastify 响应对象使用的最小适配接口。 */
type JsonResponse = {
  status(statusCode: number): {
    json(body: unknown): void;
  };
};

function normalizeMessage(message: unknown, fallback: string): string {
  // class-validator 会返回字符串数组，统一合并后保持全局 Result 结构稳定。
  if (Array.isArray(message)) {
    return message.join("; ");
  }

  if (typeof message === "string" && message.length > 0) {
    return message;
  }

  return fallback;
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  /** 将业务异常、Nest 异常和未知异常统一映射为固定失败响应。 */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    if (exception instanceof AppError) {
      // AppError 已由业务层明确分类，保留其稳定 code 与 HTTP 状态。
      response.status(exception.httpStatus).json(failure(exception.code, exception.message));
      return;
    }

    if (exception instanceof HttpException) {
      // Guard/Pipe 等框架异常不一定是 AppError，需要补齐 Mia 业务错误码。
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === "object" && exceptionResponse !== null) {
        const body = exceptionResponse as HttpExceptionResponse;
        response
          .status(status)
          .json(
            failure(
              body.code ?? this.mapHttpStatusToCode(status),
              normalizeMessage(body.message, exception.message)
            )
          );
        return;
      }

      response.status(status).json(failure(this.mapHttpStatusToCode(status), exception.message));
      return;
    }

    // 未知异常不回显 message/stack，避免把数据库、密钥或内部路径泄露给客户端。
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(failure(ErrorCodes.common.internal, "internal server error"));
  }

  private mapHttpStatusToCode(status: number): number {
    // 只映射客户端需要稳定识别的通用状态，其余 4xx 统一视为参数错误。
    if (status === HttpStatus.UNAUTHORIZED) {
      return ErrorCodes.common.unauthorized;
    }

    if (status === HttpStatus.FORBIDDEN) {
      return ErrorCodes.common.forbidden;
    }

    if (status === HttpStatus.NOT_FOUND) {
      return ErrorCodes.common.notFound;
    }

    if (status === HttpStatus.CONFLICT) {
      return ErrorCodes.common.conflict;
    }

    return ErrorCodes.common.badRequest;
  }
}
