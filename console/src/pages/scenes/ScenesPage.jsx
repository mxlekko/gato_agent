import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { consoleClient, consoleDataMode } from "../../services/clientFactory";

function formatDataMode(mode) {
  return mode === "api" ? "真实接口" : mode === "mock" ? "模拟数据" : mode;
}

function StatCard({ label, value, detail }) {
  return (
    <article className="stat-card">
      <span className="meta-label">{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function formatSceneDraftState(item) {
  return item?.configState?.hasUnpublishedChanges
    ? "草稿未发布"
    : "与当前发布一致";
}

export function ScenesPage() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadScenes() {
      setStatus("loading");
      setErrorMessage("");

      try {
        const response = await consoleClient.listScenes();
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setStatus("error");
          setErrorMessage(
            response?.payload?.error?.message || "场景列表读取失败。"
          );
          return;
        }

        setItems(response?.payload?.data?.items || []);
        setStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setStatus("error");
        setErrorMessage(error.message || "场景列表读取失败。");
      }
    }

    loadScenes();

    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(() => {
    const templateBackedCount = items.filter(
      (item) => item.platformManagedScene
    ).length;
    const shadowReadyCount = items.filter((item) =>
      Array.isArray(item.allowedModes) && item.allowedModes.includes("shadow")
    ).length;

    return {
      total: items.length,
      templateBackedCount,
      legacyOnlyCount: items.length - templateBackedCount,
      shadowReadyCount
    };
  }, [items]);

  return (
    <PageFrame
      eyebrow="场景"
      title="场景 / 流程浏览"
      description="按场景查看当前业务如何映射到流程模板、业务技能、工具绑定和运行模式。"
      actions={<span className="pill">数据模式 {formatDataMode(consoleDataMode)}</span>}
    >
      <section className="stats-grid">
        <StatCard
          label="场景总数"
          value={metrics.total}
          detail="当前控制台先覆盖 V1 迁移范围内的场景。"
        />
        <StatCard
          label="已接模板"
          value={metrics.templateBackedCount}
          detail="可以映射到流程模板的业务场景。"
        />
        <StatCard
          label="仅旧链路"
          value={metrics.legacyOnlyCount}
          detail="仍走旧链路、尚未进入模板编排的场景。"
        />
        <StatCard
          label="支持影子运行"
          value={metrics.shadowReadyCount}
          detail="已在允许模式中开放影子运行的场景。"
        />
      </section>

      {status === "error" ? (
        <section className="section-card">
          <h4>读取失败</h4>
          <p className="muted-text">{errorMessage}</p>
        </section>
      ) : null}

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">注册表</p>
            <h4>场景总览</h4>
          </div>
          <span className="pill">
            {status === "loading" ? "加载中" : `${items.length} 条记录`}
          </span>
        </div>

        <div className="scenes-table-head">
          <span>场景</span>
          <span>执行 / 路由</span>
          <span>模板 / 技能</span>
          <span>数据来源</span>
        </div>

        <div className="scenes-table-body">
          {items.map((item) => (
            <Link className="scene-row" key={item.scene} to={`/scenes/${item.scene}`}>
              <div className="scene-primary">
                <strong>{item.title}</strong>
                <span className="mono-text">{item.scene}</span>
                <p>{item.description}</p>
              </div>

              <div className="scene-meta">
                <span className="tag">{item.executionMode}</span>
                <span className="tag tag-soft">
                  {item.routingMode || "旧链路"}
                </span>
                <span className="meta-value">
                  {item.allowedModes?.join(" / ") || "-"}
                </span>
              </div>

              <div className="scene-meta">
                <span className="meta-value">
                  {item.templateRef
                    ? `${item.templateRef.name}@${item.templateRef.version}`
                    : "仅旧链路"}
                </span>
                <span className="meta-value">
                  {item.skillRef
                    ? `${item.skillRef.name}@${item.skillRef.version}`
                    : "-"}
                </span>
              </div>

              <div className="scene-meta">
                <span className="meta-value">{item.dataSourceLabel || "-"}</span>
                <span className="meta-value">
                  {item.platformManagedScene ? "可编排" : "未纳入模板"}
                </span>
                <span className="meta-value">{formatSceneDraftState(item)}</span>
              </div>
            </Link>
          ))}

          {status === "ready" && items.length === 0 ? (
            <div className="empty-panel">
              <h4>没有场景数据</h4>
              <p>当前数据源没有返回场景列表。</p>
            </div>
          ) : null}
        </div>
      </section>
    </PageFrame>
  );
}
