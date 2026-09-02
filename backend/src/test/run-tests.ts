import { tests as agentTests } from "../modules/agents/agents.service.spec";
import { tests as agentRunTests } from "../modules/agent_runs/agent-runs.service.spec";
import { tests as agentPromptBuilderTests } from "../modules/agent_runtime/prompt-builder.spec";
import { tests as historyPolicyTests } from "../modules/agent_runtime/history-policy.spec";
import { tests as agentRuntimeTests } from "../modules/agent_runtime/agent-runtime.service.spec";
import { tests as authTests } from "../modules/auth/auth.service.spec";
import { tests as chatTests } from "../modules/chat/chat.service.spec";
import { tests as chatSessionTests } from "../modules/chat/chat-sessions.service.spec";
import { tests as externalAccessTests } from "../modules/external_access/external-access.service.spec";
import { tests as knowledgeTests } from "../modules/knowledge/knowledge.service.spec";
import { tests as mcpProtocolClientTests } from "../modules/mcp/clients/mcp-protocol.client.spec";
import { tests as mcpClientCredentialsTests } from "../modules/mcp/clients/mcp-client-credentials.provider.spec";
import { tests as mcpOAuthTests } from "../modules/mcp/clients/mcp-oauth.manager.spec";
import { tests as mcpApprovalTests } from "../modules/mcp/mcp-approval.service.spec";
import { tests as mcpRedactionTests } from "../modules/mcp/mcp-redaction.spec";
import { tests as mcpServiceTests } from "../modules/mcp/mcp.service.spec";
import { tests as mcpToolExecutorTests } from "../modules/mcp/mcp-tool.executor.spec";
import { tests as retrievalTests } from "../modules/retrieval/retrieval.service.spec";
import { tests as skillTests } from "../modules/skills/skills.service.spec";
import { tests as toolTests } from "../modules/tools/tools.service.spec";
import { tests as workflowTests } from "../modules/workflows/workflows.service.spec";
import { tests as workflowCompilerTests } from "../modules/workflows/workflow-compiler.spec";
import { tests as workflowExpressionTests } from "../modules/workflows/expression-parser.spec";
import { tests as workflowRuntimeTests } from "../modules/workflow_runtime/workflow-runtime.service.spec";
import { tests as workflowCapabilityTests } from "../modules/workflow_runtime/capability-executors.spec";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  ...authTests,
  ...toolTests,
  ...mcpProtocolClientTests,
  ...mcpClientCredentialsTests,
  ...mcpOAuthTests,
  ...mcpApprovalTests,
  ...mcpRedactionTests,
  ...mcpServiceTests,
  ...skillTests,
  ...mcpToolExecutorTests,
  ...agentRunTests,
  ...agentPromptBuilderTests,
  ...historyPolicyTests,
  ...agentRuntimeTests,
  ...agentTests,
  ...workflowExpressionTests,
  ...workflowCompilerTests,
  ...workflowTests,
  ...workflowRuntimeTests,
  ...workflowCapabilityTests,
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
