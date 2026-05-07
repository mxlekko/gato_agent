import { useEffect, useMemo, useState } from "react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import { formatDateTime } from "../../utils/dateTime";

function formatRate(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${Math.round(Number(value) * 100)}%`;
}

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

function AlertList({ alerts = [] }) {
  if (alerts.length === 0) {
	    return (
	      <div className="callout callout-success">
	        <strong>当前没有灰度告警</strong>
	        <p>这批样本没有命中成功率、结构失败率或耗时阈值警报。</p>
	      </div>
	    );
  }

  return (
    <div className="simple-list">
      {alerts.map((alert) => (
        <div className="simple-list-row" key={`${alert.metric}-${alert.message}`}>
          <div>
            <strong>{alert.metric}</strong>
            <p>{alert.message}</p>
          </div>
          <span className="mono-text">{`实际值=${alert.actual} 阈值=${alert.threshold}`}</span>
        </div>
      ))}
    </div>
  );
}

function RunList({ items = [] }) {
  if (items.length === 0) {
    return <p className="muted-text">当前场景暂未观测到灰度运行。</p>;
  }

  return (
    <div className="simple-list">
      {items.map((item) => (
        <div className="simple-list-row" key={item.requestId}>
          <div>
            <strong>{item.requestId}</strong>
            <p>{`${item.requestedMode} -> ${item.effectiveMode} / ${item.finalMessage || "-"}`}</p>
          </div>
          <span className="mono-text">
            {`${item.success ? "成功" : "未成功"} / HTTP=${item.httpStatus || "-"} / ${item.durationMs || "-"}ms`}
          </span>
        </div>
      ))}
    </div>
  );
}

function DecisionList({ decisions = [] }) {
  if (decisions.length === 0) {
    return <p className="muted-text">当前没有预检决策结果。</p>;
  }

  return (
    <div className="simple-list">
      {decisions.map((decision) => (
        <div className="simple-list-row" key={decision.label}>
          <div>
            <strong>{decision.label}</strong>
            <p>{`${decision.requestedMode} -> ${decision.effectiveMode} / ${decision.routeReason}`}</p>
          </div>
          <span className="mono-text">
            {decision.bucket !== null && decision.bucket !== undefined
              ? `分桶=${decision.bucket}`
              : decision.details?.tenantId || decision.details?.userId || "-"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReleaseSummaryCard({ eyebrow, title, release, emptyText }) {
  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h4>{title}</h4>
        </div>
      </div>
      {!release ? (
        <p className="muted-text">{emptyText}</p>
      ) : (
        <>
          <KeyValueList
            items={[
              { label: "Release ID", value: release.releaseId || "-" },
              { label: "状态", value: release.status || "-" },
              { label: "发布时间", value: formatDateTime(release.publishedAt) },
              { label: "创建时间", value: formatDateTime(release.createdAt) },
              { label: "条目数", value: String(release.entryTotal ?? 0) },
              {
                label: "Bundle 校验",
                value: release.validation
                  ? release.validation.valid
                    ? "通过"
                    : `失败 (${release.validation.issueCount || 0})`
                  : "-"
              }
            ]}
          />
          <p className="muted-text">{release.publishNote || "当前没有备注。"}</p>
          {release.validation ? (
            release.validation.valid ? (
              <div className="callout callout-success">
                <strong>Bundle 校验通过</strong>
                <p>{`场景=${release.validation.sceneConfigs?.total ?? 0}，编译预览=${release.validation.compilePreview?.validated ?? 0}。`}</p>
              </div>
            ) : (
              <div className="callout callout-error">
                <strong>Bundle 校验失败</strong>
                <p>
                  {`问题数=${release.validation.issueCount || 0}，问题码=${(release.validation.issues || [])
                    .map((item) => item.code)
                    .filter(Boolean)
                    .join(", ") || "-"}`}
                </p>
              </div>
            )
          ) : null}
        </>
      )}
    </section>
  );
}

function ReleaseHistoryList({ items = [] }) {
  if (items.length === 0) {
    return <p className="muted-text">当前没有 release 历史记录。</p>;
  }

  return (
    <div className="simple-list">
      {items.map((item) => (
        <div className="simple-list-row" key={item.releaseId}>
          <div>
            <strong>{item.releaseId}</strong>
            <p>{`${item.status || "-"} / 创建于 ${formatDateTime(item.createdAt)}`}</p>
          </div>
          <span className="mono-text">
            {`${item.isActive ? "active" : item.isPrevious ? "previous" : "history"} / 条目=${item.entryTotal ?? 0}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function splitCsv(text) {
  return String(text || "")
    .split(/[,\n]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function RolloutPage() {
  const [report, setReport] = useState(null);
  const [releaseStatus, setReleaseStatus] = useState(null);
  const [releaseStatusError, setReleaseStatusError] = useState("");
  const [routing, setRouting] = useState(null);
  const [preview, setPreview] = useState(null);
  const [scene, setScene] = useState("");
  const [status, setStatus] = useState("loading");
  const [previewStatus, setPreviewStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
	  const [formState, setFormState] = useState({
	    mode: "langgraph",
	    requestPercentage: "0",
    tenantAllowlist: "",
    userAllowlist: ""
  });

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setStatus("loading");
      setErrorMessage("");
      setReleaseStatusError("");

      try {
        const reportResponse = await apiClient.getRolloutReport();
        if (!active) {
          return;
        }

        if (!reportResponse?.ok || reportResponse?.payload?.success === false) {
          setStatus("error");
          setErrorMessage(
            reportResponse?.payload?.error?.message || "灰度报告读取失败。"
          );
          return;
        }

        const reportData = reportResponse?.payload?.data || null;
        const sceneOptions = reportData?.sceneOptions || [];
        const defaultScene = (
          sceneOptions.find((item) => Array.isArray(item.allowedModes) && item.allowedModes.includes("langgraph"))
          || sceneOptions[0]
          || {}
        ).scene || "";
        setReport(reportData);
        setScene(defaultScene);

        if (!defaultScene) {
          setStatus("error");
          setErrorMessage("当前没有可查看的场景路由配置。");
          return;
        }

        const [routingResponse, releaseStatusResponse] = await Promise.all([
          apiClient.getSceneRouting(defaultScene),
          apiClient.getReleaseStatus().catch((error) => ({
            ok: false,
            payload: {
              success: false,
              error: {
                message: error.message || "发布状态读取失败。"
              }
            }
          }))
        ]);
        if (!active) {
          return;
        }

        if (!routingResponse?.ok || routingResponse?.payload?.success === false) {
          setStatus("error");
          setErrorMessage(
            routingResponse?.payload?.error?.message || "场景路由摘要读取失败。"
          );
          return;
        }

        const routingData = routingResponse?.payload?.data || null;
        setRouting(routingData);
        if (releaseStatusResponse?.ok && releaseStatusResponse?.payload?.success !== false) {
          setReleaseStatus(releaseStatusResponse?.payload?.data || null);
          setReleaseStatusError("");
        } else {
          setReleaseStatus(null);
          setReleaseStatusError(
            releaseStatusResponse?.payload?.error?.message || "发布状态读取失败。"
          );
        }
	        setFormState({
	          mode: routingData?.current?.routingMode || "langgraph",
          requestPercentage: String(routingData?.cutover?.requestPercentage ?? 0),
          tenantAllowlist: (routingData?.cutover?.tenantAllowlist || []).join(", "),
          userAllowlist: (routingData?.cutover?.userAllowlist || []).join(", ")
        });
        setPreview(null);
        setStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setStatus("error");
        setErrorMessage(error.message || "灰度页面加载失败。");
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  async function loadSceneRouting(nextScene) {
    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await apiClient.getSceneRouting(nextScene);
      if (!response?.ok || response?.payload?.success === false) {
        setRouting(null);
        setStatus("error");
        setErrorMessage(
          response?.payload?.error?.message || "场景路由摘要读取失败。"
        );
        return;
      }

      const routingData = response?.payload?.data || null;
      setRouting(routingData);
	      setFormState({
	        mode: routingData?.current?.routingMode || "langgraph",
        requestPercentage: String(routingData?.cutover?.requestPercentage ?? 0),
        tenantAllowlist: (routingData?.cutover?.tenantAllowlist || []).join(", "),
        userAllowlist: (routingData?.cutover?.userAllowlist || []).join(", ")
      });
      setPreview(null);
      setStatus("ready");
    } catch (error) {
      setRouting(null);
      setStatus("error");
      setErrorMessage(error.message || "场景路由摘要读取失败。");
    }
  }

  async function handleSceneChange(event) {
    const nextScene = event.target.value;
    setScene(nextScene);
    await loadSceneRouting(nextScene);
  }

  async function handlePreviewSubmit(event) {
    event.preventDefault();

    if (!scene) {
      setPreview(null);
      setPreviewStatus("error");
      setErrorMessage("请选择场景后再做灰度预检。");
      return;
    }

    setPreviewStatus("loading");
    setErrorMessage("");

    try {
      const response = await apiClient.previewSceneRoutingChange(scene, {
        mode: formState.mode,
        requestPercentage: Number(formState.requestPercentage || 0),
        tenantAllowlist: splitCsv(formState.tenantAllowlist),
        userAllowlist: splitCsv(formState.userAllowlist)
      });

      if (!response?.ok || response?.payload?.success === false) {
        setPreview(null);
        setPreviewStatus("error");
        setErrorMessage(
          response?.payload?.error?.message || "灰度变更预检失败。"
        );
        return;
      }

      setPreview(response?.payload?.data || null);
      setPreviewStatus("ready");
    } catch (error) {
      setPreview(null);
      setPreviewStatus("error");
      setErrorMessage(error.message || "灰度变更预检失败。");
    }
  }

  const sceneOptions = report?.sceneOptions || [];
  const selectedSceneTitle = useMemo(() => (
    sceneOptions.find((item) => item.scene === scene)?.title || scene || "-"
  ), [scene, sceneOptions]);
	  const allowedModes = routing?.current?.allowedModes || ["langgraph"];
  const cutoverEditable = formState.mode === "langgraph" && allowedModes.includes("langgraph");

  return (
    <PageFrame
      eyebrow="灰度"
      title="灰度切流操作"
      description="查看灰度指标、场景路由摘要，并通过后端预检和审计入口演练灰度切流请求。"
      actions={<span className="pill">真实接口：GET /api/console/releases/status</span>}
    >
      {status === "error" ? (
        <section className="section-card">
          <h4>读取失败</h4>
          <p className="muted-text">{errorMessage}</p>
        </section>
      ) : null}

      {releaseStatusError ? (
        <section className="section-card">
          <h4>发布状态读取失败</h4>
          <p className="muted-text">{releaseStatusError}</p>
        </section>
      ) : null}

      {releaseStatus ? (
        <>
          <section className="detail-grid">
            <ReleaseSummaryCard
              eyebrow="发布"
              title="当前 active release"
              release={releaseStatus.activeRelease}
              emptyText="当前没有 active release。"
            />
            <ReleaseSummaryCard
              eyebrow="版本"
              title="上一版本"
              release={releaseStatus.previousRelease}
              emptyText="当前没有上一版本记录。"
            />
            <ReleaseSummaryCard
              eyebrow="失败"
              title="最近失败发布"
              release={releaseStatus.latestFailedRelease}
              emptyText="最近没有失败发布。"
            />
          </section>

          <section className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">运行态</p>
                  <h4>Current bundle 与 pointer</h4>
                </div>
              </div>
              <KeyValueList
                items={[
                  { label: "环境", value: releaseStatus.scope?.environment || "-" },
                  { label: "Scope", value: `${releaseStatus.scope?.scopeType || "-"} / ${releaseStatus.scope?.scopeValue || "-"}` },
                  { label: "Active 指针", value: releaseStatus.pointer?.activeReleaseId || "-" },
                  { label: "上一版本指针", value: releaseStatus.pointer?.previousReleaseId || "-" },
                  { label: "Current 目标", value: releaseStatus.currentBundle?.symlinkTarget || "-" },
                  {
                    label: "Current 对齐 active",
                    value:
                      releaseStatus.currentBundle?.matchesActiveRelease === true
                        ? "是"
                        : releaseStatus.currentBundle?.matchesActiveRelease === false
                          ? "否"
                          : "-"
                  },
                  { label: "Current 路径", value: releaseStatus.currentBundle?.currentPath || "-" },
                  { label: "解析后路径", value: releaseStatus.currentBundle?.resolvedBundlePath || "-" }
                ]}
              />
              {releaseStatus.currentBundle?.matchesActiveRelease === false ? (
                <div className="callout callout-error">
                  <strong>current bundle 与 active pointer 不一致</strong>
                  <p>当前运行态 bundle 需要人工检查 current symlink 与 release pointer。</p>
                </div>
              ) : (
                <div className="callout callout-success">
                  <strong>current bundle 与 active pointer 一致</strong>
                  <p>{`最近更新：${formatDateTime(releaseStatus.pointer?.updatedAt)}`}</p>
                </div>
              )}
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">历史</p>
                  <h4>最近 release</h4>
                </div>
              </div>
              <ReleaseHistoryList items={releaseStatus.recentReleases || []} />
            </section>
          </section>
        </>
      ) : null}

      {report ? (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <span className="meta-label">成功率</span>
              <strong>{formatRate(report?.rates?.successRate)}</strong>
              <p>{`运行数=${report?.totals?.runs ?? 0}`}</p>
            </article>
	            <article className="stat-card">
	              <span className="meta-label">LangGraph 请求</span>
	              <strong>{report?.totals?.langgraphRuns ?? 0}</strong>
	              <p>统一运行时已观测请求数。</p>
	            </article>
            <article className="stat-card">
              <span className="meta-label">结构失败率</span>
              <strong>{formatRate(report?.rates?.schemaFailureRate)}</strong>
              <p>{`P95=${report?.latency?.p95DurationMs ?? "-"} ms`}</p>
            </article>
	            <article className="stat-card">
	              <span className="meta-label">告警数</span>
	              <strong>{report?.alerts?.length ?? 0}</strong>
	              <p>{`最大耗时=${report?.latency?.maxDurationMs ?? "-"} ms`}</p>
	            </article>
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">告警</p>
                <h4>灰度告警</h4>
              </div>
            </div>
            <AlertList alerts={report?.alerts || []} />
          </section>
        </>
      ) : null}

      {routing ? (
        <>
          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">场景</p>
                <h4>当前场景与路由状态</h4>
              </div>
            </div>
            <div className="form-grid-two">
              <div className="field-group">
                  <label htmlFor="rollout-scene-select">场景</label>
                <select
                  className="field-input"
                  id="rollout-scene-select"
                  onChange={handleSceneChange}
                  value={scene}
                >
                  {sceneOptions.map((item) => (
                    <option key={item.scene} value={item.scene}>
                      {item.title} ({item.scene})
                    </option>
                  ))}
                </select>
                <p className="field-help">当前只允许从已注册场景中选择，不接受前端自由输入。</p>
              </div>
              <div className="field-group">
                <label htmlFor="rollout-scene-title">当前选择</label>
                <input
                  className="field-input"
                  id="rollout-scene-title"
                  readOnly
                  value={selectedSceneTitle}
                />
	                <p className="field-help">当前场景统一按 LangGraph agent-runtime 路由。</p>
              </div>
            </div>
          </section>

          <section className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">路由</p>
                  <h4>当前路由摘要</h4>
                </div>
              </div>
              <KeyValueList
                items={[
	                  { label: "配置模式", value: routing.current?.routingMode || "-" },
	                  { label: "允许模式", value: (routing.current?.allowedModes || []).join(" / ") || "-" },
	                  { label: "生效模式", value: routing.current?.effectiveMode || "-" },
	                  { label: "路由原因", value: routing.current?.routeReason || "-" },
	                  { label: "平台管理", value: routing.current?.platformManagedScene ? "是" : "否" },
	                  { label: "执行方式", value: routing.executionMode || "-" }
                ]}
              />
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">观测</p>
	                  <h4>运行观察</h4>
                </div>
              </div>
              <KeyValueList
                items={[
	                  { label: "运行数", value: String(routing.rollout?.totals?.runs ?? 0) },
	                  { label: "成功率", value: formatRate(routing.rollout?.rates?.successRate) },
	                  { label: "结构失败率", value: formatRate(routing.rollout?.rates?.schemaFailureRate) },
                  { label: "P95 耗时", value: routing.rollout?.latency?.p95DurationMs ? `${routing.rollout.latency.p95DurationMs} ms` : "-" }
                ]}
              />
            </section>
          </section>

          <section className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">切流</p>
                  <h4>当前灰度策略</h4>
                </div>
              </div>
              <KeyValueList
                items={[
                  { label: "请求百分比", value: `${routing.cutover?.requestPercentage ?? 0}%` },
                  { label: "租户白名单", value: (routing.cutover?.tenantAllowlist || []).join(", ") || "-" },
                  { label: "用户白名单", value: (routing.cutover?.userAllowlist || []).join(", ") || "-" },
                  { label: "租户数量", value: String(routing.cutover?.tenantCount ?? 0) }
                ]}
              />
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">最近运行</p>
                  <h4>最近观测请求</h4>
                </div>
              </div>
              <RunList items={routing.rollout?.latestRuns || []} />
            </section>
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">预检</p>
                <h4>受控灰度变更预检</h4>
              </div>
              <span className="pill">真实接口：POST /api/console/routing/scenes/:scene/change-preview</span>
            </div>
            <p className="section-text">
              V1 只做后端校验和审计预检，不直接改场景配置文件，也不绕过策略层落生产变更。
            </p>
            <form className="form-stack" onSubmit={handlePreviewSubmit}>
              <div className="form-grid-two">
                <div className="field-group">
                  <label htmlFor="routing-mode">预检路由模式</label>
                  <select
                    className="field-input"
                    id="routing-mode"
                    onChange={(event) => setFormState((current) => ({
                      ...current,
                      mode: event.target.value
                    }))}
                    value={formState.mode}
                  >
                    {allowedModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="routing-request-percentage">请求百分比</label>
                  <input
                    className="field-input"
                    disabled={!cutoverEditable}
                    id="routing-request-percentage"
                    max="100"
                    min="0"
                    onChange={(event) => setFormState((current) => ({
                      ...current,
                      requestPercentage: event.target.value
                    }))}
                    type="number"
                    value={formState.requestPercentage}
                  />
	                  <p className="field-help">当前只预检 LangGraph 命中策略，不会写回配置。</p>
                </div>
              </div>

              <div className="form-grid-two">
                <div className="field-group">
                  <label htmlFor="routing-tenant-allowlist">租户白名单</label>
                  <input
                    className="field-input"
                    disabled={!cutoverEditable}
                    id="routing-tenant-allowlist"
                    onChange={(event) => setFormState((current) => ({
                      ...current,
                      tenantAllowlist: event.target.value
                    }))}
                    value={formState.tenantAllowlist}
                  />
                  <p className="field-help">逗号分隔，只做预检，不会写回配置。</p>
                </div>
                <div className="field-group">
                  <label htmlFor="routing-user-allowlist">用户白名单</label>
                  <input
                    className="field-input"
                    disabled={!cutoverEditable}
                    id="routing-user-allowlist"
                    onChange={(event) => setFormState((current) => ({
                      ...current,
                      userAllowlist: event.target.value
                    }))}
                    value={formState.userAllowlist}
                  />
                  <p className="field-help">逗号分隔，后端会做统一规范化和审计日志记录。</p>
                </div>
              </div>

              <div className="button-row">
                <button className="button-primary" disabled={previewStatus === "loading"} type="submit">
                  {previewStatus === "loading" ? "预检中..." : "预检灰度变更"}
                </button>
              </div>
            </form>
          </section>

          {preview ? (
            <>
              <section className="detail-grid">
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">预检结果</p>
                      <h4>预检结果</h4>
                    </div>
                  </div>
                  <KeyValueList
                    items={[
                      { label: "当前模式", value: preview.currentRouting?.mode || "-" },
                      { label: "目标模式", value: preview.proposedRouting?.mode || "-" },
                      {
                        label: "请求百分比",
                        value: `${preview.proposedRouting?.langgraphCutover?.requestPercentage ?? 0}%`
                      },
                      {
                        label: "审计请求 ID",
                        value: preview.audit?.requestId || "-"
                      }
                    ]}
                  />
                  {(preview.warnings || []).length > 0 ? (
                    <div className="callout callout-neutral">
                      <strong>预检提示</strong>
                      <p>{preview.warnings.join(" ")}</p>
                    </div>
                  ) : (
                    <div className="callout callout-success">
                      <strong>预检通过</strong>
                      <p>当前变更请求已通过后端校验，并记录了审计事件。</p>
                    </div>
                  )}
                </section>

                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">决策</p>
                      <h4>命中决策样例</h4>
                    </div>
                  </div>
                  <DecisionList decisions={preview.decisions || []} />
                </section>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">原始数据</p>
                    <h4>预检返回</h4>
                  </div>
                </div>
                <div className="code-panel">
                  <pre>{prettyJson(preview)}</pre>
                </div>
              </section>
            </>
          ) : null}
        </>
      ) : null}

      {status === "loading" ? (
        <section className="section-card">
          <h4>正在加载</h4>
          <p className="muted-text">读取真实灰度报告与路由摘要中。</p>
        </section>
      ) : null}
    </PageFrame>
  );
}
