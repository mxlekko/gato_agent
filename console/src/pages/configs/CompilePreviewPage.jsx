import { useEffect, useMemo, useState } from "react";
import { PageFrame } from "../../components/PageFrame";
import { WorkflowNodeList } from "../workflows/WorkflowNodeList";
import { apiClient } from "../../services/apiClient";

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function KeyValueList({ items }) {
  return (
    <div className="kv-grid">
      {items.map((item) => (
        <div className="meta-block" key={item.label}>
          <span className="meta-label">{item.label}</span>
          <span className="meta-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function renderConditionalEdges(edges = []) {
  if (edges.length === 0) {
    return <p className="muted-text">当前模板没有条件分支。</p>;
  }

  return (
    <div className="simple-list">
      {edges.map((edge) => (
        <div className="simple-list-row" key={`${edge.from}-${edge.to}-${edge.when}`}>
          <div>
            <strong>
              {edge.from} -&gt; {edge.to}
            </strong>
            <p>{edge.description || "未提供描述"}</p>
          </div>
          <span className="mono-text">{edge.when || "-"}</span>
        </div>
      ))}
    </div>
  );
}

function renderTransitions(defaultNextByNodeId = {}) {
  const entries = Object.entries(defaultNextByNodeId);
  if (entries.length === 0) {
    return <p className="muted-text">当前没有默认执行链路。</p>;
  }

  return (
    <div className="simple-list">
      {entries.map(([from, to]) => (
        <div className="simple-list-row" key={`${from}-${to}`}>
          <div>
            <strong>{from}</strong>
            <p>{to ? `默认流转到 ${to}` : "到此收口。"}</p>
          </div>
          <span className="mono-text">{to || "END"}</span>
        </div>
      ))}
    </div>
  );
}

function NodeTagList({ nodeIds = [], emptyMessage }) {
  if (nodeIds.length === 0) {
    return <p className="muted-text">{emptyMessage}</p>;
  }

  return (
    <div className="node-strip">
      {nodeIds.map((nodeId) => (
        <span className="node-chip" key={nodeId}>
          {nodeId}
        </span>
      ))}
    </div>
  );
}

export function CompilePreviewPage() {
  const [sceneOptions, setSceneOptions] = useState([]);
  const [scene, setScene] = useState("");
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setStatus("loading");
      setErrorMessage("");

      try {
        const catalogResponse = await apiClient.getConfigCatalog();
        if (!active) {
          return;
        }

        if (!catalogResponse?.ok || catalogResponse?.payload?.success === false) {
          setPreview(null);
          setStatus("error");
          setErrorMessage(
            catalogResponse?.payload?.error?.message || "配置目录读取失败。"
          );
          return;
        }

        const items = catalogResponse?.payload?.data?.items || [];
        const nextSceneOptions = items
          .filter((item) => item.kind === "skill" && item.scene)
          .map((item) => ({
            scene: item.scene,
            title: item.title || item.scene
          }));
        const defaultScene = nextSceneOptions[0]?.scene || "";

        setSceneOptions(nextSceneOptions);
        setScene(defaultScene);

        if (!defaultScene) {
          setPreview(null);
          setStatus("error");
          setErrorMessage("当前没有可编译预览的业务场景。");
          return;
        }

        const previewResponse = await apiClient.compilePreview({
          scene: defaultScene
        });
        if (!active) {
          return;
        }

        if (!previewResponse?.ok || previewResponse?.payload?.success === false) {
          setPreview(null);
          setStatus("error");
          setErrorMessage(
            previewResponse?.payload?.error?.message || "编译预览失败。"
          );
          return;
        }

        setPreview(previewResponse?.payload?.data || null);
        setStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setPreview(null);
        setStatus("error");
        setErrorMessage(error.message || "编译预览失败。");
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  async function handleCompile(event) {
    event.preventDefault();

    if (!scene) {
      setPreview(null);
      setStatus("error");
      setErrorMessage("请选择场景后再编译预览。");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await apiClient.compilePreview({ scene });
      if (!response?.ok || response?.payload?.success === false) {
        setPreview(null);
        setStatus("error");
        setErrorMessage(
          response?.payload?.error?.message || "编译预览失败。"
        );
        return;
      }

      setPreview(response?.payload?.data || null);
      setStatus("ready");
    } catch (error) {
      setPreview(null);
      setStatus("error");
      setErrorMessage(error.message || "编译预览失败。");
    }
  }

  const currentSceneTitle = useMemo(() => {
    return sceneOptions.find((item) => item.scene === scene)?.title || scene || "-";
  }, [scene, sceneOptions]);

  const disabledNodeIds = preview?.disabledNodeIds || [];
  const overrideNodeIds = preview?.overrideNodeIds || [];
  const replaceableNodeIds = preview?.replaceableNodeIds || [];

  return (
    <PageFrame
      eyebrow="配置"
      title="编译预览"
      description="选择业务场景，查看真实编译结果，包括节点顺序、条件分支、禁用节点和覆盖点。"
      actions={<span className="pill">真实接口：POST /api/console/configs/compile-preview</span>}
    >
      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">预览</p>
            <h4>编译参数</h4>
          </div>
        </div>
        <form className="form-stack" onSubmit={handleCompile}>
          <div className="form-grid-two">
            <div className="field-group">
              <label htmlFor="compile-preview-scene">场景</label>
              <select
                className="field-input"
                id="compile-preview-scene"
                onChange={(event) => setScene(event.target.value)}
                value={scene}
              >
                {sceneOptions.map((item) => (
                  <option key={item.scene} value={item.scene}>
                    {item.title} ({item.scene})
                  </option>
                ))}
              </select>
              <p className="field-help">只从已注册的业务技能场景中选择，避免前端拼接未注册输入。</p>
            </div>
            <div className="field-group">
              <label htmlFor="compile-preview-entry">当前选择</label>
              <input
                className="field-input"
                id="compile-preview-entry"
                readOnly
                value={currentSceneTitle}
              />
              <p className="field-help">编译预览只读展示，不会写回任何配置文件。</p>
            </div>
          </div>

          <div className="button-row">
            <button className="button-primary" disabled={status === "loading"} type="submit">
              {status === "loading" ? "编译中..." : "重新编译预览"}
            </button>
          </div>
        </form>
      </section>

      {status === "error" ? (
        <section className="section-card">
          <h4>编译失败</h4>
          <p className="muted-text">{errorMessage}</p>
        </section>
      ) : null}

      {preview ? (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <span className="meta-label">场景</span>
              <strong>{preview.scene}</strong>
              <p>{preview.skill?.title || "-"}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">模板</span>
              <strong>{`${preview.template?.name || "-"}@${preview.template?.version || "-"}`}</strong>
              <p>{preview.template?.title || "-"}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">启用 / 禁用节点</span>
              <strong>{`${preview.orderedNodeIds?.length || 0} / ${disabledNodeIds.length}`}</strong>
              <p>{`入口=${preview.entryNode || "-"} / 出口=${preview.exitNode || "-"}`}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">覆盖 / 可替换</span>
              <strong>{`${overrideNodeIds.length} / ${replaceableNodeIds.length}`}</strong>
              <p>{`${preview.conditionalEdges?.length || 0} 条条件分支`}</p>
            </article>
          </section>

          <section className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">编译</p>
                  <h4>流程摘要</h4>
                </div>
              </div>
              <KeyValueList
                items={[
                  { label: "场景", value: preview.scene || "-" },
                  {
                    label: "技能引用",
                    value: preview.skill
                      ? `${preview.skill.name}@${preview.skill.version}`
                      : "-"
                  },
                  {
                    label: "入口节点",
                    value: preview.entryNode || "-"
                  },
                  {
                    label: "出口节点",
                    value: preview.exitNode || "-"
                  }
                ]}
              />
              <KeyValueList
                items={[
                  {
                    label: "查询配置",
                    value: preview.workflowBinding?.data_profile?.queryProfileRef || "-"
                  },
                  {
                    label: "提示词资产",
                    value: Object.keys(preview.workflowBinding?.reference_bundle?.catalog?.prompts || {}).join(", ") || "-"
                  },
                  {
                    label: "最大修复轮次",
                    value: String(preview.maxRepairLoops ?? "-")
                  },
                  {
                    label: "模板节点数",
                    value: String(preview.templateNodeIds?.length || 0)
                  }
                ]}
              />
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">顺序</p>
                  <h4>执行顺序</h4>
                </div>
              </div>
              <NodeTagList
                emptyMessage="当前没有编译出的节点顺序。"
                nodeIds={preview.orderedNodeIds || []}
              />
            </section>
          </section>

          <section className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">标记</p>
                  <h4>禁用 / 覆盖 / 可替换节点</h4>
                </div>
              </div>
              <div className="compare-link-list">
                <div className="compare-diff-item">
                  <div className="compare-diff-head">
                    <strong>禁用节点</strong>
                    <span className="pill">{disabledNodeIds.length}</span>
                  </div>
                  <NodeTagList
                    emptyMessage="当前没有被禁用的模板节点。"
                    nodeIds={disabledNodeIds}
                  />
                </div>
                <div className="compare-diff-item">
                  <div className="compare-diff-head">
                    <strong>覆盖节点</strong>
                    <span className="pill">{overrideNodeIds.length}</span>
                  </div>
                  <NodeTagList
                    emptyMessage="当前场景没有节点覆盖。"
                    nodeIds={overrideNodeIds}
                  />
                </div>
                <div className="compare-diff-item">
                  <div className="compare-diff-head">
                    <strong>可替换节点</strong>
                    <span className="pill">{replaceableNodeIds.length}</span>
                  </div>
                  <NodeTagList
                    emptyMessage="当前模板没有开放可替换节点。"
                    nodeIds={replaceableNodeIds}
                  />
                </div>
              </div>
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">分支</p>
                  <h4>条件分支</h4>
                </div>
              </div>
              {renderConditionalEdges(preview.conditionalEdges || [])}
            </section>
          </section>

          <WorkflowNodeList
            nodeOverrides={preview.workflowBinding?.node_overrides || {}}
            nodesById={preview.nodesById || {}}
            orderedNodeIds={preview.orderedNodeIds || []}
          />

          <section className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">流转</p>
                  <h4>默认流转关系</h4>
                </div>
              </div>
              {renderTransitions(preview.defaultNextByNodeId || {})}
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">原始数据</p>
                  <h4>编译结果</h4>
                </div>
              </div>
              <div className="code-panel">
                <pre>{prettyJson(preview)}</pre>
              </div>
            </section>
          </section>
        </>
      ) : null}

      {status === "loading" ? (
        <section className="section-card">
          <h4>正在编译</h4>
          <p className="muted-text">读取真实编译结果中。</p>
        </section>
      ) : null}
    </PageFrame>
  );
}
