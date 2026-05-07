import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@arco-design/web-react";
import { IconDelete } from "@arco-design/web-react/icon";
import { Link, useNavigate } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { consoleClient } from "../../services/clientFactory";

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
  if (item?.configState?.publishState === "unpublished" || item?.configState?.hasPublishedSnapshot === false) {
    return "未发布";
  }

  return item?.configState?.hasUnpublishedChanges
    ? "草稿未发布"
    : "与当前发布一致";
}

function readApiError(response, fallbackMessage) {
  return response?.payload?.error?.message || fallbackMessage;
}

function Notice({ notice }) {
  if (!notice) {
    return null;
  }

  const className = {
    success: "callout-success",
    error: "callout-error",
    warning: "callout-neutral"
  }[notice.status] || "callout-neutral";

  return (
    <section className={`callout ${className}`}>
      <strong>{notice.title}</strong>
      {notice.detail ? <p>{notice.detail}</p> : null}
    </section>
  );
}

export function ScenesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deletingScene, setDeletingScene] = useState("");
  const [notice, setNotice] = useState(null);

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

  function openScene(scene) {
    navigate(`/scenes/${scene}`);
  }

  function handleSceneRowKeyDown(event, scene) {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openScene(scene);
    }
  }

  async function handleDeleteScene() {
    if (!deleteTarget) {
      return;
    }

    const target = deleteTarget;
    setDeletingScene(target.scene);
    setNotice(null);
    setDeleteError("");

    try {
      const response = await consoleClient.deleteScene(target.scene);
      if (!response?.ok || response?.payload?.success === false) {
        throw new Error(readApiError(response, "场景删除失败。"));
      }

      setItems((currentItems) => currentItems.filter((item) => item.scene !== target.scene));
      setDeleteError("");
      setDeleteTarget(null);
      setNotice({
        status: "success",
        title: "场景已删除",
        detail: target.title || target.scene
      });
    } catch (error) {
      setNotice({
        status: "error",
        title: "删除失败",
        detail: error.message || "场景删除失败。"
      });
      setDeleteError(error.message || "场景删除失败。");
    } finally {
      setDeletingScene("");
    }
  }

  const metrics = useMemo(() => {
    const templateBackedCount = items.filter(
      (item) => item.platformManagedScene
    ).length;

    return {
      total: items.length,
      templateBackedCount,
      platformManagedCount: items.filter((item) => item.executionMode === "agent-runtime").length
    };
  }, [items]);

  return (
    <PageFrame
      eyebrow="场景"
      title="场景 / 流程浏览"
      description="按场景查看当前业务如何映射到流程模板、业务技能、工具绑定和运行模式。"
      actions={<Link className="button-primary" to="/scenes/new">新增场景</Link>}
    >
      <Notice notice={notice} />

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
          label="统一运行时"
          value={metrics.platformManagedCount}
          detail="通过 agent-runtime / LangGraph 统一选路的场景。"
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
          <span>操作</span>
        </div>

        <div className="scenes-table-body">
          {items.map((item) => (
            <article
              className="scene-row"
              key={item.scene}
              onClick={() => openScene(item.scene)}
              onKeyDown={(event) => handleSceneRowKeyDown(event, item.scene)}
              role="link"
              tabIndex={0}
            >
              <div className="scene-primary">
                <strong>{item.title}</strong>
                <span className="mono-text">{item.scene}</span>
                <p>{item.description}</p>
              </div>

              <div className="scene-meta">
                <span className="tag">{item.executionMode}</span>
                <span className="tag tag-soft">
                  {item.routingMode || "未配置路由"}
                </span>
                <span className="meta-value">
                  {item.allowedModes?.join(" / ") || "-"}
                </span>
              </div>

              <div className="scene-meta">
                <span className="meta-value">
                  {item.templateRef
                    ? `${item.templateRef.name}@${item.templateRef.version}`
                    : "非模板编排"}
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

              <div className="scene-actions">
                <Button
                  disabled={deletingScene === item.scene}
                  htmlType="button"
                  icon={<IconDelete />}
                  loading={deletingScene === item.scene}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteError("");
                    setDeleteTarget(item);
                  }}
                  size="mini"
                  status="danger"
                >
                  删除
                </Button>
              </div>
            </article>
          ))}

          {status === "ready" && items.length === 0 ? (
            <div className="empty-panel">
              <h4>没有场景数据</h4>
              <p>当前数据源没有返回场景列表。</p>
            </div>
          ) : null}
        </div>
      </section>

      <Modal
        cancelButtonProps={{ disabled: Boolean(deletingScene) }}
        cancelText="取消"
        okButtonProps={{
          loading: Boolean(deletingScene),
          status: "danger"
        }}
        okText={deletingScene ? "删除中" : "确认删除"}
        onCancel={() => {
          if (!deletingScene) {
            setDeleteError("");
            setDeleteTarget(null);
          }
        }}
        onOk={handleDeleteScene}
        title="删除场景"
        visible={Boolean(deleteTarget)}
      >
        <p className="modal-detail-text">
          {deleteTarget
            ? `将删除控制台配置中心里的 ${deleteTarget.title || deleteTarget.scene} 场景草稿及其关联资产。`
            : ""}
        </p>
        {deleteError ? (
          <p className="modal-error-text">{deleteError}</p>
        ) : null}
      </Modal>
    </PageFrame>
  );
}
