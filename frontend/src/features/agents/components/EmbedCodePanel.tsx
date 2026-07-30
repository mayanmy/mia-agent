import { Input } from "antd";

/** 单个嵌入方案的代码展示参数。 */
type EmbedCodePanelProps = {
  /** 可复制的完整嵌入代码。 */
  code: string;
  /** 当前方案的使用说明。 */
  description: string;
};

/** 展示嵌入说明和只读代码。 */
export function EmbedCodePanel({ code, description }: EmbedCodePanelProps) {
  return (
    <>
      <p className="embedCodeHint">{description}</p>
      <Input.TextArea readOnly autoSize={{ minRows: 7, maxRows: 14 }} value={code} />
    </>
  );
}
