import { Form, Input, InputNumber, Modal, Select, Slider, Switch, Tabs } from "antd";
import type { FormInstance } from "antd";

import type { KnowledgeBaseListItem } from "../../knowledge/api";
import type { ToolListItem } from "../../tools/api";
import type { AgentFormValues } from "../types";
import { defaultAgentFormValues } from "../utils/agent-form";
import { AgentKnowledgeBaseSelector } from "./AgentKnowledgeBaseSelector";
import { AgentToolSelector } from "./AgentToolSelector";

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
}: {
  form: FormInstance<AgentFormValues>;
  open: boolean;
  editing: boolean;
  saving: boolean;
  modelOptions: Array<{ label: string; options: Array<{ label: string; value: string }> }>;
  tools: ToolListItem[];
  knowledgeBases: KnowledgeBaseListItem[];
  onCancel: () => void;
  onSubmit: (values: AgentFormValues) => void;
}) {
  const selectedToolIds = Form.useWatch("toolIds", form) ?? [];
  const selectedKnowledgeBaseIds = Form.useWatch("knowledgeBaseIds", form) ?? [];

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
              label: `工具绑定 (${selectedToolIds.length})`,
              children: (
                <Form.Item className="agentFormFull" name="toolIds">
                  <AgentToolSelector tools={tools} />
                </Form.Item>
              )
            }
          ]}
        />
      </Form>
    </Modal>
  );
}
