import { Modal, Tabs } from "antd";

import type { AgentTableItem, EmbedScenario } from "../types";
import { getEmbedCode } from "../utils/embed-code";
import { EmbedCodePanel } from "./EmbedCodePanel";

export function AgentEmbedModal({
  agent,
  scenario,
  origin,
  onScenarioChange,
  onCancel,
  onCopy
}: {
  agent: AgentTableItem | null;
  scenario: EmbedScenario;
  origin: string;
  onScenarioChange: (scenario: EmbedScenario) => void;
  onCancel: () => void;
  onCopy: (code: string) => void;
}) {
  const shareToken = agent?.shareToken ?? null;
  const agentName = agent?.name;
  const codeFor = (nextScenario: EmbedScenario) =>
    getEmbedCode({
      origin,
      shareToken,
      scenario: nextScenario,
      agentName
    });

  return (
    <Modal
      destroyOnHidden
      okText="复制代码"
      open={Boolean(agent)}
      title="嵌入代码"
      width={720}
      onCancel={onCancel}
      onOk={() => onCopy(codeFor(scenario))}
    >
      <Tabs
        activeKey={scenario}
        items={[
          {
            key: "single",
            label: "单页面单 Agent",
            children: (
              <EmbedCodePanel
                code={codeFor("single")}
                description='适合普通页面：每个页面只嵌入当前这个 Agent，页面右下角出现一个 Mia 聊天入口。可调整 data-launcher-icon 和 data-launcher-size；如果要用图片图标，改用 data-launcher-icon-url="https://..."。'
              />
            )
          },
          {
            key: "multi",
            label: "同页多 Agent",
            children: (
              <EmbedCodePanel
                code={codeFor("multi")}
                description="适合同一个页面需要多个 Agent：放多段 script，页面仍然只有一个入口，聊天框顶部用下拉框切换 Agent。"
              />
            )
          },
          {
            key: "spa",
            label: "SPA 路由切换",
            children: (
              <EmbedCodePanel
                code={codeFor("spa")}
                description="适合 React/Vue 等单页应用：路由变化时调用 loadMiaAgentWidget，先销毁旧 widget，再加载当前页面对应的 Agent。"
              />
            )
          },
          {
            key: "inline",
            label: "页面内嵌",
            children: (
              <EmbedCodePanel
                code={codeFor("inline")}
                description="适合把 Chat 作为页面内容的一部分：指定容器后直接渲染完整聊天框，不显示右下角悬浮按钮，也不支持拖动。"
              />
            )
          }
        ]}
        onChange={(key) => onScenarioChange(key as EmbedScenario)}
      />
    </Modal>
  );
}
