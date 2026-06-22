import * as assert from "node:assert/strict";

import { AppError, ErrorCodes } from "../../core/errors";
import { chunkText } from "./chunking";
import { KnowledgeService } from "./knowledge.service";
import { isTextDocument, parseTextDocument } from "./parsing";

export const tests = [
  {
    name: "Knowledge parsing normalizes supported text documents",
    run: () => {
      assert.equal(isTextDocument("README.md"), true);
      assert.equal(isTextDocument("manual.pdf"), false);
      assert.equal(parseTextDocument("data.json", Buffer.from('{"name":"Mia","enabled":true}')), `{
  "name": "Mia",
  "enabled": true
}`);
    }
  },
  {
    name: "Knowledge chunking splits text with stable indexes",
    run: () => {
      const chunks = chunkText("一二三四五六七八九十".repeat(30), {
        chunkSize: 80,
        overlap: 10
      });

      assert.ok(chunks.length > 1);
      assert.deepEqual(
        chunks.map((chunk) => chunk.chunkIndex),
        chunks.map((_, index) => index)
      );
      assert.ok(chunks.every((chunk) => chunk.content.length <= 80));
      assert.ok(chunks.every((chunk) => chunk.tokenCount > 0));
    }
  },
  {
    name: "KnowledgeService.uploadKnowledgeDocument rejects unsupported file types",
    run: async () => {
      const prisma = {
        knowledgeBase: {
          findFirst: async () => ({ id: "knowledge-base-id" })
        }
      };
      const modelProvidersService = {};
      const service = new KnowledgeService(prisma as never, modelProvidersService as never);

      await assert.rejects(
        () =>
          service.uploadKnowledgeDocument("knowledge-base-id", {
            originalname: "notes.exe",
            mimetype: "application/octet-stream",
            size: 4,
            buffer: Buffer.from("test")
          }),
        (error) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, ErrorCodes.knowledge.invalidDocument);
          assert.equal(
            error.message,
            "only txt, md, pdf, docx, csv, and json files are supported"
          );
          return true;
        }
      );
    }
  }
];
