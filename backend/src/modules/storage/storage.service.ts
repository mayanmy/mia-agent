import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { HttpStatus, Injectable } from "@nestjs/common";

import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { getConfig } from "../../core/config";
import { AppError, ErrorCodes } from "../../core/errors";
import { PrismaService } from "../prisma/prisma.service";
import { AgentContentPart } from "../agent_runtime/dto/content-part.dto";

export type StoredFileDto = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
};

const SAFE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/zip"
]);

@Injectable()
export class StorageService {
  constructor(private readonly prisma: PrismaService) {}

  /** 保存可信运行时产生的字节；文件名永不参与物理路径，防止目录穿越。 */
  async saveBuffer(input: {
    name: string;
    mimeType: string;
    data: Buffer;
  }): Promise<StoredFileDto> {
    const config = getConfig();
    if (
      !SAFE_MIME_TYPES.has(input.mimeType) ||
      input.data.byteLength > config.storageMaxFileBytes
    ) {
      throw new AppError(ErrorCodes.common.badRequest, "文件类型不受支持或超过大小限制");
    }
    const id = randomUUID();
    const storageKey = `${id.slice(0, 2)}/${id}`;
    const target = join(config.storageDir, storageKey);
    await mkdir(join(config.storageDir, id.slice(0, 2)), { recursive: true });
    const temporary = `${target}.uploading`;
    await writeFile(temporary, input.data, { flag: "wx" });
    await rename(temporary, target);
    const row = await this.prisma.storedFile.create({
      data: {
        id,
        workspaceId: requireWorkspaceId(),
        storageKey,
        name: basename(input.name).slice(0, 255) || "file",
        mimeType: input.mimeType,
        size: BigInt(input.data.byteLength),
        sha256: createHash("sha256").update(input.data).digest("hex")
      }
    });
    return this.toDto(row);
  }

  async readOwnedFile(id: string): Promise<{ file: StoredFileDto; data: Buffer }> {
    const row = await this.prisma.storedFile.findFirst({
      where: { id, workspaceId: requireWorkspaceId(), status: "READY" }
    });
    if (!row) throw new AppError(ErrorCodes.common.notFound, "文件不存在", HttpStatus.NOT_FOUND);
    return {
      file: this.toDto(row),
      data: await readFile(join(getConfig().storageDir, row.storageKey))
    };
  }

  /** 短期签名 URL 让 Widget 可读取产物，同时避免公开暴露可枚举的文件 ID。 */
  async readSignedFile(id: string, expires: string, signature: string) {
    const expected = this.sign(id, expires);
    if (Number(expires) < Math.floor(Date.now() / 1000) || !this.safeEqual(expected, signature)) {
      throw new AppError(ErrorCodes.common.notFound, "文件链接无效或已过期", HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.storedFile.findFirst({ where: { id, status: "READY" } });
    if (!row) throw new AppError(ErrorCodes.common.notFound, "文件不存在", HttpStatus.NOT_FOUND);
    return {
      file: this.toDto(row),
      data: await readFile(join(getConfig().storageDir, row.storageKey))
    };
  }

  refreshContentParts(parts: AgentContentPart[]): AgentContentPart[] {
    return parts.map((part) =>
      part.type === "image" || part.type === "file"
        ? { ...part, url: this.createDownloadUrl(part.fileId) }
        : part
    );
  }

  private toDto(row: { id: string; name: string; mimeType: string; size: bigint }): StoredFileDto {
    return {
      id: row.id,
      name: row.name,
      mimeType: row.mimeType,
      size: Number(row.size),
      url: this.createDownloadUrl(row.id)
    };
  }

  private createDownloadUrl(id: string): string {
    const expires = String(Math.floor(Date.now() / 1000) + 3600);
    return `/api/v1/files/${id}?expires=${expires}&signature=${this.sign(id, expires)}`;
  }

  private sign(id: string, expires: string): string {
    return createHmac("sha256", getConfig().authJwtSecret)
      .update(`${id}.${expires}`)
      .digest("base64url");
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
