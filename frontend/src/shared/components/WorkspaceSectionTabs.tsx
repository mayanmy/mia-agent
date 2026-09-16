import { Tabs } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

export type WorkspaceSectionTab = {
  label: string;
  path: string;
  /** 详情页也应命中所属页签，例如 Workflow 编辑页。 */
  match?: (pathname: string) => boolean;
};

/** 只负责同类页面的导航组合，不侵入各 feature 自己的数据与状态。 */
export function WorkspaceSectionTabs({ tabs }: { tabs: WorkspaceSectionTab[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeKey =
    tabs.find((tab) => (tab.match ? tab.match(location.pathname) : location.pathname === tab.path))
      ?.path ?? tabs[0]?.path;
  const hideTabs = /^\/workflows\/design\/[^/]+\/?$/.test(location.pathname);

  return (
    <>
      <Tabs
        activeKey={activeKey}
        className={`workspaceSectionTabs${hideTabs ? " detailHidden" : ""}`}
        items={tabs.map(({ label, path }) => ({ key: path, label }))}
        onChange={(path) => navigate(path)}
      />
      <Outlet />
    </>
  );
}
