import { useState } from "react";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Tag } from "antd";

const operatorDescriptions = [
  ["exists", "值存在且不是 null", "不需要"],
  ["eq", "严格相等", "需要"],
  ["neq", "严格不相等", "需要"],
  ["contains", "字符串包含文本，或数组包含元素", "需要"],
  ["gt / gte", "大于 / 大于等于", "需要"],
  ["lt / lte", "小于 / 小于等于", "需要"]
] as const;

const fieldDescriptions = [
  ["handle", "分支唯一名称，同时标识条件节点右侧的连接点。"],
  ["left", "要判断的值，可填写常量或双花括号变量。"],
  ["operator", "比较方式，必须使用下方支持的操作符。"],
  ["right", "用于比较的目标值；只有 exists 可以省略。"],
  ["默认 Handle", "所有分支都未命中时使用的连接点名称。"]
] as const;

const colorRoutingExample = `[
  {
    "handle": "color",
    "left": "{{input.query}}",
    "operator": "contains",
    "right": "颜色"
  },
  {
    "handle": "outfit",
    "left": "{{input.query}}",
    "operator": "contains",
    "right": "穿什么"
  }
]`;

const temperatureExample = `[
  {
    "handle": "hot",
    "left": "{{nodes.weather.output.temperature}}",
    "operator": "gte",
    "right": 30
  },
  {
    "handle": "cold",
    "left": "{{nodes.weather.output.temperature}}",
    "operator": "lte",
    "right": 15
  }
]`;

/** 条件分支帮助正文参数。 */
type ConditionBranchGuideContentProps = {
  /** 是否使用适合嵌入其他帮助区域的紧凑布局。 */
  compact?: boolean;
};

/** 条件节点旁提供就地帮助，用户不需要离开当前配置上下文。 */
export function ConditionBranchGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        className="workflowConditionGuideButton"
        icon={<QuestionCircleOutlined />}
        size="small"
        type="link"
        onClick={() => setOpen(true)}
      >
        查看分支规则示例
      </Button>
      <Drawer
        open={open}
        title="条件分支配置规则"
        width="min(620px, 100vw)"
        onClose={() => setOpen(false)}
      >
        <ConditionBranchGuideContent />
      </Drawer>
    </>
  );
}

/** 展示 Condition 配置字段、操作符和变量引用示例。 */
export function ConditionBranchGuideContent({ compact = false }: ConditionBranchGuideContentProps) {
  return (
    <div className={`conditionBranchGuide${compact ? " compact" : ""}`}>
      <Alert
        showIcon
        message="规则从上到下判断，命中第一条后停止；全部未命中时走默认 Handle。"
        type="info"
      />

      <section>
        <h3>字段说明</h3>
        <div className="conditionBranchGuideRows">
          {fieldDescriptions.map(([name, description]) => (
            <div key={name}>
              <code>{name}</code>
              <span>{description}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>支持的操作符</h3>
        <div className="conditionOperatorHeader">
          <strong>操作符</strong>
          <strong>判断方式</strong>
          <strong>right</strong>
        </div>
        <div className="conditionOperatorRows">
          {operatorDescriptions.map(([operator, description, right]) => (
            <div key={operator}>
              <code>{operator}</code>
              <span>{description}</span>
              <Tag color={right === "需要" ? "blue" : "default"}>{right}</Tag>
            </div>
          ))}
        </div>
        <p className="conditionBranchGuideNote">
          <code>eq/neq</code> 不会自动转换类型；<code>gt/gte/lt/lte</code>
          两侧必须都是数字，或都是字符串。
        </p>
      </section>

      <section>
        <h3>示例一：按问题内容分流</h3>
        <pre>{colorRoutingExample}</pre>
        <p>
          默认 Handle 填 <code>default</code>。右侧连接点从上到下依次是
          <code>color</code>、<code>outfit</code>、<code>default</code>。 “今天穿什么颜色”会先命中
          color。
        </p>
      </section>

      {!compact ? (
        <section>
          <h3>示例二：判断上游节点数值</h3>
          <pre>{temperatureExample}</pre>
          <p>
            这里的 <code>weather</code> 必须是当前条件节点之前、且一定会执行的节点 ID。
          </p>
        </section>
      ) : null}

      <section>
        <h3>连接分支</h3>
        <ol>
          <li>保存合法 JSON 后，条件节点右侧会按规则顺序生成连接点。</li>
          <li>把每个连接点拖到该分支需要执行的下一个节点。</li>
          <li>最后连接默认 Handle，避免没有规则命中时流程中断。</li>
          <li>每个 Handle 最多连接一条出边，分支名称不能重复。</li>
        </ol>
      </section>
    </div>
  );
}
