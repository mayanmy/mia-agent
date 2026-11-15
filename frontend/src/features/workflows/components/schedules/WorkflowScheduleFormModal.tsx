import { useEffect, useRef, useState } from "react";
import { Alert, Form, Input, InputNumber, Modal, Select } from "antd";

import type { WorkflowSchedulePayload } from "../../api";
import type {
  WorkflowScheduleDetail,
  WorkflowSchedulePreview,
  WorkflowVersionListItem
} from "../../types";
import { WorkflowSchedulePreview as SchedulePreview } from "./WorkflowSchedulePreview";

type FormValues = Omit<WorkflowSchedulePayload, "inputs"> & { inputsJson: string };

type Props = {
  open: boolean;
  saving: boolean;
  schedule: WorkflowScheduleDetail | null;
  versions: WorkflowVersionListItem[];
  onCancel: () => void;
  onPreview: (cronExpression: string, timezone: string) => Promise<WorkflowSchedulePreview>;
  onSubmit: (payload: WorkflowSchedulePayload) => Promise<void>;
};

const defaults: FormValues = {
  name: "",
  description: "",
  workflowVersionId: "",
  cronExpression: "0 9 * * 1-5",
  timezone: "Asia/Shanghai",
  inputsJson: "{}",
  misfirePolicy: "RUN_ONCE",
  concurrencyPolicy: "QUEUE",
  maxCatchUpRuns: 1,
  timeoutSeconds: 1800
};

export function WorkflowScheduleFormModal({
  open,
  saving,
  schedule,
  versions,
  onCancel,
  onPreview,
  onSubmit
}: Props) {
  const [form] = Form.useForm<FormValues>();
  const [preview, setPreview] = useState<WorkflowSchedulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewSequence = useRef(0);
  const previewTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(
      schedule
        ? {
            name: schedule.name,
            description: schedule.description,
            workflowVersionId: schedule.workflowVersionId,
            cronExpression: schedule.cronExpression,
            timezone: schedule.timezone,
            inputsJson: JSON.stringify(schedule.inputs, null, 2),
            misfirePolicy: schedule.misfirePolicy,
            concurrencyPolicy: schedule.concurrencyPolicy,
            maxCatchUpRuns: schedule.maxCatchUpRuns,
            timeoutSeconds: schedule.timeoutSeconds
          }
        : { ...defaults, workflowVersionId: versions[0]?.id ?? "" }
    );
    schedulePreview(form.getFieldValue("cronExpression"), form.getFieldValue("timezone"));
    return () => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    };
  }, [form, open, schedule, versions]);

  function schedulePreview(cronExpression?: string, timezone?: string) {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    const sequence = ++previewSequence.current;
    if (!cronExpression?.trim() || !timezone?.trim()) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    previewTimer.current = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const result = await onPreview(cronExpression, timezone);
        if (sequence !== previewSequence.current) return;
        setPreview(result);
        setPreviewError(null);
      } catch (error) {
        if (sequence !== previewSequence.current) return;
        setPreview(null);
        setPreviewError(error instanceof Error ? error.message : "Cron 配置无效");
      } finally {
        if (sequence === previewSequence.current) setPreviewing(false);
      }
    }, 350);
  }

  async function submit() {
    const values = await form.validateFields();
    await onSubmit({
      ...values,
      inputs: JSON.parse(values.inputsJson) as Record<string, unknown>
    });
  }

  return (
    <Modal
      destroyOnHidden
      confirmLoading={saving}
      okText={schedule ? "保存配置" : "创建定时任务"}
      open={open}
      title={schedule ? "编辑定时任务" : "新建定时任务"}
      width={760}
      onCancel={onCancel}
      onOk={() => void submit()}
    >
      <Alert
        showIcon
        type="warning"
        message="当前环境尚未启用调度执行"
        description="P1 仅保存和预览配置。新任务默认暂停；启用后也不会创建运行记录或队列任务。"
      />
      <Form
        className="workflowScheduleForm"
        form={form}
        layout="vertical"
        onValuesChange={(changed, values) => {
          if ("cronExpression" in changed || "timezone" in changed) {
            schedulePreview(values.cronExpression, values.timezone);
          }
        }}
      >
        <div className="workflowScheduleFormGrid">
          <Form.Item
            label="任务名称"
            name="name"
            rules={[{ required: true, message: "请输入任务名称" }, { max: 100 }]}
          >
            <Input autoFocus placeholder="例如：工作日报汇总" />
          </Form.Item>
          <Form.Item
            label="固定版本"
            name="workflowVersionId"
            rules={[{ required: true, message: "请选择版本" }]}
          >
            <Select
              options={versions.map((version) => ({
                value: version.id,
                label: `v${version.version}`
              }))}
              placeholder="选择已发布版本"
            />
          </Form.Item>
        </div>
        <Form.Item label="说明" name="description" rules={[{ max: 2000 }]}>
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="说明任务用途和预期结果"
          />
        </Form.Item>
        <div className="workflowScheduleFormGrid">
          <Form.Item
            extra="使用 5 段 Cron：分钟 小时 日 月 星期"
            label="Cron 表达式"
            name="cronExpression"
            rules={[{ required: true, message: "请输入 Cron 表达式" }]}
          >
            <Input placeholder="0 9 * * 1-5" />
          </Form.Item>
          <Form.Item
            label="IANA 时区"
            name="timezone"
            rules={[{ required: true, message: "请输入时区" }]}
          >
            <Input placeholder="Asia/Shanghai" />
          </Form.Item>
        </div>
        <SchedulePreview error={previewError} loading={previewing} preview={preview} />
        <Form.Item
          extra="字段必须与该版本 Start 节点的输入定义一致。"
          label="运行输入（JSON 对象）"
          name="inputsJson"
          rules={[
            { required: true, message: "请输入 JSON 对象" },
            {
              validator: async (_, value: string) => {
                try {
                  const parsed = JSON.parse(value) as unknown;
                  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                    throw new Error();
                } catch {
                  throw new Error("请输入有效的 JSON 对象");
                }
              }
            }
          ]}
        >
          <Input.TextArea className="workflowScheduleJsonInput" rows={6} spellCheck={false} />
        </Form.Item>
        <div className="workflowSchedulePolicyGrid">
          <Form.Item label="漏跑策略" name="misfirePolicy">
            <Select
              options={[
                { value: "SKIP", label: "跳过" },
                { value: "RUN_ONCE", label: "补跑最近一次" },
                { value: "CATCH_UP", label: "限量补跑" }
              ]}
            />
          </Form.Item>
          <Form.Item label="并发策略" name="concurrencyPolicy">
            <Select
              options={[
                { value: "QUEUE", label: "排队" },
                { value: "SKIP", label: "跳过重叠" },
                { value: "ALLOW", label: "允许并行" }
              ]}
            />
          </Form.Item>
          <Form.Item label="最多补跑次数" name="maxCatchUpRuns">
            <InputNumber min={1} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="超时（秒）" name="timeoutSeconds">
            <InputNumber min={60} max={86400} style={{ width: "100%" }} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
