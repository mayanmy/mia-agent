import { MenuGuide, type MenuGuideProps } from "./MenuGuide";

const guides = {
  providers: {
    title: "模型供应商新手指南",
    summary: "先配置并测试模型供应商，再创建 Chat 和 Embedding 模型。",
    steps: [
      { title: "添加供应商", description: "填写协议类型、Base URL 和 API Key。" },
      { title: "添加模型", description: "创建 Chat 或 Embedding 模型并填写准确模型名。" },
      { title: "测试连接", description: "确认鉴权、地址和模型权限均可用。" },
      { title: "设置默认模型", description: "分别选择平台默认 Chat 与 Embedding 模型。" }
    ],
    sections: [
      {
        key: "types",
        label: "模型类型怎么选",
        items: [
          { name: "Chat", description: "供 Agent 和 Workflow 模型节点生成回答。" },
          { name: "Embedding", description: "供知识库将文档与查询转换为向量。" }
        ]
      },
      {
        key: "errors",
        label: "常见问题",
        items: [
          { name: "401 / 403", description: "API Key 无效或没有目标模型权限。" },
          { name: "404", description: "检查 Base URL 是否多写或遗漏 /v1。" },
          { name: "模型下拉为空", description: "确认模型类型正确并且处于启用状态。" }
        ]
      }
    ],
    tip: "知识库创建后会锁定 Embedding 模型和维度；更换模型应新建知识库并重新上传。"
  },
  agents: {
    title: "Agent 新手指南",
    summary: "Agent 将模型、Prompt、知识库、工具和 Workflow 组合成可使用的助手。",
    steps: [
      { title: "新增 Agent", description: "选择 Chat 模型，填写名称、描述和 System Prompt。" },
      { title: "绑定能力", description: "按需绑定知识库、工具和已发布 Workflow。" },
      { title: "测试对话", description: "分别验证角色、知识检索和工具调用。" },
      { title: "发布", description: "生成公开链接、iframe、Widget 或服务端 API。" }
    ],
    sections: [
      {
        key: "config",
        label: "配置重点",
        items: [
          { name: "System Prompt", description: "定义身份、回答边界、格式和资料不足时的行为。" },
          { name: "Temperature", description: "制度问答建议 0.1–0.3，创意任务可适当提高。" },
          { name: "公开访问", description: "配置到期时间、来源白名单和访问密码。" }
        ]
      },
      {
        key: "publish",
        label: "发布方式",
        items: [
          { name: "iframe", description: "快速接入，无需宿主网站配置 CORS。" },
          { name: "JS Widget", description: "适合悬浮入口、SPA 和同页多 Agent。" },
          { name: "服务端 API Key", description: "只在可信业务后端保存和使用。" }
        ]
      }
    ],
    tip: "公开 Token 或 API Key 泄露后立即轮换；旧链接和旧凭据会随之失效。"
  },
  knowledge: {
    title: "知识库新手指南",
    summary: "知识库将文档解析、切分并向量化，为 Agent 和 Workflow 提供 RAG 资料。",
    steps: [
      { title: "准备 Embedding", description: "先创建并测试启用的 Embedding 模型。" },
      { title: "新建知识库", description: "选择 Embedding 模型并填写名称、描述。" },
      { title: "上传文档", description: "在文档抽屉上传结构清晰的资料。" },
      { title: "等待已索引", description: "确认状态为已索引且 Chunk 数大于 0。" },
      { title: "绑定并测试", description: "绑定 Agent 后测试原文、同义和资料外问题。" }
    ],
    sections: [
      {
        key: "status",
        label: "索引状态",
        items: [
          { name: "解析 / 切分", description: "提取文本并按段落、句子生成 Chunk。" },
          { name: "向量化", description: "调用 Embedding 模型并写入向量索引。" },
          { name: "失败", description: "查看错误信息，修复模型或文档后重建。" }
        ]
      },
      {
        key: "quality",
        label: "提升检索质量",
        items: [
          { name: "文档结构", description: "使用标题、空行和短段落，把条件与结论放在一起。" },
          { name: "扫描 PDF", description: "先完成 OCR；复杂表格优先转换为 Markdown。" }
        ]
      }
    ],
    tip: "修改文档内容、切分策略或 Embedding 配置后必须重建索引。"
  },
  tools: {
    title: "HTTP 工具新手指南",
    summary: "管理员固定接口与鉴权，模型只填写声明过的业务参数。",
    steps: [
      { title: "新增 HTTP 工具", description: "填写名称、标识、方法、Base URL 和 Path。" },
      { title: "声明参数", description: "配置 path、query、header 或 body 参数及类型。" },
      { title: "配置鉴权", description: "凭据由管理员保存，不暴露给模型。" },
      { title: "执行测试", description: "用真实参数验证响应后再绑定 Agent。" }
    ],
    sections: [
      {
        key: "params",
        label: "参数位置",
        items: [
          { name: "path", description: "替换 URL 中的 {变量}。" },
          { name: "query", description: "拼接为 URL 查询参数。" },
          { name: "header / body", description: "写入请求头或 POST 请求体。" }
        ]
      },
      {
        key: "errors",
        label: "常见问题",
        items: [
          { name: "401", description: "检查鉴权类型、Header 名称和凭据。" },
          { name: "网络被拒", description: "检查允许主机列表和私网访问策略。" },
          { name: "Agent 不调用", description: "检查工具描述、绑定状态、必填参数和模型能力。" }
        ]
      }
    ],
    tip: "工具可能执行真实写操作；优先从只读 GET 开始，高风险操作必须增加业务确认。"
  },
  mcp: {
    title: "MCP 新手指南",
    summary: "连接可信 MCP Server，同步并治理远程工具、资源和 Prompt。",
    steps: [
      { title: "新增 Server", description: "填写 Streamable HTTP Endpoint、鉴权和安全策略。" },
      { title: "测试连接", description: "确认地址、鉴权和 MCP 协议握手成功。" },
      { title: "同步目录", description: "发现工具、Resources 和 Prompts。" },
      { title: "启用并绑定", description: "只启用需要的工具，再到 Agent 中绑定。" }
    ],
    sections: [
      {
        key: "auth",
        label: "鉴权方式",
        items: [
          { name: "Bearer / API Key", description: "适合简单的服务间鉴权。" },
          { name: "Client Credentials", description: "适合机器身份获取短期 Token。" },
          { name: "OAuth + PKCE", description: "需要用户在浏览器完成授权。" }
        ]
      },
      {
        key: "errors",
        label: "常见问题",
        items: [
          { name: "工具为空", description: "测试成功后仍需同步，并确认服务实现 tools/list。" },
          { name: "OAuth 未授权", description: "完成授权流程，过期后重新授权。" },
          { name: "超时", description: "检查远端响应、并发数和响应大小上限。" }
        ]
      }
    ],
    tip: "只连接可信 MCP Server；允许私网访问会扩大 SSRF 风险面。"
  },
  skills: {
    title: "Skill 新手指南",
    summary: "Skill 保存可复用的专业指令，定义怎么做，但不会自动获得数据或工具权限。",
    steps: [
      { title: "新增 Skill", description: "填写名称、描述和稳定的核心指令。" },
      { title: "明确边界", description: "补充使用条件、输入要求、输出要求和限制。" },
      { title: "保存验证", description: "检查指令是否清晰、可复用且不包含秘密。" },
      { title: "在运行时使用", description: "按当前 Agent 或流程能力选择对应 Skill。" }
    ],
    sections: [
      {
        key: "boundary",
        label: "与其他能力的区别",
        items: [
          { name: "Skill", description: "描述稳定方法、格式和约束。" },
          { name: "知识库", description: "提供可检索的业务事实。" },
          { name: "工具", description: "提供访问外部系统的执行权限。" }
        ]
      },
      {
        key: "writing",
        label: "编写建议",
        items: [
          { name: "核心指令", description: "写清步骤、判断标准和资料不足时的处理。" },
          { name: "输出要求", description: "明确语言、结构、长度和引用规则。" }
        ]
      }
    ],
    tip: "不要在 Skill 中保存 API Key 或私人数据；它是指令资产，不是秘密存储。"
  },
  workflowApps: {
    title: "Workflow 应用新手指南",
    summary: "直接运行管理员已发布的确定性流程；这里不会修改 Workflow 草稿。",
    steps: [
      { title: "选择应用", description: "找到目标 Workflow，并确认当前发布版本。" },
      { title: "填写输入", description: "按开始节点定义的字段和类型填写参数。" },
      { title: "运行", description: "提交后等待流程按固定节点顺序执行。" },
      { title: "查看结果", description: "检查 Chat Answer、结构化输出或错误信息。" }
    ],
    sections: [
      {
        key: "concepts",
        label: "页面概念",
        items: [
          { name: "vN", description: "当前运行的不可变发布版本。" },
          { name: "输入数量", description: "由 Workflow 开始节点定义。" },
          { name: "运行结果", description: "由结束节点定义回答和结构化输出。" }
        ]
      },
      {
        key: "errors",
        label: "常见问题",
        items: [
          { name: "没有应用", description: "管理员需要先校验并发布 Workflow。" },
          { name: "仍是旧逻辑", description: "草稿修改后需要重新发布新版本。" },
          { name: "运行失败", description: "请管理员从运行记录或 Trace 定位失败节点。" }
        ]
      }
    ],
    tip: "稳定执行固定步骤用 Workflow 应用；需要自由对话和动态选能力时使用 Agent。"
  }
} satisfies Record<string, MenuGuideProps>;

export function ProvidersGuide() {
  return <MenuGuide {...guides.providers} />;
}
export function AgentsGuide() {
  return <MenuGuide {...guides.agents} />;
}
export function KnowledgeGuide() {
  return <MenuGuide {...guides.knowledge} />;
}
export function ToolsGuide() {
  return <MenuGuide {...guides.tools} />;
}
export function McpGuide() {
  return <MenuGuide {...guides.mcp} />;
}
export function SkillsGuide() {
  return <MenuGuide {...guides.skills} />;
}
export function WorkflowAppsGuide() {
  return <MenuGuide {...guides.workflowApps} />;
}
