import { useState } from "react";
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

type MessageApi = {
  success: (content: string) => void;
  warning: (content: string) => void;
};

export function useChatAttachments(messageApi: MessageApi) {
  const [images, setImages] = useState<ChatImageAttachment[]>([]);
  const [files, setFiles] = useState<ChatFileAttachment[]>([]);

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

    if (addedCount > 0) {
      messageApi.success(`已粘贴 ${addedCount} 张图片`);
    }
  }

  function removeImage(id: string | undefined) {
    if (!id) {
      return;
    }

    setImages((current) => current.filter((item) => item.id !== id));
  }

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
