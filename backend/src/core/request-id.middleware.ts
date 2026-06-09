import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

export type RequestWithId = {
  headers: Record<string, string | string[] | undefined>;
  requestId?: string;
};

export type ResponseWithHeader = {
  setHeader(name: string, value: string): void;
};

function getIncomingRequestId(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.find((item) => item.trim().length > 0);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return undefined;
}

export function requestIdMiddleware(
  req: RequestWithId,
  res: ResponseWithHeader,
  next: () => void
): void {
  const requestId = getIncomingRequestId(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
