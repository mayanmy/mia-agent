import { CompiledReference, CompiledValue } from "./dto/compiled-plan.dto";

const REFERENCE_PATTERN = /^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*$/;
const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const DANGEROUS_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export class WorkflowExpressionError extends Error {}

export type CompiledExpressionValue = {
  value: CompiledValue;
  references: CompiledReference[];
};

/**
 * 将配置中的表达式编译为结构化引用。Runtime 只按路径读取上下文，禁止执行任意代码。
 */
export function compileExpressionValue(value: unknown): CompiledExpressionValue {
  const references: CompiledReference[] = [];
  return {
    value: compileValue(value, references),
    references
  };
}

/** 递归编译 JSON 容器，使对象和数组内部同样支持受控表达式。 */
function compileValue(value: unknown, references: CompiledReference[]): CompiledValue {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return compileString(value, references);
  if (Array.isArray(value)) return value.map((item) => compileValue(item, references));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        compileValue(item, references)
      ])
    );
  }
  throw new WorkflowExpressionError("表达式配置只能包含 JSON 值");
}

/** 区分纯引用与混合模板，保留字符串片段顺序供 Runtime 无损渲染。 */
function compileString(value: string, references: CompiledReference[]): CompiledValue {
  const matches = [...value.matchAll(TEMPLATE_PATTERN)];
  if (matches.length === 0) {
    if (value.includes("{{") || value.includes("}}")) {
      throw new WorkflowExpressionError("表达式括号不完整");
    }
    return value;
  }

  const exact = matches.length === 1 && matches[0][0].length === value.length;
  if (exact) {
    const reference = parseReference(matches[0][1]);
    references.push(reference);
    return reference;
  }

  const segments: Array<string | CompiledReference> = [];
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push(value.slice(cursor, index));
    const reference = parseReference(match[1]);
    references.push(reference);
    segments.push(reference);
    cursor = index + match[0].length;
  }
  if (cursor < value.length) segments.push(value.slice(cursor));
  const literalRemainder = segments.filter((segment) => typeof segment === "string").join("");
  if (literalRemainder.includes("{{") || literalRemainder.includes("}}")) {
    throw new WorkflowExpressionError("表达式括号不完整");
  }
  return { kind: "template", segments };
}

/** 引用只接受固定根命名空间和静态属性路径，主动阻断原型链访问。 */
function parseReference(raw: string): CompiledReference {
  const expression = raw.trim();
  if (!REFERENCE_PATTERN.test(expression)) {
    throw new WorkflowExpressionError(`不支持的表达式: ${expression}`);
  }
  const [source, ...path] = expression.split(".");
  if (source !== "input" && source !== "nodes" && source !== "runtime") {
    throw new WorkflowExpressionError(`不支持的变量来源: ${source}`);
  }
  if (path.length === 0 || path.some((segment) => DANGEROUS_SEGMENTS.has(segment))) {
    throw new WorkflowExpressionError(`不安全或不完整的变量路径: ${expression}`);
  }
  return { kind: "reference", source, path };
}
