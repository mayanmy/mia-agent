import type { ChatRetrievalEvent } from "../types";

export function RetrievalEventCard({ retrievalEvent }: { retrievalEvent: ChatRetrievalEvent }) {
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
          {retrievalEvent.sources.map((source) => (
            <div className="chatRetrievalSource" key={`${source.documentId}-${source.chunkId}`}>
              <span className="chatRetrievalSourceName">{source.documentName}</span>
              <span className="chatRetrievalSourceMeta">
                #{source.chunkIndex} · score {source.score.toFixed(4)}
              </span>
            </div>
          ))}
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
