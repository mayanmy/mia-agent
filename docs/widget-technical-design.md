# Mia Agent Widget 技术文档

## 目标

Mia Agent Widget 是 Agent 发布后的前端嵌入组件，用于把已发布的 Agent 接入到外部页面或 Mia 内部页面中。它通过一段 `<script>` 加载，不依赖 React、Ant Design 或宿主页面框架，适合本地部署场景下快速嵌入。

Widget 当前支持两种展示形态：

- 浮窗模式：页面右下角显示入口图标，点击后弹出聊天框。
- 内嵌模式：直接渲染到指定容器中，适合放在业务页面固定区域。

## 文件位置

```text
frontend/public/mia-agent-widget.js
frontend/src/features/agents/AgentsPage.tsx
```

- `mia-agent-widget.js` 是最终被外部页面加载的原生 JS 脚本。
- `AgentsPage.tsx` 负责在 Agent 管理页生成可复制的嵌入代码。

## 嵌入方式

### 单页面单 Agent

用于一个页面只嵌入一个 Agent 的场景。

```html
<script
  src="http://localhost:5173/mia-agent-widget.js"
  data-agent-token="AGENT_SHARE_TOKEN"
  data-api-base="http://localhost:5173"
  data-agent-name="简历提升"
  data-launcher-icon="M"
  data-launcher-size="56"
  async
></script>
```

### 同页多 Agent

同一个页面可以放多段 script。Widget 只会显示一个入口，聊天框内通过下拉框切换 Agent。

```html
<script
  src="http://localhost:5173/mia-agent-widget.js"
  data-agent-token="AGENT_TOKEN_A"
  data-api-base="http://localhost:5173"
  data-agent-name="简历提升"
  async
></script>

<script
  src="http://localhost:5173/mia-agent-widget.js"
  data-agent-token="AGENT_TOKEN_B"
  data-api-base="http://localhost:5173"
  data-agent-name="运维助手"
  async
></script>
```

### SPA 路由切换

适合一个系统不同页面加载不同 Agent。路由变化时先销毁旧 Widget，再动态插入新 script。

```html
<script>
  function loadMiaAgentWidget(agent) {
    if (window.MiaAgentWidget && window.MiaAgentWidget.destroy) {
      window.MiaAgentWidget.destroy();
    }

    document.querySelectorAll("script[data-mia-widget-loader]").forEach(function (element) {
      element.remove();
    });

    var script = document.createElement("script");
    script.src = "http://localhost:5173/mia-agent-widget.js";
    script.async = true;
    script.setAttribute("data-mia-widget-loader", "true");
    script.setAttribute("data-api-base", "http://localhost:5173");
    script.setAttribute("data-agent-token", agent.token);
    script.setAttribute("data-agent-name", agent.name);
    script.setAttribute("data-launcher-icon", agent.icon || "M");
    script.setAttribute("data-launcher-size", String(agent.iconSize || 56));
    document.body.appendChild(script);
  }

  loadMiaAgentWidget({
    token: "AGENT_SHARE_TOKEN",
    name: "当前页面 Agent",
    icon: "M",
    iconSize: 56
  });
</script>
```

### Inline 内嵌模式

适合把聊天框固定放到页面某个区域。宿主容器必须有明确高度。

```html
<div id="mia-agent-container" style="height: 600px;"></div>

<script
  src="http://localhost:5173/mia-agent-widget.js"
  data-agent-token="AGENT_SHARE_TOKEN"
  data-api-base="http://localhost:5173"
  data-agent-name="简历提升"
  data-mode="inline"
  data-container="#mia-agent-container"
  async
></script>
```

## Script 参数

| 参数                     | 必填        | 默认值                  | 说明                                                            |
| ------------------------ | ----------- | ----------------------- | --------------------------------------------------------------- |
| `src`                    | 是          | 无                      | Widget 脚本地址，通常是 Mia 前端服务下的 `/mia-agent-widget.js` |
| `data-agent-token`       | 是          | 无                      | Agent 发布后生成的 share token                                  |
| `data-api-base`          | 否          | script 所在 origin      | API 请求基地址                                                  |
| `data-agent-name`        | 否          | 后端 Agent 名称或 `Mia` | Agent 初始显示名称                                              |
| `data-mode`              | 否          | `floating`              | `floating` 或 `inline`                                          |
| `data-container`         | inline 必填 | 无                      | inline 模式的挂载容器选择器                                     |
| `data-launcher-icon`     | 否          | `M`                     | 浮窗入口文字或 emoji                                            |
| `data-launcher-icon-url` | 否          | 无                      | 浮窗入口图片 URL，优先级高于 `data-launcher-icon`               |
| `data-launcher-size`     | 否          | `56`                    | 浮窗入口尺寸，范围限制为 40-96                                  |

