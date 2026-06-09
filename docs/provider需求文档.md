模型供应商模块现在已经有了“能配置、能加模型、能测试连通”的基础闭环，但离一个好用稳定的 Provider 模块还差这些内容：
必须补
真实模型调用网关：现在主要是配置管理和连通性测试，还没有统一 chat completion / embedding 调用入口。后续 Chat、Agent 真正对话时必须走这里。
API Key 安全展示规则：现在能保存加密密钥，但前端还没有“已配置 / 未配置”的明确状态，也不能安全地保留旧密钥只更新其他字段。
不同供应商测试逻辑细化：Ollama 已特殊处理，OpenAI 兼容目前只测 /models；Anthropic、Gemini 后续需要按各自真实接口和鉴权方式测试。
模型类型能力校验：现在可选 LLM / Embedding，Rerank 只是展示，尚未真正支持；也没有校验某个模型是否真的支持对应能力。
默认模型设置：页面有按钮，但功能未实现。需要支持默认 Chat 模型、默认 Embedding 模型，供 Agent / Knowledge 默认使用。

应该做
模型列表同步：比如 Ollama 可从 /api/tags 拉本地模型，OpenAI 兼容可从 /models 拉远程模型，减少手填错误。
Provider 健康状态：不仅点按钮测试，还应记录最近一次测试状态、耗时、错误信息、测试时间。
Provider 级超时 / 并发 / 重试配置：你之前规划过外部 LLM 慢且不稳定，这些配置目前还没落到 UI 和表结构里。
模型参数完善：现在只有上下文长度、timeout、maxTokens 等基础项，后续可能要区分 context_length、max_output_tokens、是否支持 stream、tool calling、vision 等能力。
删除关联检查更完整：Provider 有模型时不能删；模型被 Agent 使用时也应该禁止删除或给出明确提示。

可以后置
供应商 Logo / 图标精细化：现在是文字 logo，占位可用，但不是真实品牌图标。
Marketplace 安装体验：目前是静态模板，不是真正市场；一期内部使用足够。
多 Key / 多凭据管理：现在一个 Provider 一组凭据，后续如果要按团队/用户/环境隔离 Key，再拆成独立凭据表。
成本与用量统计：需要 LLM 调用日志完成后再做。
模型自动降级 / fallback：要等真实调用网关、错误分类、熔断做好后再做。
一句话：下一步最关键的是把模型供应商从“配置页面”升级成“统一模型调用网关”，否则 Agent 对话还不能真正稳定地复用这些配置。
No newline at end of file
