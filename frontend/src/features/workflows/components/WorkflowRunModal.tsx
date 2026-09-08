import { Alert, Form, Input, InputNumber, Modal, Switch } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { PublishedWorkflowApp, WorkflowAppRunResult } from "../api";

/** 动态 Workflow 运行表单值。 */
type WorkflowRunFormValues = {
  /** Start 节点输入，字段名在发布后保持稳定。 */
  inputs: Record<string, unknown>;
};

/** Workflow 独立运行弹窗参数。 */
type WorkflowRunModalProps = {
  /** 当前待运行的已发布应用。 */
  app: PublishedWorkflowApp | null;
  /** 是否正在调用 Runtime。 */
  running: boolean;
  /** 最近一次运行结果。 */
  result: WorkflowAppRunResult | null;
  /** 关闭弹窗。 */
  onCancel: () => void;
  /** 提交归一化后的 Start 输入。 */
  onRun: (inputs: Record<string, unknown>) => Promise<void>;
};

/** 根据 Start.inputs 生成成员可直接使用的 Workflow 表单。 */
export function WorkflowRunModal({ app, running, result, onCancel, onRun }: WorkflowRunModalProps) {
  const [form] = Form.useForm<WorkflowRunFormValues>();

  async function submit(values: WorkflowRunFormValues) {
    const inputs = { ...values.inputs };
    for (const input of app?.inputs ?? []) {
      if (
        (input.type === "object" || input.type === "array") &&
        typeof inputs[input.name] === "string"
      ) {
        inputs[input.name] = JSON.parse(inputs[input.name] as string) as unknown;
      }
    }
    await onRun(inputs);
  }

  return (
    <Modal
      destroyOnHidden
      confirmLoading={running}
      okText="开始运行"
      open={Boolean(app)}
      title={app ? `${app.name} · v${app.version}` : "运行 Workflow"}
      width={680}
      afterClose={() => form.resetFields()}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form<WorkflowRunFormValues>
        form={form}
        layout="vertical"
        onFinish={(values) => void submit(values)}
      >
        {app?.inputs.map((input) => (
          <Form.Item
            key={input.name}
            initialValue={formatInitialValue(input.defaultValue, input.type)}
            label={input.name}
            name={["inputs", input.name]}
            tooltip={input.description || undefined}
            rules={[
              ...(input.required ? [{ required: true, message: `请输入 ${input.name}` }] : []),
              ...(input.type === "object" || input.type === "array"
                ? [
                    {
                      validator: (_: unknown, value: unknown) =>
                        validateJson(value, input.type as "object" | "array")
                    }
                  ]
                : [])
            ]}
            valuePropName={input.type === "boolean" ? "checked" : "value"}
          >
            {renderInput(input.type)}
          </Form.Item>
        ))}
      </Form>
      {result ? (
        <div className="workflowRunResult">
          <Alert
            showIcon
            message={result.ok ? "运行成功" : "运行失败"}
            description={result.error?.message}
            type={result.ok ? "success" : "error"}
          />
          {result.output ? <WorkflowRunOutput output={result.output} /> : null}
          <small>
            执行事件 {result.events.length} 条 · Request ID {result.requestId}
          </small>
        </div>
      ) : null}
    </Modal>
  );
}

const workflowTextOutputKeys = ["summary", "text", "content", "message"] as const;

/** 优先把结束节点的文本正文按 Markdown 展示，其余字段仍保留结构化 JSON。 */
function WorkflowRunOutput({ output }: { output: Record<string, unknown> }) {
  const textKey = workflowTextOutputKeys.find((key) => typeof output[key] === "string");
  if (!textKey) {
    return <pre>{JSON.stringify(output, null, 2)}</pre>;
  }

  const text = output[textKey] as string;
  const remainingOutput = Object.fromEntries(
    Object.entries(output).filter(([key]) => key !== textKey)
  );

  return (
    <div className="workflowRunOutput">
      <div className="workflowRunMarkdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, href }) => (
              <a href={href} rel="noreferrer noopener" target="_blank">
                {children}
              </a>
            )
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
      {Object.keys(remainingOutput).length > 0 ? (
        <pre>{JSON.stringify(remainingOutput, null, 2)}</pre>
      ) : null}
    </div>
  );
}

/** 按 Workflow JSON 类型选择最小且明确的表单控件。 */
function renderInput(type: PublishedWorkflowApp["inputs"][number]["type"]) {
  if (type === "number") return <InputNumber style={{ width: "100%" }} />;
  if (type === "boolean") return <Switch />;
  if (type === "object" || type === "array") {
    return <Input.TextArea placeholder={type === "array" ? "[]" : "{}"} rows={4} />;
  }
  return <Input />;
}

/** 结构化默认值以 JSON 文本回显，提交时再恢复原类型。 */
function formatInitialValue(value: unknown, type: string): unknown {
  if (value === undefined) return type === "boolean" ? false : undefined;
  return type === "object" || type === "array" ? JSON.stringify(value, null, 2) : value;
}

/** JSON 输入允许留空；填写后必须匹配对象或数组类型。 */
function validateJson(value: unknown, type: "object" | "array"): Promise<void> {
  if (value === undefined || value === "") return Promise.resolve();
  try {
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    const valid =
      type === "array"
        ? Array.isArray(parsed)
        : Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
    return valid
      ? Promise.resolve()
      : Promise.reject(new Error(type === "array" ? "请输入 JSON 数组" : "请输入 JSON 对象"));
  } catch {
    return Promise.reject(new Error("JSON 格式不正确"));
  }
}
