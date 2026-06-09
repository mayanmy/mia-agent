import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";

import { AppError, ErrorCodes } from "./errors";
import { failure } from "./result";

type HttpExceptionResponse = {
  message?: string | string[];
  error?: string;
  code?: number;
};

type JsonResponse = {
  status(statusCode: number): {
    json(body: unknown): void;
  };
};

function normalizeMessage(message: unknown, fallback: string): string {
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
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    if (exception instanceof AppError) {
      response.status(exception.httpStatus).json(failure(exception.code, exception.message));
      return;
    }

    if (exception instanceof HttpException) {
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

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(failure(ErrorCodes.common.internal, "internal server error"));
  }

  private mapHttpStatusToCode(status: number): number {
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
