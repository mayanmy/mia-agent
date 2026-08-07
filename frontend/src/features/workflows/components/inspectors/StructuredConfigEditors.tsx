import { DeleteOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Select } from "antd";

import type { WorkflowVariableDescriptor } from "../../editor/variables";
import { VariableTextArea } from "../variables/VariableTextArea";
import { AddRowButton, InspectorField, InspectorSection } from "./InspectorFields";

/** 开始节点支持的运行时输入类型。 */
type StartInputType = "string" | "number" | "boolean" | "object" | "array";

/** 开始节点单个输入定义。 */
type StartInputDefinition = {
  /** 输入变量名，也是后续 `input.xxx` 引用路径。 */
  name: string;
  /** 后端编译器支持的输入类型。 */
  type: StartInputType;
  /** 执行 Workflow 时是否必须提供。 */
  required: boolean;
  /** 面向调用者的字段说明。 */
  description?: string;
};

/** 开始节点输入编辑器参数。 */
export type StartInputsEditorProps = {
  /** Graph 中原始 inputs 配置。 */
  value: unknown;
  /** 提交兼容 Workflow V1 的输入数组。 */
  onChange: (value: StartInputDefinition[]) => void;
};

const INPUT_TYPE_OPTIONS = [
  { value: "string", label: "文本" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "布尔" },
  { value: "object", label: "对象" },
  { value: "array", label: "数组" }
];

/** 将自由 JSON 输入改为结构化字段，提前暴露重名和命名错误。 */
export function StartInputsEditor({ value, onChange }: StartInputsEditorProps) {
  const inputs = readStartInputs(value);
  const names = inputs.map((item) => item.name).filter(Boolean);
  const update = (index: number, patch: Partial<StartInputDefinition>) =>
    onChange(inputs.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));

  return (
    <InspectorSection title="输入变量" description="声明 Workflow 启动时可接收的数据">
      <div className="workflowConfigList">
        {inputs.map((input, index) => {
          const invalidName = input.name !== "" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.name);
          const duplicated = input.name !== "" && names.filter((name) => name === input.name).length > 1;
          return (
            <div className="workflowConfigCard" key={index}>
              <div className="workflowConfigCardHeader">
                <strong>输入 {index + 1}</strong>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  size="small"
                  type="text"
                  onClick={() => onChange(inputs.filter((_, itemIndex) => itemIndex !== index))}
                />
              </div>
              <div className="workflowInspectorGrid">
                <InspectorField label="变量名">
                  <Input
                    status={invalidName || duplicated ? "error" : undefined}
                    value={input.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                </InspectorField>
                <InspectorField label="类型">
                  <Select
                    options={INPUT_TYPE_OPTIONS}
                    value={input.type}
                    onChange={(type: StartInputType) => update(index, { type })}
                  />
                </InspectorField>
              </div>
              {invalidName ? <small className="workflowFieldError">变量名只能包含字母、数字和下划线，且不能以数字开头</small> : null}
              {duplicated ? <small className="workflowFieldError">变量名不能重复</small> : null}
              <InspectorField label="说明">
                <Input
                  placeholder="这个输入用于什么"
                  value={input.description}
                  onChange={(event) => update(index, { description: event.target.value })}
                />
              </InspectorField>
              <Checkbox
                checked={input.required}
                onChange={(event) => update(index, { required: event.target.checked })}
              >
                必填
              </Checkbox>
            </div>
          );
        })}
      </div>
      <AddRowButton
        onClick={() =>
          onChange([...inputs, { name: `input_${inputs.length + 1}`, type: "string", required: false }])
        }
      >
        添加输入变量
      </AddRowButton>
    </InspectorSection>
  );
}

/** 条件节点单条分支规则。 */
type ConditionBranch = {
  /** 连接线使用的唯一出口标识。 */
  handle: string;
  /** 比较左值，可使用上游变量表达式。 */
  left: string;
  /** 后端执行器支持的结构化操作符。 */
  operator: string;
  /** 除 exists 外的比较右值。 */
  right?: string;
};

/** 条件分支编辑器参数。 */
export type ConditionBranchesEditorProps = {
  /** Graph 中原始 branches 配置。 */
  value: unknown;
  /** 当前节点可引用的上游变量。 */
  variables: WorkflowVariableDescriptor[];
  /** 分支更新回调。 */
  onChange: (value: ConditionBranch[]) => void;
};

const OPERATOR_OPTIONS = [
  { value: "eq", label: "等于" }, { value: "neq", label: "不等于" },
  { value: "contains", label: "包含" }, { value: "exists", label: "存在" },
  { value: "gt", label: "大于" }, { value: "gte", label: "大于等于" },
  { value: "lt", label: "小于" }, { value: "lte", label: "小于等于" }
];

