(function () {
  var currentScript = document.currentScript;
  var token = currentScript && currentScript.getAttribute("data-agent-token");
  var apiBase =
    (currentScript && currentScript.getAttribute("data-api-base")) ||
    (currentScript ? new URL(currentScript.src).origin : window.location.origin);

  if (!token || document.getElementById("mia-agent-widget-root")) {
    return;
  }

  var state = {
    agent: null,
    loadingAgent: false,
    messages: [],
    streaming: false,
    abortController: null
  };

  var root = document.createElement("div");
  root.id = "mia-agent-widget-root";
  root.innerHTML =
    '<button class="mia-agent-launcher" type="button" aria-label="打开 Mia 对话">M</button>' +
    '<section class="mia-agent-panel" aria-label="Mia 对话窗口">' +
    '<header class="mia-agent-header">' +
    '<div><div class="mia-agent-title">Mia</div><div class="mia-agent-subtitle">AI Agent</div></div>' +
    '<button class="mia-agent-close" type="button" aria-label="关闭">×</button>' +
    '</header>' +
    '<main class="mia-agent-messages"></main>' +
    '<footer class="mia-agent-composer">' +
    '<textarea class="mia-agent-input" rows="2" placeholder="输入消息..."></textarea>' +
    '<button class="mia-agent-send" type="button">发送</button>' +
    '</footer>' +
    '</section>';

  var style = document.createElement("style");
  style.textContent =
    "#mia-agent-widget-root{position:fixed;left:24px;bottom:24px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827}" +
    "#mia-agent-widget-root *{box-sizing:border-box}" +
    ".mia-agent-launcher{width:56px;height:56px;border:0;border-radius:18px;background:#2563eb;color:#fff;font-size:24px;font-weight:800;box-shadow:0 14px 34px rgba(37,99,235,.32);cursor:pointer}" +
    ".mia-agent-panel{display:none;width:360px;height:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:hidden;border:1px solid #dbe3ef;border-radius:18px;background:#fff;box-shadow:0 24px 60px rgba(15,23,42,.2)}" +
    ".mia-agent-panel.mia-agent-open{display:flex;flex-direction:column}" +
    ".mia-agent-header{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid #e5e7eb;background:#f8fafc}" +
    ".mia-agent-title{font-size:16px;font-weight:800;line-height:1.2}" +
    ".mia-agent-subtitle{margin-top:4px;color:#64748b;font-size:12px;line-height:1.2}" +
    ".mia-agent-close{width:30px;height:30px;border:0;border-radius:999px;background:#e5e7eb;color:#334155;font-size:20px;line-height:1;cursor:pointer}" +
    ".mia-agent-messages{flex:1;overflow:auto;padding:16px;background:#fff}" +
    ".mia-agent-message{margin-bottom:12px;display:flex;flex-direction:column}" +
    ".mia-agent-message-user{align-items:flex-end}" +
    ".mia-agent-message-assistant{align-items:flex-start}" +
    ".mia-agent-bubble{max-width:84%;white-space:pre-wrap;word-break:break-word;border-radius:14px;padding:10px 12px;font-size:14px;line-height:1.55}" +
    ".mia-agent-message-user .mia-agent-bubble{background:#2563eb;color:#fff;border-bottom-right-radius:4px}" +
    ".mia-agent-message-assistant .mia-agent-bubble{background:#f1f5f9;color:#111827;border-bottom-left-radius:4px}" +
    ".mia-agent-composer{display:flex;gap:10px;align-items:flex-end;padding:12px;border-top:1px solid #e5e7eb;background:#fff}" +
    ".mia-agent-input{flex:1;min-height:44px;max-height:120px;resize:none;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;font:inherit;font-size:14px;outline:none}" +
    ".mia-agent-input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}" +
    ".mia-agent-send{min-width:64px;height:44px;border:0;border-radius:12px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer}" +
    ".mia-agent-send:disabled{background:#cbd5e1;cursor:not-allowed}" +
    ".mia-agent-hidden{display:none}";

  document.head.appendChild(style);
  document.body.appendChild(root);

  var launcher = root.querySelector(".mia-agent-launcher");
  var panel = root.querySelector(".mia-agent-panel");
  var closeButton = root.querySelector(".mia-agent-close");
  var messagesEl = root.querySelector(".mia-agent-messages");
  var input = root.querySelector(".mia-agent-input");
  var sendButton = root.querySelector(".mia-agent-send");
  var titleEl = root.querySelector(".mia-agent-title");
  var subtitleEl = root.querySelector(".mia-agent-subtitle");

  launcher.addEventListener("click", function () {
    launcher.classList.add("mia-agent-hidden");
    panel.classList.add("mia-agent-open");
    input.focus();
    loadAgent();
  });

  closeButton.addEventListener("click", function () {
    panel.classList.remove("mia-agent-open");
    launcher.classList.remove("mia-agent-hidden");
  });

  sendButton.addEventListener("click", function () {
    sendMessage();
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  function loadAgent() {
    if (state.agent || state.loadingAgent) {
      return;
    }

    state.loadingAgent = true;
    fetch(apiBase + "/api/v1/agents/shared/" + encodeURIComponent(token))
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Agent 不可用");
        }

        return response.json();
      })
      .then(function (result) {
        state.agent = result.data;
        titleEl.textContent = state.agent.name || "Mia";
        subtitleEl.textContent =
          (state.agent.providerName || "Agent") + " / " + (state.agent.modelName || "");
        appendMessage("assistant", "您好，我是 " + (state.agent.name || "Mia") + "，请问有什么可以帮您？");
      })
      .catch(function (error) {
        appendMessage("assistant", error.message || "Agent 加载失败");
      })
      .finally(function () {
        state.loadingAgent = false;
      });
  }

  function sendMessage() {
    var content = input.value.trim();

    if (!content || state.streaming) {
      return;
    }

    if (!state.agent) {
      appendMessage("assistant", "Agent 正在加载，请稍后再试。");
      loadAgent();
      return;
    }

    var history = state.messages.slice(-12).map(function (message) {
      return {
        role: message.role,
        content: message.content
      };
    });

    input.value = "";
    appendMessage("user", content);
    var assistantMessage = appendMessage("assistant", "");
    state.streaming = true;
    sendButton.disabled = true;
    state.abortController = new AbortController();

    fetch(apiBase + "/api/v1/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId: state.agent.id,
        message: content,
        images: [],
        files: [],
        history: history
      }),
      signal: state.abortController.signal
    })
      .then(function (response) {
        if (!response.ok || !response.body) {
          throw new Error("对话请求失败");
        }

        return readStream(response.body, function (event) {
          if (event.type === "token" && event.data.content) {
            assistantMessage.content += event.data.content;
            assistantMessage.bubble.textContent = assistantMessage.content;
            scrollToBottom();
          }

          if (event.type === "error") {
            throw new Error(event.data.message || "对话失败");
          }
        });
      })
      .catch(function (error) {
        if (!assistantMessage.content) {
          assistantMessage.content = error.message || "对话失败";
          assistantMessage.bubble.textContent = assistantMessage.content;
        }
      })
      .finally(function () {
        state.streaming = false;
        sendButton.disabled = false;
        state.abortController = null;
      });
  }

  function appendMessage(role, content) {
    var wrapper = document.createElement("div");
    var bubble = document.createElement("div");
    var message = {
      role: role,
      content: content,
      bubble: bubble
    };

    wrapper.className = "mia-agent-message mia-agent-message-" + role;
    bubble.className = "mia-agent-bubble";
    bubble.textContent = content || " ";
    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
    state.messages.push(message);
    scrollToBottom();

    return message;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function readStream(body, onEvent) {
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    return reader.read().then(function process(result) {
      if (result.done) {
        if (buffer.trim()) {
          handleRawEvent(buffer, onEvent);
        }

        return;
      }

      buffer += decoder.decode(result.value, { stream: true });
      var events = buffer.split(/\n\n/u);
      buffer = events.pop() || "";
      events.forEach(function (rawEvent) {
        handleRawEvent(rawEvent, onEvent);
      });

      return reader.read().then(process);
    });
  }

  function handleRawEvent(rawEvent, onEvent) {
    var event = parseSseEvent(rawEvent);

    if (event) {
      onEvent(event);
    }
  }

  function parseSseEvent(rawEvent) {
    var lines = rawEvent.split(/\r?\n/u);
    var type = "";
    var dataLines = [];

    lines.forEach(function (line) {
      if (line.indexOf("event:") === 0) {
        type = line.slice("event:".length).trim();
      }

      if (line.indexOf("data:") === 0) {
        dataLines.push(line.slice("data:".length).trim());
      }
    });

    if (!type) {
      return null;
    }

    try {
      return {
        type: type,
        data: dataLines.length ? JSON.parse(dataLines.join("\n")) : {}
      };
    } catch (error) {
      return null;
    }
  }
})();
