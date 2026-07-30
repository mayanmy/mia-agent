import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { UploadProps } from "antd";

import type { ChatFileAttachment, ChatImageAttachment } from "../api";
import {
  createMessageId,
  isSupportedTextFile,
  maxAttachmentCount,
  maxFileSize,
  maxImageSize,
  readFileAsDataUrl,
  readFileAsText
} from "../utils";

/** Hook 使用的最小消息提示能力，避免直接耦合 Ant Design 的完整实例类型。 */
type MessageApi = {
  success: (content: string) => void;
  warning: (content: string) => void;
};

/** 统一管理图片与文本附件的校验、读取、粘贴和移除状态。 */
export function useChatAttachments(messageApi: MessageApi) {
  const [images, setImages] = useState<ChatImageAttachment[]>([]);
  const [files, setFiles] = useState<ChatFileAttachment[]>([]);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;

    // FileReader 不能可靠地从这里拿到单次读取实例，因此在读取完成后跳过已卸载组件的状态写入。
    return () => {
      disposedRef.current = true;
    };
  }, []);

  /** 校验并读取单张图片；返回值表示是否成功加入附件列表。 */
  async function addImageFile(file: File): Promise<boolean> {
    if (!file.type?.startsWith("image/")) {
      messageApi.warning("只能上传图片");
      return false;
    }

    if (file.size > maxImageSize) {
      messageApi.warning("单张图片不能超过 5MB");
      return false;
    }

    if (images.length >= maxAttachmentCount) {
      messageApi.warning("一次最多上传 4 张图片");
      return false;
    }

    const dataUrl = await readFileAsDataUrl(file);

    if (disposedRef.current) {
      return false;
    }

    setImages((current) => [
      ...current,
      {
        id: createMessageId(),
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl
      }
    ]);

    return true;
  }

  const handleBeforeUpload: UploadProps["beforeUpload"] = async (file) => {
    await addImageFile(file);
    return false;
  };

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedFiles = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/")
    );

    if (pastedFiles.length === 0) {
      return;
    }

    event.preventDefault();

    void addPastedImages(pastedFiles);
  }

  /** 依次处理剪贴板图片，达到数量上限后停止继续读取。 */
  async function addPastedImages(pastedFiles: File[]) {
    const remainingSlots = maxAttachmentCount - images.length;
    const filesToAdd = pastedFiles.slice(0, Math.max(remainingSlots, 0));
    let addedCount = 0;

    if (filesToAdd.length < pastedFiles.length) {
      messageApi.warning("一次最多保留 4 张图片");
    }

    for (const file of filesToAdd) {
      const added = await addImageFile(file);

      if (added) {
        addedCount += 1;
      }
    }

    if (!disposedRef.current && addedCount > 0) {
      messageApi.success(`已粘贴 ${addedCount} 张图片`);
    }
  }

  function removeImage(id: string | undefined) {
    if (!id) {
      return;
    }

    setImages((current) => current.filter((item) => item.id !== id));
  }

  /** 校验并读取单个文本文件，避免大文件占满对话上下文。 */
  async function addTextFile(file: File): Promise<boolean> {
    if (!isSupportedTextFile(file)) {
      messageApi.warning("当前只支持文本类文件，例如 txt、md、json、csv、代码文件");
      return false;
    }

    if (file.size > maxFileSize) {
      messageApi.warning("单个文件不能超过 1MB");
      return false;
    }

    if (files.length >= maxAttachmentCount) {
      messageApi.warning("一次最多上传 4 个文件");
      return false;
    }

    const content = await readFileAsText(file);

    if (disposedRef.current) {
      return false;
    }

    setFiles((current) => [
      ...current,
      {
        id: createMessageId(),
        name: file.name,
        mimeType: file.type || "text/plain",
        size: file.size,
        content
      }
    ]);

    return true;
  }

  const handleFileBeforeUpload: UploadProps["beforeUpload"] = async (file) => {
    await addTextFile(file);
    return false;
  };

  function removeFile(id: string | undefined) {
    if (!id) {
      return;
    }

    setFiles((current) => current.filter((item) => item.id !== id));
  }

  function clearAttachments() {
    setImages([]);
    setFiles([]);
  }

  return {
    images,
    files,
    handleBeforeUpload,
    handlePaste,
    handleFileBeforeUpload,
    removeImage,
    removeFile,
    clearAttachments
  };
}