/** Condition 使用显式规则卡片，避免用户直接维护 Handle JSON。 */
export function ConditionBranchesEditor({ value, variables, onChange }: ConditionBranchesEditorProps) {
  const branches = readConditionBranches(value);
  const update = (index: number, patch: Partial<ConditionBranch>) =>
    onChange(branches.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  return (
    <InspectorSection title="分支规则" description="按顺序匹配，命中首条规则后停止">
      <div className="workflowConfigList">
        {branches.map((branch, index) => (
          <div className="workflowConfigCard" key={index}>
            <div className="workflowConfigCardHeader">
              <strong>分支 {index + 1}</strong>
              <Button danger disabled={branches.length === 1} icon={<DeleteOutlined />} size="small" type="text" onClick={() => onChange(branches.filter((_, i) => i !== index))} />
            </div>
            <InspectorField label="出口 Handle" hint="修改后，已有连线可能需要重新连接">
              <Input value={branch.handle} onChange={(event) => update(index, { handle: event.target.value })} />
            </InspectorField>
            <InspectorField label="比较左值">
              <VariableTextArea autoSize={{ minRows: 2, maxRows: 5 }} value={branch.left} variables={variables} onChange={(left) => update(index, { left })} />
            </InspectorField>
            <InspectorField label="操作符">
              <Select options={OPERATOR_OPTIONS} value={branch.operator} onChange={(operator) => update(index, { operator, ...(operator === "exists" ? { right: undefined } : {}) })} />
            </InspectorField>
            {branch.operator !== "exists" ? (
              <InspectorField label="比较右值">
                <VariableTextArea autoSize={{ minRows: 2, maxRows: 5 }} value={branch.right ?? ""} variables={variables} onChange={(right) => update(index, { right })} />
              </InspectorField>
            ) : null}
          </div>
        ))}
      </div>
      <AddRowButton onClick={() => onChange([...branches, { handle: `branch_${branches.length + 1}`, left: "", operator: "eq", right: "" }])}>添加分支</AddRowButton>
    </InspectorSection>
  );
}

/** 键值配置编辑器参数，供工具参数和结束节点输出复用。 */
export type KeyValueEditorProps = {
  /** 分组标题。 */
  title: string;
  /** 分组说明。 */
  description: string;
  /** Graph 中原始对象配置。 */
  value: unknown;
  /** 当前节点可引用的上游变量。 */
  variables: WorkflowVariableDescriptor[];
  /** 对象更新回调。 */
  onChange: (value: Record<string, unknown>) => void;
};

/** 用键值行替代常用对象 JSON；复杂旧值会序列化显示，编辑后按字符串保存。 */
export function KeyValueEditor({ title, description, value, variables, onChange }: KeyValueEditorProps) {
  const record = readRecord(value);
  const entries = Object.entries(record);
  const commit = (next: Array<[string, unknown]>) => onChange(Object.fromEntries(next.filter(([key]) => key.trim())));
  return (
    <InspectorSection title={title} description={description}>
      <div className="workflowConfigList">
        {entries.map(([key, rawValue], index) => (
          <div className="workflowKeyValueRow" key={index}>
            <Input aria-label="字段名" placeholder="字段名" value={key} onChange={(event) => commit(entries.map((entry, i) => i === index ? [event.target.value, entry[1]] : entry))} />
            <VariableTextArea autoSize={{ minRows: 1, maxRows: 4 }} value={displayValue(rawValue)} variables={variables} onChange={(nextValue) => commit(entries.map((entry, i) => i === index ? [entry[0], nextValue] : entry))} />
            <Button danger icon={<DeleteOutlined />} type="text" onClick={() => commit(entries.filter((_, i) => i !== index))} />
          </div>
        ))}
      </div>
      <AddRowButton onClick={() => commit([...entries, [`field_${entries.length + 1}`, ""]])}>添加字段</AddRowButton>
    </InspectorSection>
  );
}

/** 容错读取开始节点输入，旧配置异常时展示空列表而非阻断面板。 */
function readStartInputs(value: unknown): StartInputDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    name: typeof item.name === "string" ? item.name : "",
    type: isInputType(item.type) ? item.type : "string",
    required: typeof item.required === "boolean" ? item.required : false,
    ...(typeof item.description === "string" ? { description: item.description } : {})
  }));
}

/** 容错读取条件分支并保持后端认识的核心字段。 */
function readConditionBranches(value: unknown): ConditionBranch[] {
  if (!Array.isArray(value)) return [{ handle: "matched", left: "", operator: "exists" }];
  const result = value.filter(isRecord).map((item, index) => ({
    handle: typeof item.handle === "string" ? item.handle : `branch_${index + 1}`,
    left: displayValue(item.left),
    operator: typeof item.operator === "string" ? item.operator : "eq",
    ...(item.right === undefined ? {} : { right: displayValue(item.right) })
  }));
  return result.length ? result : [{ handle: "matched", left: "", operator: "exists" }];
}

/** 仅普通对象可映射为键值编辑器。 */
function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** 结构化旧值以 JSON 展示，防止打开面板时丢失原配置。 */
function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

/** 判断后端支持的输入类型。 */
function isInputType(value: unknown): value is StartInputType {
  return ["string", "number", "boolean", "object", "array"].includes(String(value));
}

/** 排除数组和 null，仅接受配置对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
