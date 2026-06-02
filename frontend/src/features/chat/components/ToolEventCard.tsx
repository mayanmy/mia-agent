import { useState } from "react";

import type { ChatToolEvent } from "../types";

export function ToolEventCard({ toolEvent }: { toolEvent: ChatToolEvent }) {
  return (
    <div className={`chatToolEvent ${toolEvent.status}`}>
      <div className="chatToolEventHeader">
        <span className="chatToolEventName">{formatToolName(toolEvent.name)}</span>
        <span className="chatToolEventStatus">{formatToolStatus(toolEvent)}</span>
      </div>
      {toolEvent.arguments && Object.keys(toolEvent.arguments).length > 0 ? (
        <ToolEventDetail label="参数" value={toolEvent.arguments} />
      ) : null}
      {toolEvent.status !== "running" ? (
        toolEvent.status === "success" ? (
          <ToolEventDetail label="结果" value={toolEvent.output} />
        ) : (
          <div className="chatToolEventDetail">
            工具调用失败：{toolEvent.errorMessage || "未知错误"}
          </div>
        )
      ) : null}
    </div>
  );
}

function formatToolName(name: string): string {
  const labels: Record<string, string> = {
    calculator: "计算器",
    current_time: "当前时间",
    http_request: "HTTP 请求"
  };

  return labels[name] ?? name;
}

function formatToolStatus(toolEvent: ChatToolEvent): string {
  if (toolEvent.status === "running") {
    return "调用中";
  }

  const elapsed = Number.isFinite(toolEvent.elapsedMs)
    ? ` · ${toolEvent.elapsedMs}ms`
    : "";

  return toolEvent.status === "success" ? `完成${elapsed}` : `失败${elapsed}`;
}

function ToolEventDetail({ label, value }: { label: string; value: unknown }) {
  const text = formatToolJson(value);
  const shouldCollapse = isLongToolDetail(text);
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const visibleText = expanded ? text : getToolDetailPreview(text);

  return (
    <div className="chatToolEventDetail">
      <div className="chatToolEventDetailHeader">
        <span>{label}：</span>
        {shouldCollapse ? (
          <button
            className="chatToolEventToggle"
            type="button"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起" : "展开"}
          </button>
        ) : null}
      </div>
      <pre className="chatToolEventJson">{visibleText}</pre>
    </div>
  );
}

function formatToolJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isLongToolDetail(text: string): boolean {
  return text.length > 800 || text.split("\n").length > 16;
}

function getToolDetailPreview(text: string): string {
  const lines = text.split("\n");

  if (lines.length > 16) {
    return `${lines.slice(0, 16).join("\n")}\n...`;
  }

  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}
