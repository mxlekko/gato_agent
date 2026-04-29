import { NavLink, Outlet, useLocation } from "react-router-dom";
import { consoleDataMode } from "../services/clientFactory";

function formatDataMode(mode) {
  return mode === "api" ? "真实接口" : mode === "mock" ? "模拟数据" : mode;
}

const configCatalogItems = [
  { to: "/configs/skills", label: "业务技能" },
  { to: "/configs/templates", label: "流程模板" },
  { to: "/configs/queries", label: "查询服务配置" },
  { to: "/configs/tools", label: "工具配置" }
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

function NavItem({ item, depth = 0, pathname }) {
  if (Array.isArray(item.children) && item.children.length > 0) {
    const submenuActive = item.children.some((child) => isPathActive(pathname, child.to));

    return (
      <div className="nav-submenu">
        <p className={`nav-submenu-label${submenuActive ? " nav-submenu-label-active" : ""}`}>
          {item.label}
        </p>
        <div className="nav-submenu-items">
          {item.children.map((child) => (
            <NavItem
              depth={depth + 1}
              item={child}
              key={child.to}
              pathname={pathname}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <NavLink
      className={({ isActive }) =>
        `nav-link${depth > 0 ? " nav-link-sublevel" : ""}${isActive ? " nav-link-active" : ""}`
      }
      to={item.to}
    >
      {item.label}
    </NavLink>
  );
}

export function ShellLayout() {
  const location = useLocation();
  const currentPort =
    typeof window !== "undefined" && window.location?.port
      ? window.location.port
      : "3200";

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">A</div>
          <div>
            <p className="eyebrow">业务平台</p>
            <h1>业务平台控制台</h1>
          </div>
        </div>

        <div className="sidebar-note">
          <span className="status-chip">开发端口 {currentPort}</span>
          <span className="status-chip status-chip-accent">
            数据模式 {formatDataMode(consoleDataMode)}
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="主导航">
          {navGroups.map((group) => (
            <section key={group.label} className="nav-group">
              <p className="nav-group-title">{group.label}</p>
              <div className="nav-group-items">
                {group.items.map((item) => (
                  <NavItem
                    item={item}
                    key={item.to || item.label}
                    pathname={location.pathname}
                  />
                ))}
              </div>
            </section>
          ))}
        </nav>

        <div className="sidebar-footer">
          <p>当前阶段：FE3-T3</p>
          <p>灰度报告、路由摘要和变更预检已接入，前端 FE3 范围已闭合。</p>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-header">
          <div>
            <p className="eyebrow">内部控制台</p>
            <h2>先把联调、排障、迁移视角放到一个地方</h2>
          </div>
          <div className="header-badges">
            <span className="pill">只读优先</span>
            <span className="pill pill-warm">受控变更</span>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
