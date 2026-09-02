import * as assert from "node:assert/strict";

import { McpRedactor } from "./mcp-redaction";

export const tests = [
  {
    name: "McpRedactor redacts default sensitive keys and configured nested paths",
    run: () => {
      const redactor = new McpRedactor();
      const input = {
        password: "plain-password",
        customer: { mobile: "13800138000", name: "张三" },
        items: [
          { token: "first-token", value: 1 },
          { token: "second-token", value: 2 }
        ]
      };

      const result = redactor.redactJson(input, ["customer.mobile", "items.*.value"]);

      assert.deepEqual(result, {
        password: "[REDACTED]",
        customer: { mobile: "[REDACTED]", name: "张三" },
        items: [
          { token: "[REDACTED]", value: "[REDACTED]" },
          { token: "[REDACTED]", value: "[REDACTED]" }
        ]
      });
      assert.equal(input.password, "plain-password");
      assert.equal(input.customer.mobile, "13800138000");
    }
  },
  {
    name: "McpRedactor removes credentials from remote error text",
    run: () => {
      const redactor = new McpRedactor();
      const secret = "client-secret-123";
      const result = redactor.redactText(
        `request failed authorization=Bearer abc.def.ghi client_secret=${secret} access_token=query-token`,
        [secret]
      );

      assert.equal(result.includes(secret), false);
      assert.equal(result.includes("abc.def.ghi"), false);
      assert.equal(result.includes("query-token"), false);
      assert.match(result, /\[REDACTED\]/u);
    }
  },
  {
    name: "McpRedactor rejects prototype traversal in configured paths",
    run: () => {
      const redactor = new McpRedactor();
      assert.throws(() => redactor.normalizePaths(["customer.__proto__.secret"]));
      assert.throws(() => redactor.normalizePaths(["/"]));
    }
  }
];
