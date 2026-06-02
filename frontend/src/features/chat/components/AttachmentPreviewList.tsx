import { CloseOutlined } from "@ant-design/icons";

import type { ChatFileAttachment, ChatImageAttachment } from "../api";

export function AttachmentPreviewList({
  images,
  files,
  onRemoveImage,
  onRemoveFile
}: {
  images: ChatImageAttachment[];
  files: ChatFileAttachment[];
  onRemoveImage: (id: string | undefined) => void;
  onRemoveFile: (id: string | undefined) => void;
}) {
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
