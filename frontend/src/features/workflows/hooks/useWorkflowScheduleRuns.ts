import { useCallback, useState } from "react";
import { App as AntdApp } from "antd";

import {
  cancelWorkflowScheduleRun,
  getWorkflowScheduleRun,
  listWorkflowScheduleRuns
} from "../api";
import type {
  WorkflowScheduleListItem,
  WorkflowScheduleRunDetail,
  WorkflowScheduleRunListItem,
  WorkflowScheduleRunStatus
} from "../types";

const PAGE_SIZE = 20;

/** 集中管理运行历史的分页、筛选和取消副作用，展示组件只处理交互回调。 */
export function useWorkflowScheduleRuns() {
  const { message } = AntdApp.useApp();
  const [schedule, setSchedule] = useState<WorkflowScheduleListItem | null>(null);
  const [runs, setRuns] = useState<WorkflowScheduleRunListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<WorkflowScheduleRunStatus | undefined>();
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<WorkflowScheduleRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(
    async (
      target: WorkflowScheduleListItem,
      nextPage: number,
      nextStatus: WorkflowScheduleRunStatus | undefined
    ) => {
      setLoading(true);
      try {
        const result = await listWorkflowScheduleRuns(target.id, nextPage, PAGE_SIZE, nextStatus);
        setRuns(result.list);
        setTotal(result.total);
        setPage(result.page);
      } catch (error) {
        message.error(error instanceof Error ? error.message : "加载运行历史失败");
      } finally {
        setLoading(false);
      }
    },
    [message]
  );

  const open = useCallback(
    (target: WorkflowScheduleListItem) => {
      setSchedule(target);
      setStatus(undefined);
      setDetail(null);
      void load(target, 1, undefined);
    },
    [load]
  );

  const close = useCallback(() => {
    setSchedule(null);
    setDetail(null);
  }, []);

  const changePage = useCallback(
    (nextPage: number) => {
      if (schedule) void load(schedule, nextPage, status);
    },
    [load, schedule, status]
  );

  const changeStatus = useCallback(
    (nextStatus?: WorkflowScheduleRunStatus) => {
      setStatus(nextStatus);
      if (schedule) void load(schedule, 1, nextStatus);
    },
    [load, schedule]
  );

  const openDetail = useCallback(
    async (run: WorkflowScheduleRunListItem) => {
      setDetailLoading(true);
      try {
        setDetail(await getWorkflowScheduleRun(run.id));
      } catch (error) {
        message.error(error instanceof Error ? error.message : "加载运行详情失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [message]
  );

  const cancel = useCallback(async () => {
    if (!detail || !schedule) return;
    setCanceling(true);
    try {
      await cancelWorkflowScheduleRun(detail.id);
      const refreshed = await getWorkflowScheduleRun(detail.id);
      setDetail(refreshed);
      await load(schedule, page, status);
      message.success(refreshed.status === "CANCELED" ? "运行已取消" : "取消请求已提交");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "取消运行失败");
    } finally {
      setCanceling(false);
    }
  }, [detail, load, message, page, schedule, status]);

  return {
    schedule,
    runs,
    total,
    page,
    pageSize: PAGE_SIZE,
    status,
    loading,
    detail,
    detailLoading,
    canceling,
    open,
    close,
    refresh: () => schedule && load(schedule, page, status),
    changePage,
    changeStatus,
    openDetail,
    closeDetail: () => setDetail(null),
    cancel
  };
}