## 运行机制

### 初始化流程

```text
读取 currentScript data-*
  -> 校验 data-agent-token
  -> 根据 mode 判断 floating / inline
  -> 注册 Agent 到当前实例或全局 Agent 注册表
  -> 创建 root DOM
  -> 注入 scoped style
  -> 加载 Agent 详情
  -> 渲染欢迎语
```

### Floating 模式

- Root 固定在页面右下角。
- 初始只展示 launcher。
- 点击 launcher 后隐藏 launcher，展示聊天面板。
- 支持拖动 launcher 和展开后的聊天面板。
- 关闭聊天面板后，launcher 会落在面板右下角附近。
- 支持全屏和退出全屏。

### Inline 模式

- Root 渲染到 `data-container` 指定容器。
- 不显示 launcher。
- 不显示关闭按钮。
- 面板默认展开。
- 不启用拖拽。
- 容器高度由宿主页面控制。

## 多 Agent 管理

Floating 模式使用全局注册表：

```text
window.__MIA_AGENT_WIDGET_AGENTS__
```

同页多段 script 会注册到同一个全局列表中。首次加载会创建 Widget 根节点，后续 script 只注册 Agent 并派发：

```text
mia-agent-widget:agents-changed
```

Widget 收到事件后刷新 Agent 下拉框。切换 Agent 时：

- 如果正在流式输出，禁止切换并恢复当前选中项。
- 如果目标 Agent 尚未加载，调用共享 Agent 详情接口。
- 每个 Agent 独立保存当前页面内的消息历史。
- 每个 Agent 第一次选中时会主动生成欢迎语。

## 接口依赖

### 加载共享 Agent

```text
GET /api/v1/agents/shared/{shareToken}
```

用途：

- 校验 share token。
- 获取 Agent 名称、模型、Provider 等展示和对话所需配置。

### 流式对话

```text
POST /api/v1/chat/stream
```

请求体：

```json
{
  "agentId": "agent-id",
  "message": "用户输入",
  "images": [],
  "files": [],
  "history": []
}
```

Widget 使用 `fetch + ReadableStream` 读取 SSE，不使用 `EventSource`。原因是当前接口需要 POST JSON body，并且需要传图片、文件、history 和 AbortController。

当前处理的 SSE 事件：

| 事件     | 行为                  |
| -------- | --------------------- |
| `token`  | 追加到 assistant 气泡 |
| `error`  | 显示错误              |
| 其他事件 | 解析但暂不展示        |

## 流式输出与停止

Widget 使用 `AbortController` 控制当前请求。

发送消息时：

```text
state.streaming = true
创建 AbortController
按钮文案改为“停止”
禁用输入框、图片按钮、文件按钮
fetch /api/v1/chat/stream
```

点击“停止”时：

```text
state.abortController.abort()
fetch 抛出 AbortError
assistant 气泡追加“已停止生成。”
恢复输入控件
按钮文案改为“发送”
```

## 附件能力

### 图片

支持：

- 点击“图片”按钮上传。
- 在输入框中直接粘贴图片。
- 一次最多 4 张。
- 单张最大 5MB。
- 仅允许 `image/*`。

发送前会校验当前模型是否像视觉模型。判断方式基于模型名关键字：

```text
vl
vision
omni
qvq
gpt-4o
gpt-4.1
gemini
claude-3
claude-4
```

如果当前模型不支持图片，Widget 会阻止发送，并提示用户切换到视觉模型。

### 文件

支持上传文本类文件。当前限制：

- 一次最多 4 个。
- 单个最大 1MB。
- 支持 `text/*`。
- 支持常见文本扩展名：

