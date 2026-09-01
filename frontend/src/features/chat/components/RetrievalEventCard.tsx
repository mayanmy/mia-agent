import { useState } from "react";

import type { ChatRetrievalEvent } from "../types";

/** 检索事件卡片参数。 */
type RetrievalEventCardProps = {
  /** 待展示的检索过程事件。 */
  retrievalEvent: ChatRetrievalEvent;
};

/** 展示知识检索状态、耗时和命中来源。 */
export function RetrievalEventCard({ retrievalEvent }: RetrievalEventCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedSourceKeys, setExpandedSourceKeys] = useState<Set<string>>(() => new Set());

  function toggleSource(key: string) {
    setExpandedSourceKeys((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  return (
    <div className={`chatRetrievalEvent ${retrievalEvent.status}`}>
      <div className="chatRetrievalEventHeader">
        <button
          aria-expanded={expanded}
          className="chatRetrievalEventSummary"
          type="button"
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="chatRetrievalEventName">
            {retrievalEvent.status === "running"
              ? "正在检索资料"
              : `已检索 ${retrievalEvent.sources.length} 条资料`}
          </span>
          <span className="chatRetrievalEventToggle">{expanded ? "收起" : "查看过程"}</span>
        </button>
        <span className="chatRetrievalEventStatus">{formatRetrievalStatus(retrievalEvent)}</span>
      </div>
      {expanded && retrievalEvent.status === "running" ? (
        <div className="chatRetrievalEventHint">
          正在检索 {retrievalEvent.knowledgeBaseIds.length} 个知识库
        </div>
      ) : expanded && retrievalEvent.sources.length > 0 ? (
        <div className="chatRetrievalSources">
          {retrievalEvent.sources.map((source) => {
            const sourceKey = `${source.documentId}-${source.chunkId}`;
            const expanded = expandedSourceKeys.has(sourceKey);

            return (
              <div className="chatRetrievalSource" key={sourceKey}>
                <div className="chatRetrievalSourceMain">
                  <span className="chatRetrievalSourceName">{source.documentName}</span>
                  <span className="chatRetrievalSourceMeta">
                    #{source.chunkIndex} · 相关度 {formatRelevance(source.score)}
                  </span>
                  <button
                    className="chatRetrievalSourceToggle"
                    type="button"
                    onClick={() => toggleSource(sourceKey)}
                  >
                    {expanded ? "收起" : "查看"}
                  </button>
                </div>
                {expanded ? (
                  <div className="chatRetrievalSourcePreview">
                    {source.contentPreview || "暂无预览"}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : expanded ? (
        <div className="chatRetrievalEventHint">未检索到相关片段</div>
      ) : null}
    </div>
  );
}

function formatRelevance(score: number): string {
  return `${Math.max(0, Math.min(100, Math.round(score * 100)))}%`;
}

function formatRetrievalStatus(retrievalEvent: ChatRetrievalEvent): string {
  if (retrievalEvent.status === "running") {
    return "检索中";
  }

  const elapsed = Number.isFinite(retrievalEvent.elapsedMs)
    ? ` · ${retrievalEvent.elapsedMs}ms`
    : "";

  return `完成${elapsed}`;
}
