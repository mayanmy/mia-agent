import { AppError, ErrorCodes } from "./errors";
import { PageResult } from "./result";

/** 所有列表接口共享的默认分页边界。 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Controller 可接收数字或 URL 查询字符串形式的分页参数。 */
export type PageQuery = {
  page?: number | string;
  pageSize?: number | string;
};

/** Service/Repository 可直接用于 Prisma skip/take 的标准分页参数。 */
export type NormalizedPageQuery = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

function parsePositiveInteger(value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError(ErrorCodes.common.badRequest, "invalid pagination parameter");
  }

  return parsed;
}

export function normalizePageQuery(query: PageQuery): NormalizedPageQuery {
  const page = parsePositiveInteger(query.page, DEFAULT_PAGE);
  const pageSize = parsePositiveInteger(query.pageSize, DEFAULT_PAGE_SIZE);

  // 硬上限防止管理端误操作触发无界查询和超大 JSON 响应。
  if (pageSize > MAX_PAGE_SIZE) {
    throw new AppError(ErrorCodes.common.badRequest, "pageSize must be less than or equal to 100");
  }

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize
  };
}

/** 将列表和总数封装为全局统一分页结构。 */
export function createPageResult<T>(
  list: T[],
  total: number,
  page: number,
  pageSize: number
): PageResult<T> {
  return {
    list,
    total,
    page,
    pageSize
  };
}
