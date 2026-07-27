import * as assert from "node:assert/strict";

import { WorkflowGraph } from "./dto/workflow-graph.dto";
import { WorkflowCompiler } from "./workflow-compiler";

const graph: WorkflowGraph = {
  schemaVersion: 1,
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      config: { inputs: [{ name: "query", type: "string", required: true }] }
    },
    {
      id: "search",
      type: "retrieval",
      name: "检索",
      config: { knowledgeBaseIds: ["kb-1"], query: "{{input.query}}" }
    },
    {
      id: "answer",
      type: "llm",
      name: "回答",
      config: {
        modelConfigId: "model-1",
        prompt: "问题：{{input.query}}\n资料：{{nodes.search.output.chunks}}"
      }
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      config: { output: { answer: "{{nodes.answer.output.text}}" } }
    }
  ],
  edges: [
    { id: "e1", source: "start", target: "search" },
    { id: "e2", source: "search", target: "answer" },
    { id: "e3", source: "answer", target: "end" }
  ]
};

function createCompiler(): WorkflowCompiler {
  return new WorkflowCompiler(
    {
      ensureEnabledModelConfig: async () => undefined,
      getModelConfig: async () => ({
        providerId: "provider-1",
        provider: { providerType: "OLLAMA", baseUrl: "http://localhost:11434" },
        modelName: "qwen",
        contextLength: 8192,
        timeoutSeconds: 60,
        maxTokens: 2048
      })
    } as never,
    {
      ensureKnowledgeBaseIdsExist: async () => undefined,
      getRetrievalConfigs: async (ids: string[]) =>
        ids.map((id) => ({
          id,
          embeddingModelConfigId: "embedding-1",
          embeddingDimension: 768,
          vectorStoreType: "PGVECTOR",
          vectorCollectionName: `kb_${id}`
        }))
    } as never,
    { getToolDefinitions: async () => [] } as never
  );
}

export const tests = [
  {
    name: "WorkflowCompiler builds a deterministic plan for a valid DAG",
    run: async () => {
      const compiler = createCompiler();
      const first = await compiler.compile(graph);
      const second = await compiler.compile(graph);

      assert.equal(first.valid, true);
      assert.equal(first.checksum, second.checksum);
      assert.deepEqual(first.compiledPlan?.topologicalOrder, ["start", "search", "answer", "end"]);
      assert.deepEqual(first.compiledPlan?.requiredInputs, [
        { name: "query", type: "string", required: true }
      ]);
      assert.ok(first.compiledPlan?.resourceFingerprints["model:model-1"]);
    }
  },
  {
    name: "WorkflowCompiler rejects cycles before resource validation",
    run: async () => {
      const cyclic: WorkflowGraph = {
        ...graph,
        edges: [...graph.edges, { id: "e4", source: "answer", target: "search" }]
      };
      const result = await createCompiler().compile(cyclic);

      assert.equal(result.valid, false);
      assert.ok(result.issues.some((issue) => issue.code === "GRAPH_CYCLE"));
    }
  },
  {
    name: "WorkflowCompiler rejects forward and unknown input references",
    run: async () => {
      const invalid: WorkflowGraph = {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === "search"
            ? {
                ...node,
                config: {
                  ...node.config,
                  query: "{{nodes.answer.output.text}} {{input.missing}}"
                }
              }
            : node
        )
      };
      const result = await createCompiler().compile(invalid);

      assert.equal(result.valid, false);
      assert.ok(result.issues.some((issue) => issue.code === "NODE_REFERENCE_NOT_PREVIOUS"));
      assert.ok(result.issues.some((issue) => issue.code === "INPUT_REFERENCE_UNKNOWN"));
    }
  },
  {
    name: "WorkflowCompiler rejects unavailable tools",
    run: async () => {
      const toolGraph: WorkflowGraph = {
        schemaVersion: 1,
        nodes: [
          { id: "start", type: "start", name: "开始", config: { inputs: [] } },
          {
            id: "tool",
            type: "tool",
            name: "调用工具",
            config: { toolId: "missing-tool", arguments: {} }
          },
          { id: "end", type: "end", name: "结束", config: { output: {} } }
        ],
        edges: [
          { id: "e1", source: "start", target: "tool" },
          { id: "e2", source: "tool", target: "end" }
        ]
      };
      const result = await createCompiler().compile(toolGraph);

      assert.equal(result.valid, false);
      assert.ok(result.issues.some((issue) => issue.code === "TOOL_UNAVAILABLE"));
    }
  },
  {
    name: "WorkflowCompiler rejects invalid capability node settings",
    run: async () => {
      const invalid: WorkflowGraph = {
        ...graph,
        nodes: graph.nodes.map((node) => {
          if (node.id === "search") {
            return {
              ...node,
              config: { ...node.config, topK: 0, scoreThreshold: 2 }
            };
          }
          if (node.id === "answer") {
            return {
              ...node,
              config: {
                ...node.config,
                temperature: 3,
                maxTokens: 0,
                responseFormat: "yaml"
              }
            };
          }
          return node;
        })
      };
      const result = await createCompiler().compile(invalid);

      assert.equal(result.valid, false);
      assert.ok(result.issues.filter((issue) => issue.code === "NODE_CONFIG_INVALID").length >= 5);
    }
  },
  {
    name: "WorkflowCompiler rejects references produced by only one condition branch",
    run: async () => {
      const branchGraph: WorkflowGraph = {
        schemaVersion: 1,
        nodes: [
          {
            id: "start",
            type: "start",
            name: "开始",
            config: { inputs: [{ name: "query", type: "string", required: true }] }
          },
          {
            id: "condition",
            type: "condition",
            name: "判断",
            config: {
              branches: [{ handle: "yes", left: "{{input.query}}", operator: "exists" }],
              defaultHandle: "default"
            }
          },
          {
            id: "only-yes",
            type: "template",
            name: "仅 Yes 执行",
            config: { template: "yes" }
          },
          {
            id: "merge",
            type: "template",
            name: "汇合",
            config: { template: "{{nodes.only-yes.output.text}}" }
          },
          { id: "end", type: "end", name: "结束", config: { output: {} } }
        ],
        edges: [
          { id: "e1", source: "start", target: "condition" },
          { id: "e2", source: "condition", sourceHandle: "yes", target: "only-yes" },
          { id: "e3", source: "condition", sourceHandle: "default", target: "merge" },
          { id: "e4", source: "only-yes", target: "merge" },
          { id: "e5", source: "merge", target: "end" }
        ]
      };
      const result = await createCompiler().compile(branchGraph);

      assert.equal(result.valid, false);
      assert.ok(result.issues.some((issue) => issue.code === "BRANCH_REFERENCE_CONFLICT"));
    }
  }
];