```text
.txt
.md
.json
.csv
.log
.yaml
.yml
.xml
.html
.css
.js
.jsx
.ts
.tsx
.py
.java
.sql
```

文件内容由浏览器读取为文本后随请求发送。当前不支持二进制文件、PDF、Word、Excel 的解析。

## 消息展示

每条消息包含：

- 气泡内容。
- 当前时间，格式为本地 `HH:mm`。
- 复制按钮。

复制成功或失败会显示轻量 toast。

当前消息历史只保存在页面内存中，刷新页面会丢失。发送请求时会携带当前 Agent 最近 12 条消息作为 history。

## Toast 反馈

Widget 内置轻量 toast，不依赖宿主页面组件库。

当前触发场景：

- 复制成功。
- 复制失败。
- 图片类型错误。
- 图片超过大小限制。
- 图片数量超过限制。
- 文件类型错误。
- 文件超过大小限制。
- 文件数量超过限制。
- 文件读取失败。

Toast DOM 挂在 Widget root 内，使用绝对定位，不影响宿主页面布局。

## 样式隔离

Widget 会向页面注入一个 `<style id="mia-agent-widget-style">`。

约定：

- 主要样式类名使用 `mia-agent-*` 前缀。
- Floating root 使用 `#mia-agent-widget-root`。
- Inline root 使用 `mia-agent-widget-inline-*` 形式的动态 id。
- 样式未使用 Shadow DOM，因此仍可能被宿主页面极高优先级 CSS 影响。

当前没有引入外部 CSS、字体、图标库。

## 销毁机制

全局暴露：

```javascript
window.MiaAgentWidget.destroy();
```

当前行为：

- 移除 floating root。
- 移除 Widget 注入的 style。
- 清空 floating 模式全局 Agent 注册表。

主要用于 SPA 路由切换时重新加载不同 Agent。

注意：当前 destroy 主要面向 floating 模式。若页面同时存在 inline 实例，后续需要细化为按实例销毁，避免移除共享 style 后影响 inline 样式。

## 当前能力对齐状态

| 能力                     | 主 Chat | Widget |
| ------------------------ | ------- | ------ |
| SSE 流式输出             | 支持    | 支持   |
| 停止生成                 | 支持    | 支持   |
| 上传图片                 | 支持    | 支持   |
| 粘贴图片                 | 支持    | 支持   |
| 上传文本文件             | 支持    | 支持   |
| 图片模型校验             | 支持    | 支持   |
| 文件类型/大小/数量校验   | 支持    | 支持   |
| 流式中锁定输入和附件按钮 | 支持    | 支持   |
| 复制消息                 | 支持    | 支持   |
| 复制成功提示             | 支持    | 支持   |
| Agent 刷新按钮           | 支持    | 不支持 |
| URL 参数选择 Agent       | 支持    | 不支持 |
| 浮窗拖拽                 | 不支持  | 支持   |
| Inline 内嵌              | 不支持  | 支持   |
| 同页多 Agent 单入口      | 不支持  | 支持   |
| 全屏/退出全屏            | 不支持  | 支持   |

## 当前限制

- Widget 是原生 JS 单文件，复杂 UI 状态继续增长后维护成本会上升。
- 不使用 Shadow DOM，极端宿主样式可能污染 Widget。
- 多 Agent 消息只保存在内存中，不做持久化。
- 文件仅支持浏览器可读取的文本内容。
- 图片是否可发送依赖模型名关键字判断，不是后端能力声明。
- SSE 只展示 token 和 error，暂不展示 retrieval、tool_call、tool_result 等事件。
- 共享 Agent 接口的鉴权边界依赖 share token，后续需要补充过期、撤销、访问统计等能力。

## 后续建议

1. 后端在 Agent 或 model_config 中返回明确能力字段，例如 `supportsVision`、`supportsFiles`，替代模型名猜测。
2. Widget 引入实例级 destroy，支持销毁指定 inline/floating 实例。
3. 支持自定义主题色、位置、默认展开、欢迎语开关等配置项。
4. SSE 展示工具调用、检索来源和错误详情。
5. 增加会话 ID，让 Widget 刷新后可恢复历史。
6. 对外提供版本号，例如 `data-widget-version` 或脚本 URL 带版本，方便缓存控制。
