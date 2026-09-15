import { useState } from "react";
import { Button, Space, message } from "antd";

import { approveMcpToolCall, rejectMcpToolCall } from "../api";
import type { ChatToolEvent } from "../types";

/** 工具事件卡片参数。 */
type ToolEventCardProps = {
  /** 待展示的工具调用事件。 */
  toolEvent: ChatToolEvent;
};

/** 展示工具调用状态，并按需展开输入、输出或错误详情。 */
export function ToolEventCard({ toolEvent }: ToolEventCardProps) {
  const failureSummary = getFailureSummary(toolEvent);
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  async function decide(approved: boolean) {
    if (!toolEvent.approvalId || deciding) return;
    setDeciding(approved ? "approve" : "reject");
    try {
      if (approved) await approveMcpToolCall(toolEvent.approvalId);
      else await rejectMcpToolCall(toolEvent.approvalId);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "审批操作失败");
      setDeciding(null);
    }
  }

  return (
    <div className={`chatToolEvent ${toolEvent.status}`}>
      {contextHolder}
      <div className="chatToolEventHeader">
        <span className="chatToolEventName">
          {toolEvent.status === "error"
            ? `工具调用失败：${failureSummary.title}`
            : formatToolName(toolEvent.name)}
        </span>
        <span className="chatToolEventStatus">{formatToolStatus(toolEvent)}</span>
      </div>
      {toolEvent.arguments && Object.keys(toolEvent.arguments).length > 0 ? (
        <ToolEventDetail label="参数" value={toolEvent.arguments} />
      ) : null}
      {toolEvent.status === "approval_required" ? (
        <div className="chatToolApproval">
          <div className="chatToolApprovalHint">
            此工具将访问外部 MCP 服务，仅批准本次调用
            {toolEvent.approvalExpiresAt
              ? `，有效期至 ${new Date(toolEvent.approvalExpiresAt).toLocaleTimeString()}`
              : ""}
          </div>
          <Space>
            <Button
              loading={deciding === "reject"}
              disabled={Boolean(deciding)}
              onClick={() => void decide(false)}
            >
              拒绝
            </Button>
            <Button
              type="primary"
              loading={deciding === "approve"}
              disabled={Boolean(deciding)}
              onClick={() => void decide(true)}
            >
              批准并执行
            </Button>
          </Space>
        </div>
      ) : toolEvent.status !== "running" ? (
        toolEvent.status === "success" ? (
          <ToolEventDetail label="结果" value={toolEvent.output} />
        ) : (
          <ToolFailureDetail toolEvent={toolEvent} summary={failureSummary} />
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

  if (toolEvent.status === "approval_required") return "等待确认";

  const elapsed = Number.isFinite(toolEvent.elapsedMs) ? ` · ${toolEvent.elapsedMs}ms` : "";

  return toolEvent.status === "success" ? `完成${elapsed}` : `失败${elapsed}`;
}

/** 工具失败详情参数。 */
type ToolFailureDetailProps = {
  /** 原始工具调用事件。 */
  toolEvent: ChatToolEvent;
  /** 归一化后的错误摘要。 */
  summary: ToolFailureSummary;
};

/** 展示工具错误分类、失败原因和可选失败返回。 */
function ToolFailureDetail({ toolEvent, summary }: ToolFailureDetailProps) {
  const details = [
    ["工具", formatToolName(toolEvent.name)],
    ["错误类型", summary.typeLabel],
    ["失败原因", toolEvent.errorMessage || summary.description],
    ["工具 ID", toolEvent.name]
  ];

  return (
    <div className="chatToolFailure">
      <div className="chatToolFailureReason">{toolEvent.errorMessage || summary.description}</div>
      <div className="chatToolFailureGrid">
        {details.map(([label, value]) => (
          <div className="chatToolFailureRow" key={label}>
            <span className="chatToolFailureLabel">{label}</span>
            <span className="chatToolFailureValue">{value}</span>
          </div>
        ))}
      </div>
      {toolEvent.output !== undefined ? (
        <ToolEventDetail label="失败返回" value={toolEvent.output} />
      ) : null}
    </div>
  );
}

/** 工具输入或输出详情参数。 */
type ToolEventDetailProps = {
  /** 折叠区域标签。 */
  label: string;
  /** 待格式化展示的任意值。 */
  value: unknown;
};

/** 对较长工具详情提供折叠预览。 */
function ToolEventDetail({ label, value }: ToolEventDetailProps) {
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

/** 将底层工具错误归一化为面向用户展示的标题和说明。 */
type ToolFailureSummary = {
  /** 卡片标题使用的简短错误名称。 */
  title: string;
  /** 详情区域使用的错误分类。 */
  typeLabel: string;
  /** 未返回具体错误消息时的默认说明。 */
  description: string;
};

function getFailureSummary(toolEvent: ChatToolEvent): ToolFailureSummary {
  const message = toolEvent.errorMessage || "";

  if (toolEvent.errorType === "tool_not_found") {
    return {
      title: "工具不存在",
      typeLabel: "工具不存在或未启用",
      description: "当前 Agent 绑定的工具不存在、已停用，或后端没有注册该工具。"
    };
  }

  if (toolEvent.errorType === "invalid_tool_input") {
    return {
      title: getInvalidInputTitle(message),
      typeLabel: "参数错误或安全策略拦截",
      description: "模型生成的工具参数不符合工具要求，或目标地址被安全策略拦截。"
    };
  }

  if (toolEvent.errorType === "canceled") {
    return {
      title: "调用已取消",
      typeLabel: "调用取消",
      description: "本次对话或上游调用已被主动停止。"
    };
  }

  if (toolEvent.errorType === "tool_timeout") {
    return {
      title: "工具调用超时",
      typeLabel: "工具执行超时",
      description: "工具未在配置的时间内返回结果，不代表被查询的业务任务已取消。"
    };
  }

  if (toolEvent.errorType === "workflow_canceled") {
    return {
      title: "Workflow 执行中止",
      typeLabel: "Workflow 调用中止",
      description: "这是 Workflow 执行链路的状态，不代表被查询的业务任务已取消。"
    };
  }

  if (toolEvent.errorType === "workflow_tool_failed") {
    return {
      title: "Workflow 执行失败",
      typeLabel: "Workflow 节点异常",
      description: "Workflow 内部节点执行失败，应结合失败原因和 Trace 定位具体节点。"
    };
  }

  if (toolEvent.errorType === "tool_execution_failed") {
    return {
      title: "执行失败",
      typeLabel: "工具执行异常",
      description: "工具执行过程中出现异常，需要结合失败原因和参数排查。"
    };
  }

  return {
    title: "未知错误",
    typeLabel: toolEvent.errorType || "未知错误",
    description: "工具调用失败，但后端没有返回明确错误类型。"
  };
}

function getInvalidInputTitle(message: string): string {
  if (message.includes("安全策略") || message.includes("允许列表")) {
    return "安全策略拦截";
  }

  if (message.includes("超时")) {
    return "请求超时";
  }

  if (message.includes("参数错误")) {
    return "参数错误";
  }

  return "参数不合法";
}
