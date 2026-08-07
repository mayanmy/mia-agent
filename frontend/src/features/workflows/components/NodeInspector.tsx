import { DeleteOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Select, Tooltip } from "antd";

import type { WorkflowGraph, WorkflowNode, WorkflowResources } from "../types";
import { buildVariableCatalog } from "../editor/variables";
import { NODE_LABELS } from "../utils";
import { ConditionBranchGuide } from "./ConditionBranchGuide";
import { InspectorField as Field, InspectorSection } from "./inspectors/InspectorFields";
import {
  ConditionBranchesEditor,
  KeyValueEditor,
  StartInputsEditor
} from "./inspectors/StructuredConfigEditors";
import { VariableTextArea } from "./variables/VariableTextArea";

/** Workflow 节点属性面板参数。 */
type NodeInspectorProps = {
  /** 当前选中节点；未选择时为 null。 */
  node: WorkflowNode | null;
  /** 当前完整 Graph，用于计算合法上游变量。 */
  graph: WorkflowGraph;
  /** 模型、知识库和工具下拉资源。 */
  resources: WorkflowResources;
  /** 节点名称或配置变化回调。 */
  onChange: (node: WorkflowNode) => void;
  /** 删除当前节点回调。 */
  onDelete: (nodeId: string) => void;
  /** 是否折叠属性面板。 */
  collapsed: boolean;
  /** 切换折叠状态。 */
  onToggleCollapsed: () => void;
};

/** 根据节点类型展示对应配置字段。 */
export function NodeInspector({
  node,
  graph,
  resources,
  onChange,
  onDelete,
  collapsed,
  onToggleCollapsed
}: NodeInspectorProps) {
  if (collapsed) {
    return (
      <aside className="workflowInspector collapsed">
        <Tooltip placement="left" title="展开属性面板">
          <Button icon={<MenuFoldOutlined />} type="text" onClick={onToggleCollapsed} />
        </Tooltip>
      </aside>
    );
  }
  if (!node) {
    return (
      <aside className="workflowInspector workflowInspectorEmpty">
        <div className="workflowInspectorHeader">
          <div className="workflowPaneTitle">属性</div>
          <Tooltip title="折叠属性面板">
            <Button icon={<MenuUnfoldOutlined />} type="text" onClick={onToggleCollapsed} />
          </Tooltip>
        </div>
        <p>选择节点后编辑配置</p>
      </aside>
    );
  }

  const updateConfig = (field: string, value: unknown) =>
    onChange({ ...node, config: { ...node.config, [field]: value } });
  const variables = buildVariableCatalog(graph, node.id);

  return (
    <aside className="workflowInspector">
      <div className="workflowInspectorHeader">
        <div>
          <div className="workflowPaneTitle">{NODE_LABELS[node.type]}</div>
          <code>{node.id}</code>
        </div>
        <div className="workflowPaneActions">
          <Button
            danger
            icon={<DeleteOutlined />}
            title="删除节点"
            type="text"
            onClick={() => onDelete(node.id)}
          />
          <Tooltip title="折叠属性面板">
            <Button icon={<MenuUnfoldOutlined />} type="text" onClick={onToggleCollapsed} />
          </Tooltip>
        </div>
      </div>

      <Field label="名称">
        <Input
          value={node.name}
          onChange={(event) => onChange({ ...node, name: event.target.value })}
        />
      </Field>

      {node.type === "start" ? (
        <StartInputsEditor
          value={node.config.inputs}
          onChange={(value) => updateConfig("inputs", value)}
        />
      ) : null}

      {node.type === "llm" ? (
        <InspectorSection title="模型调用" description="配置提示词、采样参数和输出格式">
          <Field label="模型">
            <Select
              options={resources.models.map((item) => ({ value: item.id, label: item.label }))}
              placeholder="选择 Chat 模型"
              value={stringValue(node.config.modelConfigId) || undefined}
              onChange={(value) => updateConfig("modelConfigId", value)}
            />
          </Field>
          <Field label="System Prompt">
            <VariableTextArea
              autoSize={{ minRows: 3, maxRows: 8 }}
              value={stringValue(node.config.systemPrompt)}
              variables={variables}
              onChange={(value) => updateConfig("systemPrompt", value)}
            />
          </Field>
          <Field label="Prompt">
            <VariableTextArea
              autoSize={{ minRows: 5, maxRows: 12 }}
              value={stringValue(node.config.prompt)}
              variables={variables}
              onChange={(value) => updateConfig("prompt", value)}
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
        </InspectorSection>
      ) : null}

      {node.type === "retrieval" ? (
        <InspectorSection title="检索设置" description="从指定知识库召回与问题相关的内容">
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
            <VariableTextArea
              autoSize={{ minRows: 3, maxRows: 8 }}
              value={stringValue(node.config.query)}
              variables={variables}
              onChange={(value) => updateConfig("query", value)}
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
        </InspectorSection>
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
          <KeyValueEditor
            title="工具参数"
            description="参数值支持引用上游变量"
            value={node.config.arguments}
            variables={variables}
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
          <ConditionBranchesEditor
            value={node.config.branches}
            variables={variables}
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
          <VariableTextArea
            autoSize={{ minRows: 7, maxRows: 16 }}
            value={stringValue(node.config.template)}
            variables={variables}
            onChange={(value) => updateConfig("template", value)}
          />
        </Field>
      ) : null}

      {node.type === "end" ? (
        <>
          <Field label="Chat Answer">
            <VariableTextArea
              autoSize={{ minRows: 4, maxRows: 10 }}
              value={stringValue(node.config.answer)}
              variables={variables}
              onChange={(value) => updateConfig("answer", value)}
            />
          </Field>
          <KeyValueEditor
            title="结构化输出"
            description="定义 Workflow 返回对象，可引用任意上游结果"
            value={node.config.output}
            variables={variables}
            onChange={(value) => updateConfig("output", value)}
          />
        </>
      ) : null}
    </aside>
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
