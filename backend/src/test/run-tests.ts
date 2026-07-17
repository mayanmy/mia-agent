import { tests as agentTests } from "../modules/agents/agents.service.spec";
import { tests as authTests } from "../modules/auth/auth.service.spec";
import { tests as chatTests } from "../modules/chat/chat.service.spec";
import { tests as chatSessionTests } from "../modules/chat/chat-sessions.service.spec";
import { tests as externalAccessTests } from "../modules/external_access/external-access.service.spec";
import { tests as knowledgeTests } from "../modules/knowledge/knowledge.service.spec";
import { tests as retrievalTests } from "../modules/retrieval/retrieval.service.spec";
import { tests as toolTests } from "../modules/tools/tools.service.spec";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  ...authTests,
  ...toolTests,
  ...agentTests,
  ...knowledgeTests,
  ...retrievalTests,
  ...chatSessionTests,
  ...externalAccessTests,
  ...chatTests
];

async function main(): Promise<void> {
  let passed = 0;

  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
      console.log(`ok ${passed} - ${test.name}`);
    } catch (error) {
      console.error(`not ok ${passed + 1} - ${test.name}`);
      console.error(error);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`${passed}/${tests.length} tests passed`);
}

void main();
