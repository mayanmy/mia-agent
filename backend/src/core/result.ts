export type Result<T> = {
  code: number;
  message: string;
  data: T | null;
};

export type PageResult<T> = {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
};

export function success<T>(data: T | null = null, message = 'success'): Result<T> {
  return {
    code: 200,
    message,
    data,
  };
}

export function failure(code: number, message: string): Result<null> {
  return {
    code,
    message,
    data: null,
  };
}
