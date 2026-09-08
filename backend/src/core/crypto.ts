import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { AppError, ErrorCodes } from "./errors";

/** 使用带认证的 AES-GCM，密文被篡改时解密必须失败。 */
const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const secret = process.env.MIA_SECRET_KEY;

  if (!secret || secret.length < 16) {
    throw new AppError(
      ErrorCodes.common.badRequest,
      "MIA_SECRET_KEY must be configured before saving API keys"
    );
  }

  // 环境密钥只用于派生固定 32 字节 AES Key，不把原始字符串写入持久层。
  return createHash("sha256").update(secret).digest();
}

/** 加密供应商凭据，输出格式为 base64(iv).base64(tag).base64(ciphertext)。 */
export function encryptSecret(value: string): string {
  // GCM 推荐 12 字节随机 IV；每次加密重新生成以避免同密钥下 IV 复用。
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(
    "."
  );
}

/** 解密由 encryptSecret 生成的凭据，认证标签不匹配时直接失败。 */
export function decryptSecret(value: string): string {
  const [iv, authTag, encrypted] = value.split(".");

  if (!iv || !authTag || !encrypted) {
    throw new AppError(ErrorCodes.common.badRequest, "invalid encrypted secret");
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(iv, "base64"));
  // setAuthTag 保证密文、IV 或标签任一被修改时 final() 不会返回伪造明文。
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}
