import { useEffect, useState, type ReactNode } from "react";
import { DeleteOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Select } from "antd";

import type { WorkflowNode, WorkflowResources } from "../types";
import { NODE_LABELS } from "../utils";
import { ConditionBranchGuide } from "./ConditionBranchGuide";

/** Workflow 节点属性面板参数。 */
type NodeInspectorProps = {
  /** 当前选中节点；未选择时为 null。 */
  node: WorkflowNode | null;
  /** 模型、知识库和工具下拉资源。 */
  resources: WorkflowResources;
  /** 节点名称或配置变化回调。 */
  onChange: (node: WorkflowNode) => void;
  /** 删除当前节点回调。 */
  onDelete: (nodeId: string) => void;
};

/** 根据节点类型展示对应配置字段。 */
export function NodeInspector({ node, resources, onChange, onDelete }: NodeInspectorProps) {
  if (!node) {
    return (
      <aside className="workflowInspector workflowInspectorEmpty">
        <div className="workflowPaneTitle">属性</div>
        <p>选择节点后编辑配置</p>
      </aside>
    );
  }

  const updateConfig = (field: string, value: unknown) =>
    onChange({ ...node, config: { ...node.config, [field]: value } });

  return (
    <aside className="workflowInspector">
      <div className="workflowInspectorHeader">
        <div>
          <div className="workflowPaneTitle">{NODE_LABELS[node.type]}</div>
          <code>{node.id}</code>
        </div>
        <Button
          danger
          icon={<DeleteOutlined />}
          title="删除节点"
          type="text"
          onClick={() => onDelete(node.id)}
        />
      </div>

      <Field label="名称">
        <Input
          value={node.name}
          onChange={(event) => onChange({ ...node, name: event.target.value })}
        />
      </Field>

      {node.type === "start" ? (
        <JsonField
          label="输入定义"
          value={node.config.inputs}
          onChange={(value) => updateConfig("inputs", value)}
        />
      ) : null}

      {node.type === "llm" ? (
        <>
          <Field label="模型">
            <Select
              options={resources.models.map((item) => ({ value: item.id, label: item.label }))}
              placeholder="选择 Chat 模型"
              value={stringValue(node.config.modelConfigId) || undefined}
              onChange={(value) => updateConfig("modelConfigId", value)}
            />
          </Field>
          <Field label="System Prompt">
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 8 }}
              value={stringValue(node.config.systemPrompt)}
              onChange={(event) => updateConfig("systemPrompt", event.target.value)}
            />
          </Field>
          <Field label="Prompt">
            <Input.TextArea
              autoSize={{ minRows: 5, maxRows: 12 }}
              value={stringValue(node.config.prompt)}
              onChange={(event) => updateConfig("prompt", event.target.value)}
            />
          </Field>
          <div className="workflowInspectorGrid">
            <Field label="Temperature">
              <InputNumber
                max={2}
                min={0}
                step={0.1}
                value={numberValue(node.config.temperature)}
                onChange={(value) => updateConfig("temperature", value ?? undefined)}
              />
            </Field>
            <Field label="Max Tokens">
              <InputNumber
                min={1}
                value={numberValue(node.config.maxTokens)}
                onChange={(value) => updateConfig("maxTokens", value ?? undefined)}
              />
            </Field>
          </div>
          <Field label="输出格式">
            <Select
              options={[
                { value: "text", label: "Text" },
                { value: "json_object", label: "JSON Object" }
              ]}
              value={stringValue(node.config.responseFormat) || "text"}
              onChange={(value) => updateConfig("responseFormat", value)}
            />
          </Field>
        </>
      ) : null}

      {node.type === "retrieval" ? (
        <>
          <Field label="知识库">
            <Select
              mode="multiple"
              options={resources.knowledgeBases.map((item) => ({
                value: item.id,
                label: item.label
              }))}
              placeholder="选择知识库"
              value={stringArray(node.config.knowledgeBaseIds)}
              onChange={(value) => updateConfig("knowledgeBaseIds", value)}
            />
          </Field>
          <Field label="查询表达式">
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 8 }}
              value={stringValue(node.config.query)}
              onChange={(event) => updateConfig("query", event.target.value)}
            />
          </Field>
          <div className="workflowInspectorGrid">
            <Field label="Top K">
              <InputNumber
                min={1}
                value={numberValue(node.config.topK) ?? 5}
                onChange={(value) => updateConfig("topK", value ?? 5)}
              />
            </Field>
            <Field label="最低分数">
              <InputNumber
                max={1}
                min={0}
                step={0.05}
                value={numberValue(node.config.scoreThreshold)}
                onChange={(value) => updateConfig("scoreThreshold", value ?? undefined)}
              />
            </Field>
          </div>
        </>
      ) : null}

      {node.type === "tool" ? (
        <>
          <Field label="工具">
            <Select
              options={resources.tools.map((item) => ({ value: item.id, label: item.label }))}
              placeholder="选择工具"
              value={stringValue(node.config.toolId) || undefined}
              onChange={(value) => updateConfig("toolId", value)}
            />
          </Field>
          <JsonField
            label="参数"
            value={node.config.arguments}
            onChange={(value) => updateConfig("arguments", value)}
          />
          <Field label="失败策略">
            <Select
              options={[
                { value: "fail", label: "失败并终止" },
                { value: "continue", label: "记录错误并继续" }
              ]}
              value={stringValue(node.config.failurePolicy) || "fail"}
              onChange={(value) => updateConfig("failurePolicy", value)}
            />
          </Field>
        </>
      ) : null}

      {node.type === "condition" ? (
        <>
          <ConditionBranchGuide />
          <JsonField
            label="分支规则"
            value={node.config.branches}
            onChange={(value) => updateConfig("branches", value)}
          />
          <Field label="默认 Handle">
            <Input
              value={stringValue(node.config.defaultHandle) || "default"}
              onChange={(event) => updateConfig("defaultHandle", event.target.value)}
            />
          </Field>
        </>
      ) : null}

      {node.type === "template" ? (
        <Field label="模板">
          <Input.TextArea
            autoSize={{ minRows: 7, maxRows: 16 }}
            value={stringValue(node.config.template)}
            onChange={(event) => updateConfig("template", event.target.value)}
          />
        </Field>
      ) : null}

      {node.type === "end" ? (
        <>
          <Field label="Chat Answer">
            <Input.TextArea
              autoSize={{ minRows: 4, maxRows: 10 }}
              value={stringValue(node.config.answer)}
              onChange={(event) => updateConfig("answer", event.target.value)}
            />
          </Field>
          <JsonField
            label="结构化输出"
            value={node.config.output}
            onChange={(value) => updateConfig("output", value)}
          />
        </>
      ) : null}
    </aside>
  );
}

