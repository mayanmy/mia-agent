import * as assert from "node:assert/strict";

import { parseEvaluationImport } from "./dataset-import";

export const tests = [
  {
    name: "Evaluation import parses quoted CSV fields and pipe-separated IDs",
    run: () => {
      const result = parseEvaluationImport(
        "cases.csv",
        Buffer.from(
          'question,expected_answer,expected_document_ids,answerable,category\n"差旅标准,是多少？","按制度执行",00000000-0000-4000-8000-000000000001|00000000-0000-4000-8000-000000000002,true,policy\n'
        )
      );
      assert.equal(result.errors.length, 0);
      assert.equal(result.rows[0]?.question, "差旅标准,是多少？");
      assert.equal(result.rows[0]?.expectedDocumentIds.length, 2);
      assert.equal(result.rows[0]?.answerable, true);
    }
  },
  {
    name: "Evaluation import keeps JSONL line errors without dropping valid rows",
    run: () => {
      const result = parseEvaluationImport(
        "cases.jsonl",
        Buffer.from(
          '{"question":"有效问题","answerable":false}\nnot-json\n{"category":"missing"}\n'
        )
      );
      assert.equal(result.totalRows, 3);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0]?.answerable, false);
      assert.deepEqual(
        result.errors.map((item) => item.line),
        [2, 3]
      );
    }
  },
  {
    name: "Evaluation import rejects unsupported file formats",
    run: () => {
      assert.throws(
        () => parseEvaluationImport("cases.xlsx", Buffer.from("data")),
        /only UTF-8 CSV/u
      );
    }
  },
  {
    name: "Evaluation import reports invalid expected document IDs during preview",
    run: () => {
      const result = parseEvaluationImport(
        "cases.csv",
        Buffer.from("question,expected_document_ids\n测试问题,not-a-uuid\n")
      );
      assert.equal(result.rows.length, 0);
      assert.match(result.errors[0]?.message ?? "", /valid UUIDs/u);
    }
  }
];
