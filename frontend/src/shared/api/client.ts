export type Result<T> = {
  code: number;
  message: string;
  data: T;
};

export type PageResult<T> = {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers
    }
  });

  const result = (await response.json()) as Result<T>;

  if (!response.ok || result.code !== 200) {
    throw new Error(result.message || "请求失败");
  }

  return result.data;
}
