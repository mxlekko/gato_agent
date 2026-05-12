import { Button, Layout, Menu } from "@arco-design/web-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { authClient } from "../services/authClient";

const { Content, Sider } = Layout;
const MenuItem = Menu.Item;
const SubMenu = Menu.SubMenu;

const configCatalogItems = [
  { to: "/configs/skills", label: "业务技能" },
  { to: "/configs/templates", label: "流程模板" },
  { to: "/configs/queries", label: "查询服务配置" },
  { to: "/configs/tools", label: "工具配置" }
];

const ragItems = [
  { to: "/rag/overview", label: "服务总览" },
  { to: "/rag/library", label: "文档库" },
  { to: "/rag/sync", label: "数据库" },
  { to: "/rag/jobs", label: "任务队列" },
  { to: "/rag/search", label: "检索测试" },
  { to: "/rag/settings", label: "设置" }
];

const navGroups = [
  {
    label: "场景",
    items: [
      { to: "/scenes", label: "场景 / 流程" }
    ]
  },
  {
    label: "调试",
    items: [
      { to: "/debug/run-once", label: "单次请求调试" }
    ]
  },
  {
    label: "运行",
    items: [
      { to: "/runs", label: "接口调用日志" }
    ]
  },
  {
    label: "知识库 / RAG",
    items: [
      { label: "RAG 管理", children: ragItems }
    ]
  },
  {
    label: "配置",
    items: [
      { label: "配置目录", children: configCatalogItems },
      { to: "/configs/validate", label: "配置校验" },
      { to: "/configs/compile-preview", label: "编译预览" }
    ]
  },
  {
    label: "灰度",
    items: [
      { to: "/rollout", label: "灰度概览" }
    ]
  }
];

function isPathActive(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function flattenNavItems(items) {
  return items.flatMap((item) => {
    if (Array.isArray(item.children)) {
      return flattenNavItems(item.children);
    }
    return item.to ? [item] : [];
  });
}

function collectOpenKeys() {
  return navGroups.flatMap((group) => [
    `group:${group.label}`,
    ...group.items
      .filter((item) => Array.isArray(item.children) && item.children.length > 0)
      .map((item) => `submenu:${group.label}:${item.label}`)
  ]);
}

function renderMenuItem(item, groupLabel) {
  if (Array.isArray(item.children) && item.children.length > 0) {
    return (
      <SubMenu key={`submenu:${groupLabel}:${item.label}`} title={item.label}>
        {item.children.map((child) => renderMenuItem(child, groupLabel))}
      </SubMenu>
    );
  }

  return (
    <MenuItem key={item.to}>
      {item.label}
    </MenuItem>
  );
}

export function ShellLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const adminUser = authClient.getUser() || "管理员";
  const navLeaves = flattenNavItems(navGroups.flatMap((group) => group.items));
  const selectedItem = navLeaves
    .slice()
    .sort((left, right) => right.to.length - left.to.length)
    .find((item) => isPathActive(location.pathname, item.to));

  return (
    <Layout className="app-shell">
      <Sider className="app-sidebar" width={264}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <img src="/favicon.svg" alt="" />
          </div>
          <div className="sidebar-brand-copy">
            <div className="sidebar-title">
              场景编排平台
            </div>
          </div>
        </div>

        <Menu
          className="sidebar-nav-menu"
          defaultOpenKeys={collectOpenKeys()}
          onClickMenuItem={(key) => {
            if (String(key).startsWith("/")) {
              navigate(key);
            }
          }}
          selectedKeys={selectedItem ? [selectedItem.to] : []}
        >
          {navGroups.map((group) => (
            <SubMenu key={`group:${group.label}`} title={group.label}>
              {group.items.map((item) => renderMenuItem(item, group.label))}
            </SubMenu>
          ))}
        </Menu>

        <div className="sidebar-footer">
          <p>当前账号：{adminUser}</p>
          <Button
            long
            onClick={() => {
              authClient.clearSession();
              navigate("/login", { replace: true });
            }}
            size="small"
          >
            退出登录
          </Button>
        </div>
      </Sider>

      <Content className="app-main">
        <Outlet />
      </Content>
    </Layout>
  );
}
