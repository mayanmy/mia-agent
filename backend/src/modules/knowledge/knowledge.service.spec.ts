import * as assert from "node:assert/strict";

import { AppError, ErrorCodes } from "../../core/errors";
import { KnowledgeService } from "./knowledge.service";

export const tests = [
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
