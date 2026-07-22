import type { ClipboardEvent } from "react";
import { Button, Input, Upload } from "antd";
import type { UploadProps } from "antd";

import type { ChatFileAttachment, ChatImageAttachment } from "../api";
import { supportedTextFileExtensions } from "../utils";
import { AttachmentPreviewList } from "./AttachmentPreviewList";

export function ChatComposer({
  input,
  images,
  files,
  selectedAgentId,
  sending,
  disabled,
  sendButtonDisabled,
  onInputChange,
  onSend,
  onStop,
  onPaste,
  onImageBeforeUpload,
  onFileBeforeUpload,
  onRemoveImage,
  onRemoveFile
}: {
  input: string;
  images: ChatImageAttachment[];
  files: ChatFileAttachment[];
  selectedAgentId: string;
  sending: boolean;
  /** 归档视图只读，仍复用同一个 Composer 但禁止输入和上传。 */
  disabled?: boolean;
  sendButtonDisabled: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onImageBeforeUpload: UploadProps["beforeUpload"];
  onFileBeforeUpload: UploadProps["beforeUpload"];
  onRemoveImage: (id: string | undefined) => void;
  onRemoveFile: (id: string | undefined) => void;
}) {
  const controlsDisabled = !selectedAgentId || sending || disabled;

  return (
    <div className="chatComposer">
      <div className="chatComposerToolbar">
        <Upload
          accept="image/*"
          beforeUpload={onImageBeforeUpload}
          disabled={controlsDisabled}
          maxCount={4}
          showUploadList={false}
        >
          <Button className="chatComposerToolButton" disabled={controlsDisabled}>
            上传图片
          </Button>
        </Upload>
        <Upload
          accept={supportedTextFileExtensions.join(",")}
          beforeUpload={onFileBeforeUpload}
          disabled={controlsDisabled}
          maxCount={4}
          showUploadList={false}
        >
          <Button className="chatComposerToolButton" disabled={controlsDisabled}>
            上传文件
          </Button>
        </Upload>
      </div>
      <div className="chatComposerInput">
        <AttachmentPreviewList
          files={files}
          images={images}
          onRemoveFile={onRemoveFile}
          onRemoveImage={onRemoveImage}
        />
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={controlsDisabled}
          placeholder={disabled ? "已归档会话仅可查看，恢复后可继续对话" : "输入消息，或直接粘贴图片"}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onPaste={onPaste}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
      </div>
      <Button
        disabled={disabled || sendButtonDisabled}
        danger={sending}
        type="primary"
        onClick={() => {
          if (sending) {
            onStop();
            return;
          }

          onSend();
        }}
      >
        {sending ? "停止" : "发送"}
      </Button>
    </div>
  );
}
