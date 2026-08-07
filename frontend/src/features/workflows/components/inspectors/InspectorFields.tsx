import { PlusOutlined } from "@ant-design/icons";
import { Button, Input, type InputProps } from "antd";
import type { ReactNode } from "react";

/** 属性面板通用字段参数。 */
export type InspectorFieldProps = {
  /** 字段展示名称。 */
  label: string;
  /** 可选的字段说明，解释运行时约束。 */
  hint?: string;
  /** 字段编辑控件。 */
  children: ReactNode;
};

/** 统一属性面板字段标签、说明和控件间距。 */
export function InspectorField({ label, hint, children }: InspectorFieldProps) {
  return (
    <label className="workflowField">
      <span>{label}</span>
      {hint ? <small className="workflowFieldHint">{hint}</small> : null}
      {children}
    </label>
  );
}

/** 属性分组参数。 */
export type InspectorSectionProps = {
  /** 分组标题。 */
  title: string;
  /** 分组补充说明。 */
  description?: string;
  /** 分组右侧操作。 */
  action?: ReactNode;
  /** 分组内容。 */
  children: ReactNode;
};

/** 用分组建立配置层级，避免长表单字段平铺。 */
export function InspectorSection({ title, description, action, children }: InspectorSectionProps) {
  return (
    <section className="workflowInspectorSection">
      <header>
        <div>
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** 列表新增按钮参数。 */
export type AddRowButtonProps = {
  /** 按钮文案。 */
  children: ReactNode;
  /** 新增回调。 */
  onClick: () => void;
};

/** 结构化配置列表统一使用轻量虚线新增按钮。 */
export function AddRowButton({ children, onClick }: AddRowButtonProps) {
  return (
    <Button block icon={<PlusOutlined />} type="dashed" onClick={onClick}>
      {children}
    </Button>
  );
}

/** 可插入变量的单行输入参数。 */
export type CompactValueInputProps = InputProps & {
  /** 当前值；配置中的非字符串会在编辑器入口归一化。 */
  value: string;
};

/** 单行配置值输入；模板表达式仍以普通字符串持久化。 */
export function CompactValueInput(props: CompactValueInputProps) {
  return <Input {...props} />;
}
