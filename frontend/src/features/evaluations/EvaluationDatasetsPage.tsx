import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import {
  createEvaluationDataset,
  listEvaluationDatasets,
  type EvaluationDataset,
  type EvaluationDatasetStatus
} from "./api";
import "./evaluations.less";

export function EvaluationDatasetsPage() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<{ name: string; description?: string }>();
  const [rows, setRows] = useState<EvaluationDataset[]>([]);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<EvaluationDatasetStatus | undefined>("ACTIVE");
  const [paging, setPaging] = useState({ page: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    void refresh(1);
  }, [status]);

  async function refresh(page = paging.page, pageSize = paging.pageSize) {
    setLoading(true);
    try {
      const result = await listEvaluationDatasets({ page, pageSize, keyword, status });
      setRows(result.list);
      setPaging({ page: result.page, pageSize: result.pageSize, total: result.total });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载评估数据集失败");
    } finally {
      setLoading(false);
    }
  }

  async function submitCreate() {
    const values = await form.validateFields();
    setCreating(true);
    try {
      const dataset = await createEvaluationDataset(values);
      message.success("数据集已创建");
      setModalOpen(false);
      form.resetFields();
      navigate(`/operations/evaluation-datasets/${dataset.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建数据集失败");
    } finally {
      setCreating(false);
    }
  }

  const columns: TableProps<EvaluationDataset>["columns"] = [
    { title: "名称", dataIndex: "name", width: 220 },
    { title: "描述", dataIndex: "description", ellipsis: true },
    {
      title: "当前版本",
      width: 130,
      render: (_, row) =>
        row.latestVersion ? (
          <Space size={6}>
            <span>v{row.latestVersion.version}</span>
            <Tag color={row.latestVersion.status === "FROZEN" ? "blue" : "gold"}>
              {row.latestVersion.status === "FROZEN" ? "已冻结" : "草稿"}
            </Tag>
          </Space>
        ) : (
          "—"
        )
    },
    { title: "用例数", width: 90, render: (_, row) => row.latestVersion?.caseCount ?? 0 },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString()
    },
    {
      title: "操作",
      width: 90,
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={() => navigate(`/operations/evaluation-datasets/${row.id}`)}
        >
          查看
        </Button>
      )
    }
  ];

  return (
    <section className="workspace evaluationWorkspace">
      <WorkspacePageHeader
        title="评估数据集"
        description="管理可复现、可冻结的 RAG Golden Set。"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            新建数据集
          </Button>
        }
      />
      <section className="panel evaluationFilters">
        <Input
          allowClear
          placeholder="搜索名称或描述"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onPressEnter={() => void refresh(1)}
        />
        <Select
          allowClear
          placeholder="状态"
          value={status}
          options={[
            { label: "启用", value: "ACTIVE" },
            { label: "已归档", value: "ARCHIVED" }
          ]}
          onChange={setStatus}
        />
        <Button loading={loading} onClick={() => void refresh(1)}>
          查询
        </Button>
      </section>
      <section className="panel evaluationTablePanel">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{
            current: paging.page,
            pageSize: paging.pageSize,
            total: paging.total,
            showSizeChanger: true,
            onChange: (page, pageSize) => void refresh(page, pageSize)
          }}
        />
      </section>
      <Modal
        title="新建评估数据集"
        open={modalOpen}
        confirmLoading={creating}
        okText="创建"
        onCancel={() => setModalOpen(false)}
        onOk={() => void submitCreate()}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入数据集名称" }, { max: 100 }]}
          >
            <Input autoFocus placeholder="例如：差旅制度 Golden Set" />
          </Form.Item>
          <Form.Item name="description" label="描述" rules={[{ max: 1000 }]}>
            <Input.TextArea rows={4} showCount maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
