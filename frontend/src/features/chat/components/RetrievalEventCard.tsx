import { useState } from "react";

import type { ChatRetrievalEvent } from "../types";

export function RetrievalEventCard({ retrievalEvent }: { retrievalEvent: ChatRetrievalEvent }) {
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
        <span className="chatRetrievalEventName">知识库检索</span>
        <span className="chatRetrievalEventStatus">{formatRetrievalStatus(retrievalEvent)}</span>
      </div>
      {retrievalEvent.status === "running" ? (
        <div className="chatRetrievalEventHint">
          正在检索 {retrievalEvent.knowledgeBaseIds.length} 个知识库
        </div>
      ) : retrievalEvent.sources.length > 0 ? (
        <div className="chatRetrievalSources">
          {retrievalEvent.sources.map((source) => {
            const sourceKey = `${source.documentId}-${source.chunkId}`;
            const expanded = expandedSourceKeys.has(sourceKey);

            return (
              <div className="chatRetrievalSource" key={sourceKey}>
                <div className="chatRetrievalSourceMain">
                  <span className="chatRetrievalSourceName">{source.documentName}</span>
                  <span className="chatRetrievalSourceMeta">
                    #{source.chunkIndex} · score {source.score.toFixed(4)}
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
      ) : (
        <div className="chatRetrievalEventHint">未检索到相关片段</div>
      )}
    </div>
  );
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
