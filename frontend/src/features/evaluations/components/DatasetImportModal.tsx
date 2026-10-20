import { useState } from "react";
import { InboxOutlined } from "@ant-design/icons";
import { Alert, App as AntdApp, Checkbox, Modal, Statistic, Table, Upload } from "antd";
import type { UploadFile } from "antd";

import {
  commitEvaluationImport,
  previewEvaluationImport,
  type EvaluationImportPreview
} from "../api";

type Props = {
  open: boolean;
  versionId: string;
  onClose: () => void;
  onImported: () => void | Promise<void>;
};

export function DatasetImportModal({ open, versionId, onClose, onImported }: Props) {
  const { message } = AntdApp.useApp();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [preview, setPreview] = useState<EvaluationImportPreview | null>(null);
  const [onlyValidRows, setOnlyValidRows] = useState(false);
  const [loading, setLoading] = useState(false);

  function resetAndClose() {
    setFileList([]);
    setPreview(null);
    setOnlyValidRows(false);
    onClose();
  }

  async function handlePrimaryAction() {
    if (!preview) {
      const file = fileList[0]?.originFileObj;
      if (!file) return void message.warning("请选择 CSV 或 JSONL 文件");
      setLoading(true);
      try {
        setPreview(await previewEvaluationImport(versionId, file));
      } catch (error) {
        message.error(error instanceof Error ? error.message : "解析导入文件失败");
      } finally {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const result = await commitEvaluationImport(versionId, preview.importToken, onlyValidRows);
      message.success(`已导入 ${result.importedCount} 条用例`);
      await onImported();
      resetAndClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入用例失败");
    } finally {
      setLoading(false);
    }
  }

  const hasProblems = Boolean(preview && (preview.errorCount > 0 || preview.duplicateCount > 0));
  return (
    <Modal
      width={820}
      title="导入评估用例"
      open={open}
      confirmLoading={loading}
      okText={preview ? "确认导入" : "解析并预览"}
      okButtonProps={{
        disabled: Boolean(preview && (preview.validCount === 0 || (hasProblems && !onlyValidRows)))
      }}
      onCancel={resetAndClose}
      onOk={() => void handlePrimaryAction()}
    >
      {!preview ? (
        <>
          <Upload.Dragger
            accept=".csv,.jsonl,text/csv,application/json"
            beforeUpload={() => false}
            fileList={fileList}
            maxCount={1}
            onChange={({ fileList: next }) => setFileList(next.slice(-1))}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">选择或拖入 UTF-8 CSV / JSONL 文件</p>
            <p className="ant-upload-hint">
              最多 5 MB、5000 行。CSV 数组字段支持 JSON 数组或竖线分隔。
            </p>
          </Upload.Dragger>
          <Alert
            showIcon
            className="evaluationImportHint"
            type="info"
            message="必填列：question"
            description="可选列：expected_answer、expected_document_ids、expected_chunk_ids、answerable、category、difficulty。"
          />
        </>
      ) : (
        <div className="evaluationImportPreview">
          <div className="evaluationImportStats">
            <Statistic title="总行数" value={preview.totalRows} />
            <Statistic
              title="可导入"
              value={preview.validCount}
              valueStyle={{ color: "#15803d" }}
            />
            <Statistic
              title="错误"
              value={preview.errorCount}
              valueStyle={{ color: preview.errorCount ? "#b91c1c" : undefined }}
            />
            <Statistic title="重复" value={preview.duplicateCount} />
          </div>
          {hasProblems ? (
            <Alert
              showIcon
              type="warning"
              message="文件包含错误或重复行"
              description={
                <Checkbox
                  checked={onlyValidRows}
                  onChange={(event) => setOnlyValidRows(event.target.checked)}
                >
                  跳过这些行，仅导入合法用例
                </Checkbox>
              }
            />
          ) : null}
          <h3>合法用例预览（最多 20 条）</h3>
          <Table
            size="small"
            rowKey="line"
            pagination={false}
            dataSource={preview.preview}
            columns={[
              { title: "行", dataIndex: "line", width: 64 },
              { title: "问题", dataIndex: "question", ellipsis: true },
              { title: "分类", dataIndex: "category", width: 120, render: (value) => value || "—" },
              {
                title: "可回答",
                dataIndex: "answerable",
                width: 90,
                render: (value) => (value ? "是" : "否")
              }
            ]}
          />
          {preview.errors.length ? (
            <>
              <h3>问题行</h3>
              <Table
                size="small"
                rowKey={(row) => `${row.line}-${row.message}`}
                pagination={{ pageSize: 5, size: "small" }}
                dataSource={preview.errors}
                columns={[
                  { title: "行", dataIndex: "line", width: 64 },
                  { title: "问题", dataIndex: "message" }
                ]}
              />
            </>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
