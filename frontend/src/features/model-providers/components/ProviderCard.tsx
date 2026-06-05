import { Button, Card, Popconfirm, Space, Tag } from "antd";
import { ModelConfigListItem, ProviderListItem } from "../api";
import { getProviderAccent, getProviderLogo, providerTypeLabels } from "../utils";
import { ModelConfigList } from "./ModelConfigList";

type ProviderCardProps = {
  provider: ProviderListItem;
  modelConfigs: ModelConfigListItem[];
  expandedProviderIds: Set<string>;
  onEditProvider: (provider: ProviderListItem) => void;
  onTestProvider: (providerId: string) => Promise<void>;
  onCreateModel: (providerId: string) => void;
  onDeleteProvider: (providerId: string) => void;
  toggleProviderModels: (providerId: string) => void;
  onEditModel: (config: ModelConfigListItem) => void;
  onDeleteModel: (modelId: string) => Promise<void>;
};

export function ProviderCard({
  provider,
  modelConfigs,
  expandedProviderIds,
  onEditProvider,
  onTestProvider,
  onCreateModel,
  onDeleteProvider,
  toggleProviderModels,
  onEditModel,
  onDeleteModel
}: ProviderCardProps) {
  const models = modelConfigs.filter((model) => model.providerId === provider.id);
  const modelVisible = expandedProviderIds.has(provider.id);

  return (
    <Card className="providerInstalledCard" key={provider.id}>
      <div className="providerCardMain">
        <div className="providerLogo" style={{ backgroundColor: getProviderAccent(provider) }}>
          {getProviderLogo(provider)}
        </div>
        <div className="providerCardBody">
          <div className="providerTitleRow">
            <strong>{provider.name}</strong>
            <Tag>{providerTypeLabels[provider.providerType]}</Tag>
            <span className="providerStatus">{provider.enabled ? "已启用" : "已停用"}</span>
          </div>
          <div className="providerCapabilityRow">
            <Tag>LLM</Tag>
            <Tag>TEXT EMBEDDING</Tag>
            <Tag>RERANK</Tag>
          </div>
        </div>
        <Space className="providerActions" wrap>
          <Button size="small" onClick={() => onEditProvider(provider)}>
            管理凭据
          </Button>
          <Button size="small" onClick={() => void onTestProvider(provider.id)}>
            测试
          </Button>
          <Button size="small" type="primary" onClick={() => onCreateModel(provider.id)}>
            添加模型
          </Button>
          <Popconfirm
            title="删除供应商"
            description="确认删除这个供应商？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void onDeleteProvider(provider.id)}
          >
            <Button danger size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      </div>

      <div className="providerModelsRow">
        <Button
          className="showModelsText"
          size="small"
          type="text"
          onClick={() => toggleProviderModels(provider.id)}
        >
          {modelVisible ? "隐藏模型" : "显示模型"}
        </Button>
        {modelVisible && (
          <ModelConfigList
            models={models}
            onEditModel={onEditModel}
            onDeleteModel={onDeleteModel}
          />
        )}
      </div>
    </Card>
  );
}
