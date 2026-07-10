import { HttpStatus } from "@nestjs/common";

export const ErrorCodes = {
  common: {
    badRequest: 1001,
    unauthorized: 1002,
    forbidden: 1003,
    notFound: 1004,
    conflict: 1005,
    internal: 9000
  },
  auth: {
    invalidCredentials: 1101,
    invalidSession: 1102,
    invalidPassword: 1103,
    invalidInvitation: 1104
  },
  user: {
    emailExists: 1201,
    notFound: 1202
  },
  provider: {
    notFound: 2001,
    nameExists: 2002,
    inUse: 2003,
    connectionFailed: 2004,
    modelConfigNotFound: 2005,
    modelConfigExists: 2006
  },
  agent: {
    notFound: 3001,
    invalidModelConfig: 3002,
    invalidTools: 3003,
    invalidKnowledgeBases: 3004
  },
  knowledge: {
    notFound: 4001,
    nameExists: 4002,
    invalidEmbeddingModel: 4003,
    invalidDocument: 4004,
    documentNotFound: 4005
  }
} as const;

export class AppError extends Error {
  readonly code: number;
  readonly httpStatus: number;

  constructor(code: number, message: string, httpStatus = HttpStatus.BAD_REQUEST) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