/** 属性面板通用字段布局参数。 */
type FieldProps = {
  /** 字段展示名称。 */
  label: string;
  /** 字段编辑控件。 */
  children: ReactNode;
};

/** 统一属性面板字段标签与控件布局。 */
function Field({ label, children }: FieldProps) {
  return (
    <label className="workflowField">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** JSON 字段允许暂存未完成文本，只在语法有效时提交到 Graph。 */
/** 可暂存非法文本的 JSON 配置字段参数。 */
type JsonFieldProps = {
  /** 字段展示名称。 */
  label: string;
  /** 当前已提交的结构化值。 */
  value: unknown;
  /** JSON 语法有效时提交新值。 */
  onChange: (value: unknown) => void;
};

function JsonField({ label, value, onChange }: JsonFieldProps) {
  const serialized = JSON.stringify(value ?? {}, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(serialized);
    setError("");
  }, [serialized]);

  /** 仅在 JSON 语法有效时提交，允许用户在输入过程中保留未完成文本。 */
  function commit() {
    try {
      onChange(JSON.parse(draft) as unknown);
      setError("");
    } catch {
      setError("JSON 格式不正确");
    }
  }

  return (
    <Field label={label}>
      <Input.TextArea
        className={error ? "workflowJsonInvalid" : ""}
        rows={7}
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
      />
      {error ? <small className="workflowFieldError">{error}</small> : null}
    </Field>
  );
}

/** 从未知配置值安全读取字符串。 */
function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 从未知配置值安全读取有限数字。 */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 从未知配置值中过滤字符串数组。 */
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
