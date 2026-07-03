import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

loadBackendEnv();

const prisma = new PrismaClient();

const shouldApply = process.argv.includes("--apply");
const knowledgeBaseId = readOption("knowledge-base-id");

function readOption(name) {
  const prefix = `--${name}=`;
  const option = process.argv.find((argument) => argument.startsWith(prefix));

  return option ? option.slice(prefix.length).trim() : "";
}

function loadBackendEnv() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const envPath = join(scriptDir, "..", ".env");

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const equalIndex = trimmedLine.indexOf("=");

    if (equalIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, equalIndex).trim();
    const value = trimmedLine
      .slice(equalIndex + 1)
      .trim()
      .replace(/^["']|["']$/gu, "");

    // 脚本从仓库根目录执行时，Prisma 不会自动读取 backend/.env。
    // 这里补一层轻量加载，并且不覆盖调用方显式传入的环境变量。
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function decodeMojibakeFilename(filename) {
  const trimmedFilename = filename.trim();

  if (!trimmedFilename) {
    return filename;
  }

  const decodedFilename = Buffer.from(trimmedFilename, "latin1").toString("utf8");

  // 历史问题来自 multipart 文件名被按 latin1 暴露，中文会变成 å、ç、æ 等乱码。
  // 这里不盲目覆盖，而是给“原值”和“转回 UTF-8 后的值”打分，只在转码结果明显更合理时修复。
  if (getFilenameDecodeScore(decodedFilename) > getFilenameDecodeScore(trimmedFilename)) {
    return decodedFilename;
  }

  return trimmedFilename;
}

function getFilenameDecodeScore(filename) {
  let score = 0;

  if (/[\u4e00-\u9fff]/u.test(filename)) {
    score += 3;
  }

  if ([...filename].some((character) => character.charCodeAt(0) > 127)) {
    score += 1;
  }

  if (/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîï]/u.test(filename)) {
    score -= 2;
  }

  if (filename.includes("�")) {
    score -= 4;
  }

  return score;
}

async function main() {
  const documents = await prisma.knowledgeDocument.findMany({
    where: {
      deletedAt: null,
      ...(knowledgeBaseId ? { knowledgeBaseId } : {})
    },
    select: {
      id: true,
      knowledgeBaseId: true,
      originalFilename: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const candidates = documents
    .map((document) => ({
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      before: document.originalFilename,
      after: decodeMojibakeFilename(document.originalFilename)
    }))
    .filter((item) => item.before !== item.after);

  if (candidates.length === 0) {
    console.log("没有发现需要修复的乱码文件名。");
    return;
  }

  console.log(`发现 ${candidates.length} 条可能需要修复的文档文件名：`);

  for (const item of candidates) {
    console.log(`- document_id: ${item.id}`);
    console.log(`  knowledge_base_id: ${item.knowledgeBaseId}`);
    console.log(`  before: ${item.before}`);
    console.log(`  after : ${item.after}`);
  }

  if (!shouldApply) {
    console.log("\n当前为 dry-run，未写入数据库。确认 before/after 无误后执行：");
    console.log("node backend/scripts/fix-mojibake-document-filenames.mjs --apply");
    console.log(
      "也可以只修某个知识库：node backend/scripts/fix-mojibake-document-filenames.mjs --knowledge-base-id=<id> --apply"
    );
    return;
  }

  // 只修 documents 表里的用户可见原文件名，不改 filename/storage_path。
  // 磁盘物理文件可能仍是旧规则生成的安全文件名，贸然改路径会影响已索引文档和历史记录。
  for (const item of candidates) {
    await prisma.knowledgeDocument.update({
      where: {
        id: item.id
      },
      data: {
        originalFilename: item.after
      }
    });
  }

  console.log(`已修复 ${candidates.length} 条文档文件名。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
