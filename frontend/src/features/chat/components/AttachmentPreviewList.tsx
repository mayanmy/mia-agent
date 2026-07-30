import { CloseOutlined } from "@ant-design/icons";

import type { ChatFileAttachment, ChatImageAttachment } from "../api";

/** 附件预览列表参数。 */
type AttachmentPreviewListProps = {
  /** 待发送图片。 */
  images: ChatImageAttachment[];
  /** 待发送文本文件。 */
  files: ChatFileAttachment[];
  /** 移除图片回调。 */
  onRemoveImage: (id: string | undefined) => void;
  /** 移除文本文件回调。 */
  onRemoveFile: (id: string | undefined) => void;
};

/** 展示本轮尚未发送的附件并提供移除入口。 */
export function AttachmentPreviewList({
  images,
  files,
  onRemoveImage,
  onRemoveFile
}: AttachmentPreviewListProps) {
  return (
    <>
      {images.length > 0 ? (
        <div className="chatUploadPreviewList">
          {images.map((image, index) => (
            <div className="chatUploadPreview" key={image.id ?? `${image.dataUrl}-${index}`}>
              <img alt={image.name} src={image.dataUrl} />
              <button
                aria-label="移除图片"
                className="attachmentRemoveButton"
                type="button"
                onClick={() => onRemoveImage(image.id)}
              >
                <CloseOutlined />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="chatFilePreviewList">
          {files.map((file, index) => (
            <div className="chatFilePreview" key={file.id ?? `${file.name}-${index}`}>
              <span>{file.name}</span>
              <button
                aria-label="移除文件"
                className="attachmentRemoveButton"
                type="button"
                onClick={() => onRemoveFile(file.id)}
              >
                <CloseOutlined />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
