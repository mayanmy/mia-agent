(function () {
  var currentScript = document.currentScript;
  var token = currentScript && currentScript.getAttribute("data-agent-token");
  var agentName = currentScript && currentScript.getAttribute("data-agent-name");
  var mode = (currentScript && currentScript.getAttribute("data-mode")) || "floating";
  var containerSelector = currentScript && currentScript.getAttribute("data-container");
  var launcherIcon = (currentScript && currentScript.getAttribute("data-launcher-icon")) || "M";
  var launcherIconUrl = currentScript && currentScript.getAttribute("data-launcher-icon-url");
  var launcherSize = normalizeLauncherSize(
    (currentScript && currentScript.getAttribute("data-launcher-size")) || "56"
  );
  var isInline = mode === "inline";
  var apiBase =
    (currentScript && currentScript.getAttribute("data-api-base")) ||
    (currentScript ? new URL(currentScript.src).origin : window.location.origin);
  var registryName = "__MIA_AGENT_WIDGET_AGENTS__";
  var eventName = "mia-agent-widget:agents-changed";
  var styleId = "mia-agent-widget-style";
  var rootId = isInline
    ? "mia-agent-widget-inline-" + createSafeId(apiBase + "-" + token + "-" + (containerSelector || "body"))
    : "mia-agent-widget-root";
  var inlineAgents = [];

  window.MiaAgentWidget = window.MiaAgentWidget || {};
  window.MiaAgentWidget.destroy = function () {
    var rootElement = document.getElementById("mia-agent-widget-root");
    var styleElement = document.getElementById(styleId);

    if (rootElement) {
      rootElement.remove();
    }

    if (styleElement) {
      styleElement.remove();
    }

    window[registryName] = [];
  };

  if (!token) {
    return;
  }

  if (isInline) {
    registerAgentTo(inlineAgents, {
      token: token,
      apiBase: apiBase,
      name: agentName || ""
    });
  } else {
    window[registryName] = window[registryName] || [];
    registerAgentTo(window[registryName], {
      token: token,
      apiBase: apiBase,
      name: agentName || ""
    });
  }

  if (isInline && document.getElementById(rootId)) {
    return;
  }

  if (!isInline && document.getElementById(rootId)) {
    window.dispatchEvent(new CustomEvent(eventName));
    return;
  }

  var mountTarget = resolveMountTarget();

  if (!mountTarget) {
    return;
  }

  var state = {
    activeKey: getAgentKey(getAgents()[0]),
    streaming: false,
    abortController: null,
    images: [],
    files: [],
    dragging: false,
    dragMoved: false,
    dragStartX: 0,
    dragStartY: 0,
    rootStartLeft: 24,
    rootStartTop: 0,
    closedLeft: null,
    closedTop: null,
    fullscreen: false,
    beforeFullscreenLeft: null,
    beforeFullscreenTop: null,
    beforeFullscreenRootStyle: "",
    beforeFullscreenPanelStyle: ""
  };

  var root = document.createElement("div");
  root.id = rootId;
  root.className = isInline ? "mia-agent-widget-inline" : "mia-agent-widget-floating";
  root.innerHTML =
    '<button class="mia-agent-launcher" type="button" aria-label="打开 Mia 对话"></button>' +
    '<section class="mia-agent-panel" aria-label="Mia 对话窗口">' +
    '<header class="mia-agent-header">' +
    '<div><div class="mia-agent-title">Mia</div><div class="mia-agent-subtitle">AI Agent</div></div>' +
    '<select class="mia-agent-selector" aria-label="选择 Agent"></select>' +
    '<button class="mia-agent-fullscreen" type="button" aria-label="全屏">⛶</button>' +
    '<button class="mia-agent-close" type="button" aria-label="关闭">×</button>' +
    '</header>' +
    '<main class="mia-agent-messages"></main>' +
    '<footer class="mia-agent-composer">' +
    '<div class="mia-agent-attachments"></div>' +
    '<div class="mia-agent-toolbar">' +
    '<button class="mia-agent-tool-button mia-agent-image-button" type="button">图片</button>' +
    '<button class="mia-agent-tool-button mia-agent-file-button" type="button">文件</button>' +
    '</div>' +
    '<div class="mia-agent-composer-row">' +
    '<textarea class="mia-agent-input" rows="2" placeholder="输入消息，或直接粘贴图片..."></textarea>' +
    '<button class="mia-agent-send" type="button">发送</button>' +
    '</div>' +
    '<input class="mia-agent-image-input" type="file" accept="image/*" multiple hidden />' +
    '<input class="mia-agent-file-input" type="file" multiple hidden />' +
    '</footer>' +
    '</section>';

  var style = document.createElement("style");
  style.id = styleId;
  style.textContent =
    "#mia-agent-widget-root{position:fixed;right:24px;bottom:24px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;touch-action:none}" +
    "#mia-agent-widget-root *,.mia-agent-widget-inline *{box-sizing:border-box}" +
    ".mia-agent-widget-inline{position:relative;width:100%;height:100%;min-height:420px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827}" +
    ".mia-agent-launcher{width:var(--mia-launcher-size,56px);height:var(--mia-launcher-size,56px);border:0;border-radius:calc(var(--mia-launcher-size,56px) * .32);background:#2563eb;color:#fff;font-size:calc(var(--mia-launcher-size,56px) * .43);font-weight:800;box-shadow:0 14px 34px rgba(37,99,235,.32);cursor:grab;user-select:none;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;padding:0}" +
    ".mia-agent-launcher img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".mia-agent-launcher:active{cursor:grabbing}" +
    ".mia-agent-panel{display:none;width:360px;height:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:hidden;border:1px solid #dbe3ef;border-radius:18px;background:#fff;box-shadow:0 24px 60px rgba(15,23,42,.2);min-height:0}" +
    ".mia-agent-panel.mia-agent-open{display:flex;flex-direction:column}" +
    ".mia-agent-widget-fullscreen{position:fixed!important;left:12px!important;top:12px!important;right:auto!important;bottom:auto!important;width:calc(100vw - 24px)!important;height:calc(100vh - 24px)!important;z-index:2147483647}" +
    ".mia-agent-widget-fullscreen .mia-agent-panel{display:flex!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;border-radius:14px;box-shadow:0 24px 80px rgba(15,23,42,.28);min-height:0}" +
    ".mia-agent-widget-inline .mia-agent-launcher{display:none}" +
    ".mia-agent-widget-inline .mia-agent-panel{display:flex;width:100%;height:100%;max-width:none;max-height:none;box-shadow:none}" +
    ".mia-agent-widget-inline .mia-agent-close{display:none}" +
    ".mia-agent-widget-inline .mia-agent-header{cursor:default}" +
    ".mia-agent-header{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:10px;align-items:center;padding:16px;border-bottom:1px solid #e5e7eb;background:#f8fafc;cursor:grab;user-select:none}" +
    ".mia-agent-header:active{cursor:grabbing}" +
    ".mia-agent-title{font-size:16px;font-weight:800;line-height:1.2}" +
    ".mia-agent-subtitle{margin-top:4px;color:#64748b;font-size:12px;line-height:1.2}" +
    ".mia-agent-selector{max-width:132px;height:32px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#111827;padding:0 8px;font:inherit;font-size:12px;outline:none;cursor:pointer}" +
    ".mia-agent-close,.mia-agent-fullscreen{width:30px;height:30px;border:0;border-radius:999px;background:#e5e7eb;color:#334155;font-size:18px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}" +
    ".mia-agent-messages{flex:1 1 auto;min-height:0;overflow:auto;padding:16px;background:#fff}" +
    ".mia-agent-message{margin-bottom:12px;display:flex;flex-direction:column}" +
    ".mia-agent-message-user{align-items:flex-end}" +
    ".mia-agent-message-assistant{align-items:flex-start}" +
    ".mia-agent-bubble{max-width:84%;white-space:pre-wrap;word-break:break-word;border-radius:14px;padding:10px 12px;font-size:14px;line-height:1.55}" +
    ".mia-agent-message-user .mia-agent-bubble{background:#2563eb;color:#fff;border-bottom-right-radius:4px}" +
    ".mia-agent-message-assistant .mia-agent-bubble{background:#f1f5f9;color:#111827;border-bottom-left-radius:4px}" +
    ".mia-agent-composer{display:flex;flex:0 0 auto;flex-direction:column;gap:10px;padding:12px;border-top:1px solid #e5e7eb;background:#fff}" +
    ".mia-agent-toolbar{display:flex;gap:8px;align-items:center}" +
    ".mia-agent-composer-row{display:flex;gap:8px;align-items:flex-end}" +
    ".mia-agent-input{flex:1;min-height:44px;max-height:120px;resize:none;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;font:inherit;font-size:14px;outline:none}" +
    ".mia-agent-input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}" +
    ".mia-agent-tool-button{height:32px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#334155;font-weight:700;cursor:pointer;padding:0 10px;white-space:nowrap}" +
    ".mia-agent-send{min-width:64px;height:44px;border:0;border-radius:12px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer}" +
    ".mia-agent-send:disabled{background:#cbd5e1;cursor:not-allowed}" +
    ".mia-agent-attachments{display:none;gap:8px;flex-wrap:wrap}" +
    ".mia-agent-attachments.mia-agent-has-attachments{display:flex}" +
    ".mia-agent-attachment{position:relative;display:flex;align-items:center;gap:6px;max-width:150px;border:1px solid #dbe3ef;border-radius:10px;background:#f8fafc;padding:6px 28px 6px 8px;font-size:12px;color:#334155}" +
    ".mia-agent-attachment img{width:42px;height:42px;object-fit:cover;border-radius:8px}" +
    ".mia-agent-attachment-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".mia-agent-attachment-remove{position:absolute;right:4px;top:4px;width:20px;height:20px;border:0;border-radius:999px;background:#e5e7eb;color:#334155;line-height:20px;padding:0;cursor:pointer}" +
    ".mia-agent-hidden{display:none}";

  if (!document.getElementById(styleId)) {
    document.head.appendChild(style);
  }
  mountTarget.appendChild(root);

  var launcher = root.querySelector(".mia-agent-launcher");
  var panel = root.querySelector(".mia-agent-panel");
  var closeButton = root.querySelector(".mia-agent-close");
  var fullscreenButton = root.querySelector(".mia-agent-fullscreen");
  var messagesEl = root.querySelector(".mia-agent-messages");
  var input = root.querySelector(".mia-agent-input");
  var sendButton = root.querySelector(".mia-agent-send");
  var imageButton = root.querySelector(".mia-agent-image-button");
  var fileButton = root.querySelector(".mia-agent-file-button");
  var imageInput = root.querySelector(".mia-agent-image-input");
  var fileInput = root.querySelector(".mia-agent-file-input");
  var attachmentsEl = root.querySelector(".mia-agent-attachments");
  var titleEl = root.querySelector(".mia-agent-title");
  var subtitleEl = root.querySelector(".mia-agent-subtitle");
  var selector = root.querySelector(".mia-agent-selector");
  root.style.setProperty("--mia-launcher-size", launcherSize + "px");
  renderLauncherIcon();

  renderAgentOptions();
  updateHeader();

  if (!isInline) {
    window.addEventListener(eventName, function () {
      renderAgentOptions();
      updateHeader();
      if (panel.classList.contains("mia-agent-open")) {
        loadAllAgents();
      }
    });
  }

  launcher.addEventListener("click", function () {
    if (state.dragMoved) {
      state.dragMoved = false;
      return;
    }

    openPanel();
    input.focus();
    loadAllAgents();
  });

  selector.addEventListener("pointerdown", function (event) {
    event.stopPropagation();
  });

  closeButton.addEventListener("pointerdown", function (event) {
    event.stopPropagation();
  });

  fullscreenButton.addEventListener("pointerdown", function (event) {
    event.stopPropagation();
  });

  selector.addEventListener("change", function () {
    if (state.streaming) {
      selector.value = state.activeKey;
      return;
    }

    state.activeKey = selector.value;
    renderMessages();
    updateHeader();
    loadActiveAgent();
    ensureWelcomeMessage(getActiveEntry());
  });

  closeButton.addEventListener("click", function () {
    closePanel();
  });

  fullscreenButton.addEventListener("click", function () {
    toggleFullscreen();
  });

  sendButton.addEventListener("click", function () {
    sendMessage();
  });

  imageButton.addEventListener("click", function () {
    imageInput.click();
  });

  fileButton.addEventListener("click", function () {
    fileInput.click();
  });

  imageInput.addEventListener("change", function () {
    addImageFiles(Array.prototype.slice.call(imageInput.files || []));
    imageInput.value = "";
  });

  fileInput.addEventListener("change", function () {
    addTextFiles(Array.prototype.slice.call(fileInput.files || []));
    fileInput.value = "";
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener("paste", function (event) {
    var items = event.clipboardData && event.clipboardData.items;

    if (!items) {
      return;
    }

    Array.prototype.slice.call(items).forEach(function (item) {
      if (item.kind === "file" && item.type.indexOf("image/") === 0) {
        var file = item.getAsFile();

        if (file) {
          addImageFiles([file]);
        }
      }
    });
  });

  if (isInline) {
    panel.classList.add("mia-agent-open");
    loadAllAgents();
  } else {
    addDragHandle(launcher);
    addDragHandle(root.querySelector(".mia-agent-header"));
  }

  function openPanel() {
    captureClosedPosition();
    launcher.classList.add("mia-agent-hidden");
    panel.classList.add("mia-agent-open");
    requestAnimationFrame(function () {
      keepRootInViewport();
    });
  }

  function closePanel() {
    if (state.fullscreen) {
      exitFullscreen();
    }

    panel.classList.remove("mia-agent-open");
    launcher.classList.remove("mia-agent-hidden");
    requestAnimationFrame(function () {
      restoreClosedPosition();
    });
  }

  function toggleFullscreen() {
    if (state.fullscreen) {
      exitFullscreen();
      return;
    }

    enterFullscreen();
  }

  function enterFullscreen() {
    var rect = root.getBoundingClientRect();

    state.fullscreen = true;
    state.beforeFullscreenLeft = rect.left;
    state.beforeFullscreenTop = rect.top;
    state.beforeFullscreenRootStyle = root.getAttribute("style") || "";
    state.beforeFullscreenPanelStyle = panel.getAttribute("style") || "";
    root.classList.add("mia-agent-widget-fullscreen");
    root.style.position = "fixed";
    root.style.left = "12px";
    root.style.top = "12px";
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.width = "calc(100vw - 24px)";
    root.style.height = "calc(100vh - 24px)";
    root.style.zIndex = "2147483647";
    panel.style.display = "flex";
    panel.style.width = "100%";
    panel.style.height = "100%";
    panel.style.maxWidth = "none";
    panel.style.maxHeight = "none";
    panel.style.minHeight = "0";
    fullscreenButton.textContent = "↙";
    fullscreenButton.setAttribute("aria-label", "退出全屏");
  }

  function exitFullscreen() {
    state.fullscreen = false;
    root.classList.remove("mia-agent-widget-fullscreen");
    root.setAttribute("style", state.beforeFullscreenRootStyle);
    panel.setAttribute("style", state.beforeFullscreenPanelStyle);
    root.style.setProperty("--mia-launcher-size", launcherSize + "px");
    fullscreenButton.textContent = "⛶";
    fullscreenButton.setAttribute("aria-label", "全屏");

    if (
      typeof state.beforeFullscreenLeft === "number" &&
      typeof state.beforeFullscreenTop === "number" &&
      !isInline
    ) {
      root.style.left = state.beforeFullscreenLeft + "px";
      root.style.top = state.beforeFullscreenTop + "px";
      root.style.right = "auto";
      root.style.bottom = "auto";
      keepRootInViewport();
    }
  }

  function loadActiveAgent() {
    var entry = getActiveEntry();

    loadAgentEntry(entry, true);
  }

  function loadAllAgents() {
    var activeEntry = getActiveEntry();

    getAgents().forEach(function (entry) {
      loadAgentEntry(entry, entry === activeEntry);
    });
  }

  function loadAgentEntry(entry, shouldGreet) {
    if (!entry || entry.agent || entry.loadingAgent) {
      return;
    }

    entry.loadingAgent = true;
    fetch(entry.apiBase + "/api/v1/agents/shared/" + encodeURIComponent(entry.token))
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Agent 不可用");
        }

        return response.json();
      })
      .then(function (result) {
        entry.agent = result.data;
        entry.name = entry.agent.name || entry.name || "Mia";
        renderAgentOptions();

        if (getActiveEntry() === entry) {
          updateHeader();
        }

        if (shouldGreet && getActiveEntry() === entry) {
          ensureWelcomeMessage(entry);
        }
      })
      .catch(function (error) {
        if (getActiveEntry() === entry) {
          appendMessage("assistant", error.message || "Agent 加载失败");
        }
      })
      .finally(function () {
        entry.loadingAgent = false;
      });
  }

  function ensureWelcomeMessage(entry) {
    if (!entry || !entry.agent || entry.messages.length > 0 || getActiveEntry() !== entry) {
      return;
    }

    appendMessage("assistant", "您好，我是 " + (entry.agent.name || "Mia") + "，请问有什么可以帮您？");
  }

  function sendMessage() {
    var content = input.value.trim();
    var currentImages = state.images.slice();
    var currentFiles = state.files.slice();

    if ((!content && currentImages.length === 0 && currentFiles.length === 0) || state.streaming) {
      return;
    }

    var entry = getActiveEntry();

    if (!entry || !entry.agent) {
      appendMessage("assistant", "Agent 正在加载，请稍后再试。");
      loadActiveAgent();
      return;
    }

    var history = entry.messages.slice(-12).map(function (message) {
      return {
        role: message.role,
        content: message.content
      };
    });

    input.value = "";
    state.images = [];
    state.files = [];
    renderAttachments();
    appendMessage("user", buildUserDisplayContent(content, currentImages, currentFiles));
    var assistantMessage = appendMessage("assistant", "");
    state.streaming = true;
    sendButton.disabled = true;
    state.abortController = new AbortController();

    fetch(entry.apiBase + "/api/v1/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId: entry.agent.id,
        message: content,
        images: currentImages,
        files: currentFiles,
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

  function addImageFiles(files) {
    files.slice(0, Math.max(0, 4 - state.images.length)).forEach(function (file) {
      if (!file || file.type.indexOf("image/") !== 0) {
        return;
      }

      readFileAsDataUrl(file).then(function (dataUrl) {
        state.images.push({
          id: createId(),
          name: file.name || "image",
          mimeType: file.type || "image/png",
          dataUrl: dataUrl
        });
        renderAttachments();
      });
    });
  }

  function addTextFiles(files) {
    files.slice(0, Math.max(0, 4 - state.files.length)).forEach(function (file) {
      if (!file) {
        return;
      }

      readFileAsText(file).then(function (content) {
        state.files.push({
          id: createId(),
          name: file.name || "file",
          mimeType: file.type || "text/plain",
          size: file.size || content.length,
          content: content.slice(0, 200000)
        });
        renderAttachments();
      });
    });
  }

  function renderAttachments() {
    attachmentsEl.innerHTML = "";
    attachmentsEl.classList.toggle(
      "mia-agent-has-attachments",
      state.images.length > 0 || state.files.length > 0
    );

    state.images.forEach(function (image) {
      attachmentsEl.appendChild(createAttachmentElement("image", image));
    });
    state.files.forEach(function (file) {
      attachmentsEl.appendChild(createAttachmentElement("file", file));
    });
  }

  function createAttachmentElement(type, item) {
    var wrapper = document.createElement("div");
    var name = document.createElement("span");
    var remove = document.createElement("button");

    wrapper.className = "mia-agent-attachment";
    if (type === "image") {
      var image = document.createElement("img");
      image.src = item.dataUrl;
      image.alt = item.name;
      wrapper.appendChild(image);
    }

    name.className = "mia-agent-attachment-name";
    name.textContent = item.name;
    remove.className = "mia-agent-attachment-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.addEventListener("click", function () {
      if (type === "image") {
        state.images = state.images.filter(function (image) {
          return image.id !== item.id;
        });
      } else {
        state.files = state.files.filter(function (file) {
          return file.id !== item.id;
        });
      }

      renderAttachments();
    });

    wrapper.appendChild(name);
    wrapper.appendChild(remove);
    return wrapper;
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("图片读取失败"));
      };
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("文件读取失败"));
      };
      reader.readAsText(file);
    });
  }

  function createId() {
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function buildUserDisplayContent(content, images, files) {
    var attachmentNames = images
      .map(function (image) {
        return "[图片] " + image.name;
      })
      .concat(
        files.map(function (file) {
          return "[文件] " + file.name;
        })
      );

    return [content].concat(attachmentNames).filter(Boolean).join("\n");
  }

  function appendMessage(role, content) {
    var entry = getActiveEntry();
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
    if (entry) {
      entry.messages.push(message);
    }
    scrollToBottom();

    return message;
  }

  function renderMessages() {
    var entry = getActiveEntry();

    messagesEl.innerHTML = "";

    if (!entry) {
      return;
    }

    entry.messages.forEach(function (message) {
      var wrapper = document.createElement("div");
      var bubble = document.createElement("div");
      wrapper.className = "mia-agent-message mia-agent-message-" + message.role;
      bubble.className = "mia-agent-bubble";
      bubble.textContent = message.content || " ";
      wrapper.appendChild(bubble);
      messagesEl.appendChild(wrapper);
      message.bubble = bubble;
    });
    scrollToBottom();
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

  function registerAgentTo(agents, nextAgent) {
    var key = getAgentKey(nextAgent);
    var existing = agents.filter(function (item) {
      return getAgentKey(item) === key;
    })[0];

    if (existing) {
      existing.name = nextAgent.name || existing.name;
      existing.apiBase = nextAgent.apiBase;
      return;
    }

    agents.push({
      key: key,
      token: nextAgent.token,
      apiBase: nextAgent.apiBase,
      name: nextAgent.name || "Mia Agent",
      agent: null,
      loadingAgent: false,
      messages: []
    });
  }

  function getAgents() {
    return isInline ? inlineAgents : window[registryName] || [];
  }

  function getAgentKey(agent) {
    return agent.apiBase + "::" + agent.token;
  }

  function getActiveEntry() {
    var agents = getAgents();
    var entry = agents.filter(function (item) {
      return getAgentKey(item) === state.activeKey;
    })[0];

    if (!entry && agents[0]) {
      state.activeKey = getAgentKey(agents[0]);
      return agents[0];
    }

    return entry || null;
  }

  function renderAgentOptions() {
    var agents = getAgents();
    selector.innerHTML = "";

    agents.forEach(function (entry) {
      var option = document.createElement("option");
      option.value = getAgentKey(entry);
      option.textContent = (entry.agent && entry.agent.name) || entry.name || "Mia Agent";
      selector.appendChild(option);
    });

    selector.value = state.activeKey;
    selector.style.display = agents.length > 1 ? "block" : "none";
  }

  function updateHeader() {
    var entry = getActiveEntry();
    var agent = entry && entry.agent;

    titleEl.textContent = (agent && agent.name) || (entry && entry.name) || "Mia";
    subtitleEl.textContent = agent
      ? (agent.providerName || "Agent") + " / " + (agent.modelName || "")
      : "AI Agent";
  }

  function addDragHandle(handle) {
    handle.addEventListener("pointerdown", function (event) {
      if (state.fullscreen) {
        return;
      }

      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      if (handle !== launcher && isInteractiveElement(event.target)) {
        return;
      }

      event.preventDefault();
      var rect = root.getBoundingClientRect();
      state.dragging = true;
      state.dragMoved = false;
      state.dragStartX = event.clientX;
      state.dragStartY = event.clientY;
      state.rootStartLeft = rect.left;
      state.rootStartTop = rect.top;
      root.style.left = rect.left + "px";
      root.style.top = rect.top + "px";
      root.style.right = "auto";
      root.style.bottom = "auto";
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener("pointermove", function (event) {
      if (!state.dragging) {
        return;
      }

      var deltaX = event.clientX - state.dragStartX;
      var deltaY = event.clientY - state.dragStartY;

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        state.dragMoved = true;
      }

      moveRoot(state.rootStartLeft + deltaX, state.rootStartTop + deltaY);
    });

    handle.addEventListener("pointerup", function (event) {
      var shouldCaptureClosedPosition = state.dragMoved;
      state.dragging = false;
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture may already be released by the browser.
      }

      if (shouldCaptureClosedPosition) {
        if (handle === launcher) {
          captureClosedPosition();
        } else {
          captureClosedPositionFromPanel();
        }
      }
    });

    handle.addEventListener("pointercancel", function () {
      state.dragging = false;
    });
  }

  function moveRoot(nextLeft, nextTop) {
    var rect = root.getBoundingClientRect();
    var margin = 12;
    var maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    var maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    var left = Math.min(Math.max(nextLeft, margin), maxLeft);
    var top = Math.min(Math.max(nextTop, margin), maxTop);

    root.style.left = left + "px";
    root.style.top = top + "px";
  }

  function keepRootInViewport() {
    var rect = root.getBoundingClientRect();
    var currentLeft = rect.left;
    var currentTop = rect.top;

    if (root.style.bottom && !root.style.top) {
      root.style.left = rect.left + "px";
      root.style.top = rect.top + "px";
      root.style.right = "auto";
      root.style.bottom = "auto";
    }

    moveRoot(currentLeft, currentTop);
  }

  function captureClosedPosition() {
    var rect = root.getBoundingClientRect();

    state.closedLeft = rect.left;
    state.closedTop = rect.top;
    root.style.left = rect.left + "px";
    root.style.top = rect.top + "px";
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

  function captureClosedPositionFromPanel() {
    var rect = root.getBoundingClientRect();
    var launcherSize = getLauncherSize();

    state.closedLeft = rect.right - launcherSize;
    state.closedTop = rect.bottom - launcherSize;
  }

  function restoreClosedPosition() {
    if (typeof state.closedLeft !== "number" || typeof state.closedTop !== "number") {
      keepRootInViewport();
      return;
    }

    moveRoot(state.closedLeft, state.closedTop);
  }

  function getLauncherSize() {
    return launcherSize;
  }

  function isInteractiveElement(target) {
    return Boolean(
      target &&
        target.closest &&
        target.closest("button,select,textarea,input,a,label")
    );
  }

  function resolveMountTarget() {
    if (!isInline) {
      return document.body;
    }

    if (!containerSelector) {
      return currentScript && currentScript.parentElement;
    }

    return document.querySelector(containerSelector);
  }

  function createSafeId(value) {
    return String(value || "default").replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  function normalizeLauncherSize(value) {
    var parsed = Number.parseInt(String(value), 10);

    if (!Number.isFinite(parsed)) {
      return 56;
    }

    return Math.min(Math.max(parsed, 40), 96);
  }

  function renderLauncherIcon() {
    launcher.innerHTML = "";

    if (launcherIconUrl) {
      var image = document.createElement("img");
      image.alt = launcherIcon || "Mia";
      image.src = launcherIconUrl;
      launcher.appendChild(image);
      return;
    }

    launcher.textContent = launcherIcon || "M";
  }
})();
