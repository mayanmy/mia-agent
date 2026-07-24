import * as assert from "node:assert/strict";

import { compileExpressionValue, WorkflowExpressionError } from "./expression-parser";

export const tests = [
  {
    name: "Workflow expression compiler creates references and template segments",
    run: () => {
      const result = compileExpressionValue({
        query: "{{input.query}}",
        prompt: "天气：{{nodes.weather.output.body}}"
      });

      assert.deepEqual(result.value, {
        query: { kind: "reference", source: "input", path: ["query"] },
        prompt: {
          kind: "template",
          segments: [
            "天气：",
            { kind: "reference", source: "nodes", path: ["weather", "output", "body"] }
          ]
        }
      });
      assert.equal(result.references.length, 2);
    }
  },
  {
    name: "Workflow expression compiler rejects prototype paths and executable syntax",
    run: () => {
      assert.throws(
        () => compileExpressionValue("{{nodes.__proto__.value}}"),
        WorkflowExpressionError
      );
      assert.throws(
        () => compileExpressionValue("{{input.query || true}}"),
        WorkflowExpressionError
      );
    }
  }
];
