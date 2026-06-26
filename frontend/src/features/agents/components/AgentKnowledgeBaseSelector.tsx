import { Alert, Checkbox, Empty, Tag } from "antd";

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
  const selectedKnowledgeBases = knowledgeBases.filter((knowledgeBase) =>
    value.includes(knowledgeBase.id)
  );
  const selectedDisabledKnowledgeBases = selectedKnowledgeBases.filter(
    (knowledgeBase) => !knowledgeBase.enabled
  );
  const selectedEmbeddingModelNames = [
    ...new Set(
      selectedKnowledgeBases
        .filter((knowledgeBase) => knowledgeBase.enabled)
        .map(
          (knowledgeBase) =>
            `${knowledgeBase.embeddingProviderName} / ${knowledgeBase.embeddingModelName}`
        )
    )
  ];
  const hasMixedEmbeddingModels = selectedEmbeddingModelNames.length > 1;

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
      {hasMixedEmbeddingModels ? (
        <Alert
          className="knowledgeSelectorAlert"
          message="已选择多个 Embedding 模型的知识库。当前检索会优先使用同一向量空间的知识库，部分知识库可能不会参与本次检索。"
          showIcon
          type="warning"
        />
      ) : null}
      {selectedDisabledKnowledgeBases.length > 0 ? (
        <Alert
          className="knowledgeSelectorAlert"
          message={`已绑定 ${selectedDisabledKnowledgeBases.length} 个停用知识库。停用知识库不会参与检索，保存前请取消绑定或重新启用。`}
          showIcon
          type="error"
        />
      ) : null}
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
