import type { ClipboardEvent } from "react";
import { FileTextOutlined, PictureOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Input, Tooltip, Upload } from "antd";
import type { UploadProps } from "antd";

import type { ChatFileAttachment, ChatImageAttachment } from "../api";
import { supportedTextFileExtensions } from "../utils";
import { AttachmentPreviewList } from "./AttachmentPreviewList";

/** Chat 输入区参数。 */
type ChatComposerProps = {
  /** 当前文本输入。 */
  input: string;
  /** 待发送图片。 */
  images: ChatImageAttachment[];
  /** 待发送文本文件。 */
  files: ChatFileAttachment[];
  /** 当前 Agent ID；为空时禁止发送。 */
  selectedAgentId: string;
  /** 是否正在生成回答。 */
  sending: boolean;
  /** 是否因归档视图等原因整体只读。 */
  disabled?: boolean;
  /** 发送按钮是否因输入校验而禁用。 */
  sendButtonDisabled: boolean;
  /** 文本变化回调。 */
  onInputChange: (value: string) => void;
  /** 发送当前输入回调。 */
  onSend: () => void;
  /** 停止当前生成回调。 */
  onStop: () => void;
  /** 粘贴事件回调，用于提取剪贴板图片。 */
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** 图片上传前读取与校验回调。 */
  onImageBeforeUpload: UploadProps["beforeUpload"];
  /** 文本文件上传前读取与校验回调。 */
  onFileBeforeUpload: UploadProps["beforeUpload"];
  /** 移除图片回调。 */
  onRemoveImage: (id: string | undefined) => void;
  /** 移除文本文件回调。 */
  onRemoveFile: (id: string | undefined) => void;
};

/** 管理 Chat 文本输入、附件入口以及发送/停止操作。 */
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
}: ChatComposerProps) {
  const controlsDisabled = !selectedAgentId || disabled;

  return (
    <div className="chatComposer">
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
          placeholder={
            disabled ? "已归档会话仅可查看，恢复后可继续对话" : "输入消息，或直接粘贴图片"
          }
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
      <div className="chatComposerFooter">
        <div className="chatComposerToolbar">
          <Upload
            accept="image/*"
            beforeUpload={onImageBeforeUpload}
            disabled={controlsDisabled}
            maxCount={4}
            showUploadList={false}
          >
            <Tooltip title="上传图片">
              <Button
                aria-label="上传图片"
                className="chatComposerToolButton"
                disabled={controlsDisabled}
                icon={<PictureOutlined />}
                shape="circle"
                type="text"
              />
            </Tooltip>
          </Upload>
          <Upload
            accept={supportedTextFileExtensions.join(",")}
            beforeUpload={onFileBeforeUpload}
            disabled={controlsDisabled}
            maxCount={4}
            showUploadList={false}
          >
            <Tooltip title="上传文本文件">
              <Button
                aria-label="上传文本文件"
                className="chatComposerToolButton"
                disabled={controlsDisabled}
                icon={<FileTextOutlined />}
                shape="circle"
                type="text"
              />
            </Tooltip>
          </Upload>
        </div>
        <div className="chatComposerActions">
          {sending ? (
            <Tooltip title="停止全部生成">
              <Button
                aria-label="停止全部生成"
                className="chatStopButton"
                icon={<span aria-hidden="true" className="chatStopGlyph" />}
                shape="circle"
                onClick={onStop}
              />
            </Tooltip>
          ) : null}
          <Tooltip title="发送消息">
            <Button
              aria-label="发送消息"
              className="chatSendButton"
              disabled={disabled || sendButtonDisabled}
              icon={<SendOutlined />}
              shape="circle"
              type="primary"
              onClick={() => {
                onSend();
              }}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
