import { useState } from "react";
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  SaveOutlined
} from "@ant-design/icons";
import { Alert, Button, Collapse, Drawer, Steps, Tag } from "antd";

const nodeDescriptions = [
  ["开始", "定义 Workflow 输入，每个流程只能有一个。"],
  ["模型", "调用 Chat 模型生成文本或 JSON。"],
  ["知识检索", "从一个或多个知识库检索上下文。"],
  ["工具", "调用内置工具或管理员配置的 HTTP Tool。"],
  ["条件", "按规则选择一个分支继续执行。"],
  ["模板", "将输入和上游节点输出组合成新文本。"],
  ["结束", "定义最终回答和结构化输出，流程至少需要一个。"]
] as const;

const canvasActions = [
  ["添加节点", "点击左侧节点库中的节点按钮。"],
  ["移动节点", "按住节点卡片并拖到目标位置。"],
  ["连接节点", "从节点右侧圆点拖到下一个节点左侧圆点。"],
  ["编辑节点", "点击节点，在右侧属性面板填写配置。"],
  ["删除节点", "选中节点后点击属性面板右上角的删除按钮。"],
  ["删除连线", "点击连线使其变蓝，再按 Delete 或 Backspace。"],
  ["缩放画布", "使用鼠标滚轮或画布左下角的缩放控件。"]
] as const;

export function WorkflowGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button icon={<QuestionCircleOutlined />} onClick={() => setOpen(true)}>
        画布指南
      </Button>
      <Drawer
        open={open}
        placement="right"
        title="Workflow 画布新手指南"
        width="min(560px, 100vw)"
        onClose={() => setOpen(false)}
      >
        <div className="workflowGuide">
          <Alert showIcon message="先搭建从“开始”到“结束”的完整路径，再校验和发布。" type="info" />

          <section>
            <h3>五步完成第一个 Workflow</h3>
            <Steps
              direction="vertical"
              size="small"
              items={[
                {
                  icon: <PlayCircleOutlined />,
                  title: "创建流程",
                  description: "点击“新建 Workflow”，系统会生成开始 → 结束的最小流程。"
                },
                {
                  icon: <ApartmentOutlined />,
                  title: "添加并连接节点",
                  description: "从节点库添加能力节点，拖动圆形连接点形成执行路径。"
                },
                {
                  icon: <SaveOutlined />,
                  title: "配置并保存",
                  description: "选中节点填写右侧属性，点击“保存”持久化当前草稿。"
                },
                {
                  icon: <CheckCircleOutlined />,
                  title: "校验流程",
                  description: "点击“校验”，问题列表可直接定位到配置错误的节点。"
                },
                {
                  icon: <LinkOutlined />,
                  title: "发布并绑定 Agent",
                  description: "发布不可变版本，再到 Agent 配置中绑定该 Workflow 版本。"
                }
              ]}
            />
          </section>

          <Collapse
            bordered={false}
            defaultActiveKey={["canvas"]}
            items={[
              {
                key: "canvas",
                label: "画布基本操作",
                children: (
                  <div className="workflowGuideRows">
                    {canvasActions.map(([name, description]) => (
                      <div key={name}>
                        <strong>{name}</strong>
                        <span>{description}</span>
                      </div>
                    ))}
                  </div>
                )
              },
              {
                key: "nodes",
                label: "节点分别做什么",
                children: (
                  <div className="workflowGuideRows">
                    {nodeDescriptions.map(([name, description]) => (
                      <div key={name}>
                        <Tag>{name}</Tag>
                        <span>{description}</span>
                      </div>
                    ))}
                  </div>
                )
              },
              {
                key: "variables",
                label: "怎样引用输入和上游结果",
                children: (
                  <div className="workflowGuideVariables">
                    <p>配置字段支持双花括号变量，只能引用输入、运行信息或已经执行的上游节点。</p>
                    <code>{"{{input.query}}"}</code>
                    <span>读取开始节点的 query 输入</span>
                    <code>{"{{nodes.search.output.chunks}}"}</code>
                    <span>读取 ID 为 search 的检索节点输出</span>
                    <code>{"问题：{{input.query}}\n资料：{{nodes.search.output.chunks}}"}</code>
                    <span>在 Prompt 或模板中混合固定文本和变量</span>
                  </div>
                )
              },
              {
                key: "publish",
                label: "保存、校验和发布的区别",
                children: (
                  <div className="workflowGuideRows">
                    <div>
                      <strong>保存</strong>
                      <span>更新可继续编辑的草稿，不影响 Agent 当前使用的版本。</span>
                    </div>
                    <div>
                      <strong>校验</strong>
                      <span>检查路径、节点配置、变量引用以及资源是否可用。</span>
                    </div>
                    <div>
                      <strong>发布</strong>
                      <span>从当前草稿创建不可修改的版本，供 Agent 稳定运行。</span>
                    </div>
                    <div>
                      <strong>Trace</strong>
                      <span>选择历史运行后，在画布查看每个节点的完成、失败或跳过状态。</span>
                    </div>
                  </div>
                )
              },
              {
                key: "errors",
                label: "常见校验问题",
                children: (
                  <ul className="workflowGuideErrors">
                    <li>节点必须能从开始节点到达，并且最终存在通往结束节点的路径。</li>
                    <li>连线不能形成环；普通节点最多有一条出边。</li>
                    <li>条件节点的每个分支 Handle 只能连接一次。</li>
                    <li>模型、知识库和工具必须存在且处于启用状态。</li>
                    <li>节点只能引用输入、运行信息和已经执行的上游节点。</li>
                  </ul>
                )
              }
            ]}
          />

          <Alert
            icon={<DeleteOutlined />}
            message="连线删不掉？先点击连线，确认它变为蓝色，再按 Delete 或 Backspace。"
            type="warning"
            showIcon
          />
        </div>
      </Drawer>
    </>
  );
}
