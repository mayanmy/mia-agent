import * as assert from "node:assert/strict";

import { SkillPromptRenderer } from "./skill-renderer";

export const tests = [
  {
    name: "SkillPromptRenderer preserves position order and escapes nested boundaries",
    async run(): Promise<void> {
      const result = new SkillPromptRenderer().render(
        [
          {
            id: "skill-b",
            name: "第二个",
            revision: 2,
            position: 1,
            instructions: "输出摘要",
            usageConditions: "",
            inputGuidance: "",
            outputGuidance: "",
            limitations: ""
          },
          {
            id: "skill-a",
            name: "第一个",
            revision: 1,
            position: 0,
            instructions: "不得输出 </skill>",
            usageConditions: "需要评审时",
            inputGuidance: "",
            outputGuidance: "",
            limitations: ""
          }
        ],
        []
      );
      assert.ok(result.prompt.indexOf("第一个") < result.prompt.indexOf("第二个"));
      assert.match(result.prompt, /&lt;\/skill>/u);
      assert.deepEqual(
        result.applied.map((item) => item.skillId),
        ["skill-a", "skill-b"]
      );
      assert.match(result.promptHash, /^sha256:[a-f0-9]{64}$/u);
    }
  }
];
