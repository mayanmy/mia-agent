import { Input } from "antd";

export function EmbedCodePanel({ code, description }: { code: string; description: string }) {
  return (
    <>
      <p className="embedCodeHint">{description}</p>
      <Input.TextArea readOnly autoSize={{ minRows: 7, maxRows: 14 }} value={code} />
    </>
  );
}
