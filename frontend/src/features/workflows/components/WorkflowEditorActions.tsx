import {
  CheckOutlined,
  CloudUploadOutlined,
  HistoryOutlined,
  RedoOutlined,
  SaveOutlined,
  UndoOutlined
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";

/** Workflow 编辑器顶部工具栏参数。 */
export type WorkflowEditorActionsProps = {
  /** 当前是否存在可撤销的 Graph 快照。 */
  canUndo: boolean;
  /** 当前是否存在可重做的 Graph 快照。 */
  canRedo: boolean;
  /** 草稿是否正在保存或发布，期间阻止重复提交。 */
  saving: boolean;
  /** 草稿是否需要显式保存。 */
  saveNeeded: boolean;
  /** 保存按钮是否展示失败重试语义。 */
  saveFailed: boolean;
  /** 是否发生草稿版本冲突；冲突时禁止继续覆盖服务端草稿。 */
  conflicted: boolean;
  /** 撤销最近一次 Graph 修改。 */
  onUndo: () => void;
  /** 重做最近一次撤销的 Graph 修改。 */
  onRedo: () => void;
  /** 打开 Workflow 运行记录。 */
  onOpenTrace: () => void;
  /** 使用当前 Graph 执行发布前校验。 */
  onValidate: () => void;
  /** 显式保存当前草稿。 */
  onSave: () => void;
  /** 保存、校验并发布不可变版本。 */
  onPublish: () => void;
  /** 冲突后放弃本地版本并重新加载服务端草稿。 */
  onReloadConflict: () => void;
  /** 冲突后复制本地 Graph，避免用户修改丢失。 */
  onCopyConflictGraph: () => void;
};

/**
 * 工具栏按使用频率与风险分组：编辑历史是轻操作，运行检查是中间步骤，保存发布是结果操作。
 * 冲突恢复独立展示，避免与正常发布动作混在一起造成误覆盖。
 */
export function WorkflowEditorActions({
  canUndo,
  canRedo,
  saving,
  saveNeeded,
  saveFailed,
  conflicted,
  onUndo,
  onRedo,
  onOpenTrace,
  onValidate,
  onSave,
  onPublish,
  onReloadConflict,
  onCopyConflictGraph
}: WorkflowEditorActionsProps) {
  return (
    <div className="workflowEditorActions">
      {conflicted ? (
        <div className="workflowToolbarGroup workflowConflictActions">
          <span>草稿已在其他位置更新</span>
          <Button size="small" onClick={onCopyConflictGraph}>
            复制本地 Graph
          </Button>
          <Button size="small" type="primary" onClick={onReloadConflict}>
            重新加载
          </Button>
        </div>
      ) : null}

      <div className="workflowToolbarGroup workflowHistoryActions">
        <Tooltip title="撤销（Cmd/Ctrl+Z）">
          <Button
            aria-label="撤销"
            disabled={!canUndo}
            icon={<UndoOutlined />}
            type="text"
            onClick={onUndo}
          />
        </Tooltip>
        <Tooltip title="重做（Cmd/Ctrl+Shift+Z）">
          <Button
            aria-label="重做"
            disabled={!canRedo}
            icon={<RedoOutlined />}
            type="text"
            onClick={onRedo}
          />
        </Tooltip>
      </div>

      <div className="workflowToolbarDivider" />

      <div className="workflowToolbarGroup">
        <Button icon={<HistoryOutlined />} onClick={onOpenTrace}>
          运行记录
        </Button>
        <Button icon={<CheckOutlined />} loading={saving} onClick={onValidate}>
          校验
        </Button>
      </div>

      <div className="workflowToolbarDivider" />

      <div className="workflowToolbarGroup workflowDeliveryActions">
        <Button
          disabled={!saveNeeded || conflicted}
          icon={<SaveOutlined />}
          loading={saving}
          onClick={onSave}
        >
          {saveFailed ? "重试保存" : "保存"}
        </Button>
        <Button
          disabled={conflicted}
          icon={<CloudUploadOutlined />}
          loading={saving}
          type="primary"
          onClick={onPublish}
        >
          发布
        </Button>
      </div>
    </div>
  );
}
