import { Alert, Form, Input, InputNumber, Modal, Select, Slider, Switch, Tabs } from "antd";
import type { FormInstance } from "antd";

import type { KnowledgeBaseListItem } from "../../knowledge/api";
import type { ToolListItem } from "../../tools/api";
import type { AgentFormValues } from "../types";
import { defaultAgentFormValues } from "../utils/agent-form";
import { AgentKnowledgeBaseSelector } from "./AgentKnowledgeBaseSelector";
import { AgentToolSelector } from "./AgentToolSelector";

/** 分组模型下拉框中的单个选项。 */
type AgentModelOption = {
  /** 模型展示名称。 */
  label: string;
  /** 模型配置 ID。 */
  value: string;
};

/** 按供应商组织的模型选项组。 */
type AgentModelOptionGroup = {
  /** 供应商分组名称。 */
  label: string;
  /** 该供应商下可绑定的 Chat 模型。 */
  options: AgentModelOption[];
};

/** Agent 表单弹窗参数。 */
type AgentFormModalProps = {
  /** 由页面持有的 Ant Design 表单实例。 */
  form: FormInstance<AgentFormValues>;
  /** 弹窗是否打开。 */
  open: boolean;
  /** 是否正在编辑已有 Agent。 */
  editing: boolean;
  /** 是否正在保存。 */
  saving: boolean;
  /** 按供应商分组的可选模型。 */
  modelOptions: AgentModelOptionGroup[];
  /** 可绑定工具列表。 */
  tools: ToolListItem[];
  /** 可绑定知识库列表。 */
  knowledgeBases: KnowledgeBaseListItem[];
  /** 取消编辑回调。 */
  onCancel: () => void;
  /** 表单校验通过后的提交回调。 */
  onSubmit: (values: AgentFormValues) => void;
};

/** 编辑 Agent 基础配置及工具、知识库绑定。 */
export function AgentFormModal({
  form,
  open,
  editing,
  saving,
  modelOptions,
  tools,
  knowledgeBases,
  onCancel,
  onSubmit
}: AgentFormModalProps) {
  // Tabs 会延迟挂载非活动页签；preserve 让标签在字段尚未挂载时也能读取已加载的绑定值。
  const selectedToolIds = Form.useWatch("toolIds", { form, preserve: true }) ?? [];
  const selectedWorkflowIds = selectedToolIds.filter((toolId) => toolId.startsWith("workflow:"));
  const selectedStandardToolIds = selectedToolIds.filter(
    (toolId) => !toolId.startsWith("workflow:")
  );
  const selectedKnowledgeBaseIds =
    Form.useWatch("knowledgeBaseIds", { form, preserve: true }) ?? [];

  return (
    <Modal
      destroyOnHidden
      confirmLoading={saving}
      okText={editing ? "保存" : "创建"}
      open={open}
      title={editing ? "编辑 Agent" : "新增 Agent"}
      width={760}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form<AgentFormValues>
        form={form}
        initialValues={defaultAgentFormValues}
        layout="vertical"
        onFinish={onSubmit}
      >
        {/* 两个展示页签共同编辑 toolIds；保留一个字段注册点，确保 onFinish 始终提交合并后的数组。 */}
        <Form.Item name="toolIds" noStyle>
          <BindingField />
        </Form.Item>
        <Tabs
          items={[
            {
              key: "basic",
              label: "基础配置",
              children: (
                <div className="agentFormGrid">
                  <Form.Item
                    label="名称"
                    name="name"
                    rules={[{ required: true, message: "请输入名称" }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    label="模型选择"
                    name="modelConfigId"
                    rules={[{ required: true, message: "请选择模型" }]}
                  >
                    <Select options={modelOptions} />
                  </Form.Item>
                  <Form.Item className="agentFormFull" label="描述" name="description">
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} />
                  </Form.Item>
                  <Form.Item
                    className="agentFormFull"
                    label="System Prompt"
                    name="systemPrompt"
                    rules={[{ required: true, message: "请输入 System Prompt" }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 6, maxRows: 12 }} />
                  </Form.Item>
                  <Form.Item
                    label="temperature"
                    name="temperature"
                    rules={[{ required: true, message: "请选择 temperature" }]}
                  >
                    <Slider min={0} max={1} step={0.1} marks={{ 0: "0", 1: "1" }} />
                  </Form.Item>
                  <Form.Item label="max_tokens" name="maxTokens">
                    <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    label="max_context_turns"
                    name="historyTurns"
                    rules={[{ required: true, message: "请输入 max_context_turns" }]}
                  >
                    <InputNumber min={0} max={20} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    label="会话模式"
                    name="chatSessionMode"
                    tooltip="单次窗口关闭后不保留记录；保留模式会按成员分别恢复该 Agent 的历史对话。"
                  >
                    <Select
                      options={[
                        { label: "单次窗口讨论", value: "EPHEMERAL" },
                        { label: "窗口可保留数据", value: "PERSISTENT" }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="启用" name="enabled" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </div>
              )
            },
            {
              key: "knowledge",
              label: `知识库绑定 (${selectedKnowledgeBaseIds.length})`,
              children: (
                <Form.Item className="agentFormFull" name="knowledgeBaseIds">
                  <AgentKnowledgeBaseSelector knowledgeBases={knowledgeBases} />
                </Form.Item>
              )
            },
            {
              key: "tools",
              label: `工具绑定 (${selectedStandardToolIds.length})`,
              children: (
                <AgentToolSelector
                  bindingType="tool"
                  tools={tools}
                  value={selectedToolIds}
                  onChange={(toolIds) => form.setFieldValue("toolIds", toolIds)}
                />
              )
            },
            {
              key: "workflows",
              label: `Workflow 绑定 (${selectedWorkflowIds.length})`,
              children: (
                <div className="workflowBindingPane">
                  <Alert
                    showIcon
                    className="workflowBindingIntro"
                    message="Workflow 将作为 Agent 的可调用能力"
                    description="Agent 会根据用户意图决定是否执行，并使用 Workflow 的结果继续回答；绑定后并不代表每轮对话都会运行。"
                    type="info"
                  />
                  <AgentToolSelector
                    bindingType="workflow"
                    tools={tools}
                    value={selectedToolIds}
                    onChange={(toolIds) => form.setFieldValue("toolIds", toolIds)}
                  />
                </div>
              )
            }
          ]}
        />
      </Form>
    </Modal>
  );
}

/** 仅注册由两个平级选择器共同维护的绑定字段，不产生额外 DOM。 */
function BindingField(_props: {
  /** 当前完整工具绑定。 */
  value?: string[];
  /** Ant Form 注入的字段更新回调。 */
  onChange?: (value: string[]) => void;
}) {
  return null;
}
