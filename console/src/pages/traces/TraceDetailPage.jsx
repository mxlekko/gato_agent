import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import { formatDateTime } from "../../utils/dateTime";

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "-";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
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

function summaryText(summary, expectedKey) {
  if (!summary) {
    return "-";
  }

  if (Array.isArray(summary?.[expectedKey])) {
    return summary[expectedKey].length > 0 ? summary[expectedKey].join(", ") : "-";
  }

  return formatValue(summary);
}

function statusTone(status) {
  if (status === "error" || status === "business_error") {
    return "pill-warm";
  }

  if (status === "success") {
    return "";
  }

  return "";
}

export function TraceDetailPage() {
  const { traceId } = useParams();
  const [trace, setTrace] = useState(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadTrace() {
      setStatus("loading");
      setErrorMessage("");

      try {
        const response = await apiClient.getTrace(traceId);
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setTrace(null);
          setStatus("error");
          setErrorMessage(
            response?.payload?.error?.message || "追踪详情读取失败。"
          );
          return;
        }

        setTrace(response?.payload?.data || null);
        setStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setTrace(null);
        setStatus("error");
        setErrorMessage(error.message || "追踪详情读取失败。");
      }
    }

    loadTrace();

    return () => {
      active = false;
    };
  }, [traceId]);

  const nodeRuns = Array.isArray(trace?.nodeRuns) ? trace.nodeRuns : [];
  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  const toolSummary = Array.isArray(trace?.toolSummary) ? trace.toolSummary : [];

  return (
    <PageFrame
	      eyebrow="追踪"
	      title={traceId}
	      description="查看 LangGraph 节点时间线、节点摘要以及工具 / 模型摘要。"
      actions={<span className="pill">真实接口：GET /api/console/traces/:traceId</span>}
    >
      {status === "error" ? (
        <section className="section-card">
          <h4>读取失败</h4>
          <p className="muted-text">{errorMessage}</p>
        </section>
      ) : null}

      {trace ? (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <span className="meta-label">追踪 ID</span>
              <strong>{trace.traceId}</strong>
              <p>{trace.scene || "-"}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">追踪类型</span>
              <strong>{trace.traceKind || "-"}</strong>
              <p>{trace.source || "-"}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">结果</span>
              <strong>
                {trace.result?.success === null || trace.result?.success === undefined
                  ? "未知"
                  : String(Boolean(trace.result?.success))}
              </strong>
              <p>
                HTTP {trace.result?.httpStatus || "-"} / {trace.result?.errorCode || "无错误"}
              </p>
            </article>
            <article className="stat-card">
              <span className="meta-label">节点运行数</span>
              <strong>{nodeRuns.length}</strong>
              <p>{toolSummary.length} 个工具 / 模型摘要</p>
            </article>
          </section>

          <div className="callout callout-neutral">
            <strong>当前追踪数据来源</strong>
            <p>{trace.note}</p>
          </div>

          <div className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">请求</p>
                  <h4>请求与路由摘要</h4>
                </div>
              </div>
              <KeyValueList
                items={[
                  { label: "请求 ID", value: trace.requestId || "-" },
                  { label: "运行 ID", value: trace.runId || "-" },
                  { label: "场景", value: trace.scene || "-" },
                  { label: "开始时间", value: formatDateTime(trace.startedAt) },
                  { label: "完成时间", value: formatDateTime(trace.completedAt) },
                  { label: "请求模式", value: trace.routing?.requestedMode || "-" },
                  { label: "生效模式", value: trace.routing?.effectiveMode || "-" },
                  { label: "执行方式", value: trace.routing?.executionMode || "-" }
                ]}
              />
              {trace.runId ? (
                <div className="compare-link-row">
                  <Link className="inline-page-link" to={`/runs/${trace.runId}`}>
                    返回运行详情
                  </Link>
                </div>
              ) : null}
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">流程</p>
                  <h4>模板与技能</h4>
                </div>
              </div>
              {trace.workflow ? (
                <KeyValueList
                  items={[
                    {
                      label: "模板",
                      value: trace.workflow.template
                        ? `${trace.workflow.template.name}@${trace.workflow.template.version}`
                        : "-"
                    },
                    {
                      label: "技能",
                      value: trace.workflow.skill
                        ? `${trace.workflow.skill.name}@${trace.workflow.skill.version}`
                        : "-"
                    },
	                    {
	                      label: "场景类型",
	                      value: trace.routing?.sceneExecutionType || "-"
	                    }
	                  ]}
                />
	              ) : (
	                <div className="callout callout-neutral">
	                  <strong>当前追踪没有关联到流程模板</strong>
	                  <p>通常意味着当前日志没有记录足够的模板编译信息。</p>
	                </div>
              )}
            </section>
          </div>

          <section className="section-card">
            <div className="section-header">
                <div>
                  <p className="eyebrow">时间线</p>
                  <h4>事件时间线</h4>
                </div>
            </div>
            {timeline.length > 0 ? (
              <div className="simple-list">
                {timeline.map((event) => (
                  <div className="simple-list-row" key={`${event.at}-${event.message}`}>
                    <div>
                      <strong>{event.label}</strong>
                      <p>{event.summary || event.message}</p>
                    </div>
                    <div>
                      <span className={`pill ${statusTone(event.status)}`}>{event.status}</span>
                      <p className="muted-text">{formatDateTime(event.at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-text">当前追踪没有可展示的事件时间线。</p>
            )}
          </section>

          <div className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">工具</p>
                  <h4>工具 / 模型摘要</h4>
                </div>
              </div>
              {toolSummary.length > 0 ? (
                <div className="simple-list">
                  {toolSummary.map((item) => (
                    <div className="simple-list-row" key={`${item.node_id}-${item.toolRole || item.category}`}>
                      <div>
                        <strong>{item.node_id}</strong>
                        <p>
                          {item.category || "-"} / {item.toolRole || "-"}
                        </p>
                      </div>
                      <div>
                        <span className={`pill ${statusTone(item.status)}`}>{item.status}</span>
                        <p className="mono-text">{item.toolRef || item.purpose || item.source}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-text">当前追踪没有可展示的工具 / 模型摘要。</p>
              )}
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">请求</p>
                  <h4>业务参数摘要</h4>
                </div>
              </div>
              <KeyValueList
                items={[
                  { label: "场景", value: trace.request?.scene || "-" },
                  {
                    label: "业务参数键",
                    value: trace.request?.bizParamKeys?.join(", ") || "-"
                  },
                  {
                    label: "业务参数",
                    value: formatValue(trace.request?.bizParams || null)
                  }
                ]}
              />
            </section>
          </div>

          <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">节点</p>
                  <h4>节点执行时间线</h4>
                </div>
              </div>
            {nodeRuns.length > 0 ? (
              <div className="workflow-node-list">
                {nodeRuns.map((nodeRun, index) => (
                  <article className="workflow-node" key={`${nodeRun.node_id}-${index}`}>
                    <div className="workflow-node-step">{index + 1}</div>

                    <div className="workflow-node-body">
                      <div className="workflow-node-head">
                        <div>
                          <h5>{nodeRun.node_id}</h5>
                          <p className="muted-text">
                            {nodeRun.phase || "-"} / {nodeRun.category || "-"} / {nodeRun.toolRole || "无工具角色"}
                          </p>
                        </div>

                        <div className="tag-list">
                          <span className={`pill ${statusTone(nodeRun.status)}`}>{nodeRun.status}</span>
                          <span className="tag tag-neutral">
                            {nodeRun.observed ? "已观测" : "仅契约"}
                          </span>
                        </div>
                      </div>

                      <div className="workflow-node-grid">
                        <div className="meta-block">
                          <span className="meta-label">耗时</span>
                          <span className="meta-value">
                            {typeof nodeRun.duration_ms === "number"
                              ? `${nodeRun.duration_ms} ms`
                              : "-"}
                          </span>
                        </div>
                        <div className="meta-block">
                          <span className="meta-label">摘要来源</span>
                          <span className="meta-value">{nodeRun.source || "-"}</span>
                        </div>
                        <div className="meta-block">
                          <span className="meta-label">输入摘要</span>
                          <span className="meta-value">
                            {summaryText(nodeRun.input_summary, "expectedInputs")}
                          </span>
                        </div>
                        <div className="meta-block">
                          <span className="meta-label">输出摘要</span>
                          <span className="meta-value">
                            {summaryText(nodeRun.output_summary, "expectedOutputs")}
                          </span>
                        </div>
                      </div>

                      {nodeRun.error ? (
                        <div className="callout callout-error">
                          <strong>{nodeRun.error.code || "NODE_ERROR"}</strong>
                          <p>
                            {nodeRun.error.stage || "-"} / HTTP {nodeRun.error.httpStatus || "-"}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="callout callout-neutral">
                <strong>当前追踪没有节点级运行记录</strong>
                <p>这通常意味着当前链路走的是非模板编排或直模，或者节点运行记录还没有持久化。</p>
              </div>
            )}
          </section>
        </>
      ) : status === "loading" ? (
        <section className="section-card">
          <h4>加载中</h4>
          <p className="muted-text">正在读取追踪详情...</p>
        </section>
      ) : null}
    </PageFrame>
  );
}
