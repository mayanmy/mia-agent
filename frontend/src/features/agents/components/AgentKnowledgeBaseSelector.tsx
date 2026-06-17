import { Checkbox, Empty, Tag } from "antd";

import type { KnowledgeBaseListItem } from "../../knowledge/api";

type AgentKnowledgeBaseSelectorProps = {
  knowledgeBases: KnowledgeBaseListItem[];
  value?: string[];
  onChange?: (value: string[]) => void;
};

export function AgentKnowledgeBaseSelector({
  knowledgeBases,
  value = [],
  onChange
}: AgentKnowledgeBaseSelectorProps) {
  const enabledKnowledgeBases = knowledgeBases.filter((knowledgeBase) => knowledgeBase.enabled);

  if (knowledgeBases.length === 0) {
    return (
      <div className="knowledgeSelectorEmpty">
        <Empty description="暂无可绑定知识库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div className="knowledgeSelector">
      <div className="knowledgeSelectorSummary">
        <span>已绑定 {value.length} 个知识库</span>
        <span>
          可用 {enabledKnowledgeBases.length} / 全部 {knowledgeBases.length}
        </span>
      </div>
      <Checkbox.Group
        className="knowledgeCheckboxGroup"
        value={value}
        onChange={(checkedValues) => onChange?.(checkedValues.map(String))}
      >
        {knowledgeBases.map((knowledgeBase) => (
          <Checkbox
            className="knowledgeOptionCard"
            disabled={!knowledgeBase.enabled}
            key={knowledgeBase.id}
            value={knowledgeBase.id}
          >
            <div className="knowledgeOption">
              <div className="knowledgeOptionHeader">
                <div>
                  <div className="knowledgeOptionName">{knowledgeBase.name}</div>
                  <div className="knowledgeOptionMeta">
                    {knowledgeBase.embeddingProviderName} / {knowledgeBase.embeddingModelName}
                  </div>
                </div>
                <Tag color={knowledgeBase.enabled ? "green" : "default"}>
                  {knowledgeBase.enabled ? "可用" : "停用"}
                </Tag>
              </div>
              {knowledgeBase.description ? (
                <div className="knowledgeOptionDescription">{knowledgeBase.description}</div>
              ) : null}
              <div className="knowledgeOptionStats">
                文档 {knowledgeBase.documentCount} · 分块 {knowledgeBase.chunkCount}
                {knowledgeBase.failedDocumentCount > 0
                  ? ` · 失败 ${knowledgeBase.failedDocumentCount}`
                  : ""}
              </div>
            </div>
          </Checkbox>
        ))}
      </Checkbox.Group>
    </div>
  );
}
