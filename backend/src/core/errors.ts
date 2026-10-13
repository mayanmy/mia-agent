import { HttpStatus } from "@nestjs/common";

/** 对外稳定的业务错误码；HTTP 状态只描述传输语义，客户端分支应依赖这里的 code。 */
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
    invalidKnowledgeBases: 3004,
    invalidWorkflow: 3005
  },
  knowledge: {
    notFound: 4001,
    nameExists: 4002,
    invalidEmbeddingModel: 4003,
    invalidDocument: 4004,
    documentNotFound: 4005
  },
  externalAccess: {
    invalidApiKey: 5001,
    invalidExternalUser: 5002,
    conversationNotFound: 5003,
    rateLimited: 5004
  },
  agentRun: {
    notFound: 6001,
    invalidState: 6002
  },
  chat: {
    historyInvalid: 8001,
    historyMessageTooLarge: 8002,
    historyPayloadTooLarge: 8003,
    historyPolicyViolation: 8004,
    agentVisionDisabled: 8010,
    primaryModelNoVision: 8011,
    defaultVisionModelNotConfigured: 8012,
    visionModelDisabled: 8013,
    modelCapabilityMismatch: 8014,
    unsupportedImageType: 8015,
    imageTooLarge: 8016,
    tooManyImages: 8017
  },
  workflow: {
    notFound: 7001,
    versionNotFound: 7002,
    revisionConflict: 7003,
    invalidGraph: 7004,
    notPublished: 7005,
    validationFailed: 7006,
    resourceUnavailable: 7007,
    nodeFailed: 7008,
    nodeTimeout: 7009,
    executionLimitExceeded: 7010,
    contextTooLarge: 7011,
    outputInvalid: 7012
  },
  mcp: {
    notFound: 9001,
    slugExists: 9002,
    connectionFailed: 9003,
    invalidConfiguration: 9004,
    toolNotFound: 9005
  },
  skill: {
    notFound: 9101,
    revisionConflict: 9102,
    invalidContent: 9103
  },
  workspace: {
    required: 9201,
    notFound: 9202,
    forbidden: 9203,
    memberNotFound: 9204,
    invitationConflict: 9205,
    ownerRequired: 9206
  }
} as const;

/** Service 层统一抛出的业务异常，由全局 Filter 转成固定失败响应。 */
export class AppError extends Error {
  /** 稳定业务错误码。 */
  readonly code: number;
  /** 对应的 HTTP 状态码。 */
  readonly httpStatus: number;

  constructor(code: number, message: string, httpStatus = HttpStatus.BAD_REQUEST) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
