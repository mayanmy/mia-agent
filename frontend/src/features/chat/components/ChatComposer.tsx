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
  const disabled = !selectedAgentId || sending;

  return (
    <div className="chatComposer">
      <div className="chatComposerToolbar">
        <Upload
          accept="image/*"
          beforeUpload={onImageBeforeUpload}
          disabled={disabled}
          maxCount={4}
          showUploadList={false}
        >
          <Button className="chatComposerToolButton" disabled={disabled}>
            上传图片
          </Button>
        </Upload>
        <Upload
          accept={supportedTextFileExtensions.join(",")}
          beforeUpload={onFileBeforeUpload}
          disabled={disabled}
          maxCount={4}
          showUploadList={false}
        >
          <Button className="chatComposerToolButton" disabled={disabled}>
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
          disabled={disabled}
          placeholder="输入消息，或直接粘贴图片"
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
        disabled={sendButtonDisabled}
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
