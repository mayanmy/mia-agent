import type { EmbedScenario } from "../types";

const widgetScriptName = "mia-agent-widget.min.js";

export function getShareUrl(origin: string, shareToken: string | null): string {
  if (!shareToken) {
    return "";
  }

  return `${origin}/share/agents/${shareToken}`;
}

export function getEmbedCode({
  origin,
  shareToken,
  scenario,
  agentName
}: {
  origin: string;
  shareToken: string | null;
  scenario: EmbedScenario;
  agentName?: string;
}): string {
  if (!shareToken) {
    return "";
  }

  if (scenario === "multi") {
    return getMultiAgentEmbedCode(origin, shareToken, agentName);
  }

  if (scenario === "spa") {
    return getSpaEmbedCode(origin, shareToken, agentName);
  }

  if (scenario === "inline") {
    return getInlineEmbedCode(origin, shareToken, agentName);
  }

  return getScriptTag(origin, shareToken, agentName);
}

function getScriptTag(origin: string, shareToken: string, agentName?: string): string {
  const nameAttribute = agentName ? ` data-agent-name="${escapeHtmlAttribute(agentName)}"` : "";

  return `<script src="${origin}/${widgetScriptName}" data-agent-token="${shareToken}" data-api-base="${origin}"${nameAttribute} data-launcher-icon="M" data-launcher-size="56" async></script>`;
}

function getMultiAgentEmbedCode(origin: string, shareToken: string, agentName?: string): string {
  return [
    "<!-- 同一页面可放多段 script，最终只会显示一个 Mia 入口，聊天框内可切换 Agent。 -->",
    getScriptTag(origin, shareToken, agentName || "当前 Agent"),
    `<script src="${origin}/${widgetScriptName}" data-agent-token="另一个 Agent 的 shareToken" data-api-base="${origin}" data-agent-name="另一个 Agent 名称" async></script>`
  ].join("\n");
}

function getSpaEmbedCode(origin: string, shareToken: string, agentName?: string): string {
  const currentName = escapeJsString(agentName || "当前 Agent");

  return `<script>
function loadMiaAgentWidget(agent) {
  if (window.MiaAgentWidget && window.MiaAgentWidget.destroy) {
    window.MiaAgentWidget.destroy();
  }

  document.querySelectorAll("script[data-mia-widget-loader]").forEach(function (element) {
    element.remove();
  });

  var script = document.createElement("script");
  script.src = "${origin}/${widgetScriptName}";
  script.async = true;
  script.setAttribute("data-mia-widget-loader", "true");
  script.setAttribute("data-api-base", "${origin}");
  script.setAttribute("data-agent-token", agent.token);
  script.setAttribute("data-agent-name", agent.name);
  script.setAttribute("data-launcher-icon", agent.icon || "M");
  script.setAttribute("data-launcher-size", String(agent.iconSize || 56));
  document.body.appendChild(script);
}

// 在路由变化时调用，传入当前页面对应的 Agent。
loadMiaAgentWidget({
  token: "${shareToken}",
  name: "${currentName}",
  icon: "M",
  iconSize: 56
});
</script>`;
}

function getInlineEmbedCode(origin: string, shareToken: string, agentName?: string): string {
  return [
    '<div id="mia-agent-container" style="height: 600px;"></div>',
    "",
    `<script src="${origin}/${widgetScriptName}" data-agent-token="${shareToken}" data-api-base="${origin}" data-agent-name="${escapeHtmlAttribute(agentName || "当前 Agent")}" data-mode="inline" data-container="#mia-agent-container" async></script>`
  ].join("\n");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function escapeJsString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n");
}
