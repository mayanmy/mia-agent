import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { AppError, ErrorCodes } from "./errors";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const secret = process.env.MIA_SECRET_KEY;

  if (!secret || secret.length < 16) {
    throw new AppError(
      ErrorCodes.common.badRequest,
      "MIA_SECRET_KEY must be configured before saving API keys"
    );
  }

  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(
    "."
  );
}

export function decryptSecret(value: string): string {
  const [iv, authTag, encrypted] = value.split(".");

  if (!iv || !authTag || !encrypted) {
    throw new AppError(ErrorCodes.common.badRequest, "invalid encrypted secret");
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}
