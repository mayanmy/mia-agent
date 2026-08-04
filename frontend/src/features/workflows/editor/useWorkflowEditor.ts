import { useCallback, useReducer } from "react";

import type { WorkflowGraph } from "../types";

const MAX_HISTORY_LENGTH = 100;
const MERGE_WINDOW_MS = 800;

type WorkflowEditorState = {
  /** 撤销栈，末尾是最近一次快照。 */
  past: WorkflowGraph[];
  /** 当前正在编辑的 Graph。 */
  present: WorkflowGraph;
  /** 重做栈，开头是下一次快照。 */
  future: WorkflowGraph[];
  /** 用于合并连续字段输入的稳定键。 */
  lastMergeKey: string | null;
  /** 最近一次提交快照的时间戳。 */
  lastCommittedAt: number;
};

type WorkflowEditorAction =
  | { type: "commit"; graph: WorkflowGraph; mergeKey?: string; committedAt: number }
  | { type: "reset"; graph: WorkflowGraph }
  | { type: "undo" }
  | { type: "redo" };

/** 管理 Workflow Graph 快照历史；编辑状态不会进入持久化 Graph。 */
export function useWorkflowEditor(initialGraph: WorkflowGraph) {
  const [state, dispatch] = useReducer(reducer, createInitialState(initialGraph));

  const commitGraph = useCallback((graph: WorkflowGraph, mergeKey?: string) => {
    dispatch({ type: "commit", graph, mergeKey, committedAt: Date.now() });
  }, []);
  const resetGraph = useCallback((graph: WorkflowGraph) => {
    dispatch({ type: "reset", graph });
  }, []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  return {
    graph: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commitGraph,
    resetGraph,
    undo,
    redo
  };
}

function createInitialState(graph: WorkflowGraph): WorkflowEditorState {
  return {
    past: [],
    present: graph,
    future: [],
    lastMergeKey: null,
    lastCommittedAt: 0
  };
}

function reducer(state: WorkflowEditorState, action: WorkflowEditorAction): WorkflowEditorState {
  if (action.type === "reset") return createInitialState(action.graph);
  if (action.type === "undo") {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future].slice(0, MAX_HISTORY_LENGTH),
      lastMergeKey: null,
      lastCommittedAt: 0
    };
  }
  if (action.type === "redo") {
    const next = state.future[0];
    if (!next) return state;
    return {
      past: [...state.past, state.present].slice(-MAX_HISTORY_LENGTH),
      present: next,
      future: state.future.slice(1),
      lastMergeKey: null,
      lastCommittedAt: 0
    };
  }
  if (action.graph === state.present) return state;

  const shouldMerge =
    Boolean(action.mergeKey) &&
    action.mergeKey === state.lastMergeKey &&
    action.committedAt - state.lastCommittedAt <= MERGE_WINDOW_MS;
  return {
    past: shouldMerge ? state.past : [...state.past, state.present].slice(-MAX_HISTORY_LENGTH),
    present: action.graph,
    future: [],
    lastMergeKey: action.mergeKey ?? null,
    lastCommittedAt: action.committedAt
  };
}
