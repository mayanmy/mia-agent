import { Button, Tag, Popconfirm } from "antd";
import { ModelConfigListItem } from "../api";
import { modelTypeLabels } from "../utils";

const thinkingModeLabels = {
  AUTO: "思考：自动",
  ENABLED: "思考：开启",
  DISABLED: "思考：关闭"
} as const;

type ModelConfigListProps = {
  models: ModelConfigListItem[];
  onEditModel: (model: ModelConfigListItem) => void;
  onDeleteModel: (id: string) => void;
};

export function ModelConfigList({ models, onEditModel, onDeleteModel }: ModelConfigListProps) {
  return (
    <div className="providerModelChips">
      {models.length === 0 && <span className="mutedInline">暂无模型</span>}
      {models.map((model) => (
        <div className="modelChip" key={model.id}>
          <span className={model.enabled ? "modelDot enabled" : "modelDot"} />
          <span>{model.modelName}</span>
          <Tag>{modelTypeLabels[model.modelType]}</Tag>
          {model.modelType === "CHAT" && <Tag>{thinkingModeLabels[model.thinkingMode]}</Tag>}
          <Button size="small" type="text" onClick={() => onEditModel(model)}>
            配置
          </Button>
          <Popconfirm
            title="删除模型"
            description="确认删除这个模型？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void onDeleteModel(model.id)}
          >
            <Button danger size="small" type="text">
              删除
            </Button>
          </Popconfirm>
        </div>
      ))}
    </div>
  );
}
