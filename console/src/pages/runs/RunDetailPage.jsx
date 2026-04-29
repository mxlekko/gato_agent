import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import { formatDateTime } from "../../utils/dateTime";

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

export function RunDetailPage() {
  const { runId } = useParams();
  const [run, setRun] = useState(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadRun() {
      setStatus("loading");
      setErrorMessage("");

      try {
        const response = await apiClient.getRun(runId);
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setRun(null);
          setStatus("error");
          setErrorMessage(
            response?.payload?.error?.message || "运行详情读取失败。"
          );
          return;
        }

        setRun(response?.payload?.data || null);
        setStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setRun(null);
        setStatus("error");
        setErrorMessage(error.message || "运行详情读取失败。");
      }
    }

    loadRun();

    return () => {
      active = false;
    };
  }, [runId]);

  return (
    <PageFrame
      eyebrow="运行详情"
      title={runId}
      description="查看单次请求的运行模式、结果状态、错误摘要，以及日志里可恢复的请求与响应摘要。"
      actions={<span className="pill">真实接口：GET /api/console/runs/:runId</span>}
    >
      {status === "error" ? (
        <section className="section-card">
          <h4>读取失败</h4>
          <p className="muted-text">{errorMessage}</p>
        </section>
      ) : null}

      {run ? (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <span className="meta-label">请求 ID</span>
              <strong>{run.requestId}</strong>
              <p>{run.request?.scene || "-"}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">HTTP 状态</span>
              <strong>{run.result?.httpStatus || "-"}</strong>
              <p>{run.result?.success ? "成功" : "未成功"}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">执行耗时</span>
              <strong>
                {typeof run.result?.durationMs === "number"
                  ? `${run.result.durationMs} ms`
                  : "-"}
              </strong>
              <p>{formatDateTime(run.completedAt || run.startedAt)}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">影子运行</span>
              <strong>{run.shadow?.available ? "已生成" : "未生成"}</strong>
              <p>{run.shadow?.shadowRunId || "当前日志未识别到 shadow runId"}</p>
              <Link className="inline-page-link" to={`/runs/${runId}/shadow`}>
                查看影子对比
              </Link>
            </article>
          </section>

          <div className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">请求</p>
                  <h4>请求摘要</h4>
                </div>
              </div>
              <KeyValueList
                items={[
                  { label: "场景", value: run.request?.scene || "-" },
                  {
                    label: "追踪 ID",
                    value: run.traceId || "日志中暂未记录"
                  },
                  {
                    label: "开始时间",
                    value: formatDateTime(run.startedAt)
                  },
                  {
                    label: "完成时间",
                    value: formatDateTime(run.completedAt)
                  }
                ]}
              />
              <div className="code-panel">
                <pre>{prettyJson(run.request)}</pre>
              </div>
              {run.traceId ? (
                <div className="compare-link-row">
                  <Link className="inline-page-link" to={`/traces/${run.traceId}`}>
                    查看追踪详情
                  </Link>
                </div>
              ) : null}
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">路由</p>
                  <h4>运行模式</h4>
                </div>
              </div>
              <KeyValueList
                items={[
                  {
                    label: "请求模式",
                    value: run.route?.requestedMode || "-"
                  },
                  {
                    label: "生效模式",
                    value: run.route?.effectiveMode || "-"
                  },
                  {
                    label: "执行方式",
                    value: run.route?.executionMode || "-"
                  },
                  {
                    label: "触发回退",
                    value: String(Boolean(run.route?.fallbackTriggered))
                  }
                ]}
              />
            </section>
          </div>

          <div className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">结果</p>
                  <h4>最终结果与接口响应</h4>
                </div>
              </div>
              <KeyValueList
                items={[
                  {
                    label: "是否成功",
                    value: String(Boolean(run.result?.success))
                  },
                  {
                    label: "HTTP 状态",
                    value: String(run.result?.httpStatus || "-")
                  },
                  {
                    label: "最终消息",
                    value: run.result?.finalMessage || "-"
                  },
                  {
                    label: "响应已落盘",
                    value: run.result?.responseEnvelopeAvailable ? "是" : "否"
                  }
                ]}
              />
              {run.result?.responseEnvelopeAvailable ? (
                <>
                  <div className="callout callout-success">
                    <strong>已恢复接口响应参数</strong>
                    <p>当前 run 的最终响应包已经写入运行日志，可直接在这里查看。</p>
                  </div>
                  <div className="code-panel">
                    <pre>{prettyJson(run.responseEnvelope)}</pre>
                  </div>
                </>
              ) : (
                <div className="callout callout-neutral">
                  <strong>当前还没有接口响应参数</strong>
                  <p>这条 run 生成时还未记录 response envelope。重启 API 后发起的新请求会在这里展示完整返回包。</p>
                </div>
              )}
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">错误</p>
                  <h4>错误摘要</h4>
                </div>
              </div>
              {run.error ? (
                <>
                  <KeyValueList
                    items={[
                      { label: "错误码", value: run.error.code || "-" },
                      { label: "阶段", value: run.error.stage || "-" },
                      {
                        label: "HTTP 状态",
                        value: String(run.error.httpStatus || "-")
                      }
                    ]}
                  />
                  <div className="callout callout-error">
                    <strong>{run.error.code}</strong>
                    <p>{run.error.stage || "未记录具体阶段。"}</p>
                  </div>
                </>
              ) : (
                <div className="callout callout-success">
                  <strong>没有错误摘要</strong>
                  <p>当前记录在聚合层面判定为成功完成。</p>
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}

      {status === "loading" ? (
        <section className="section-card">
          <h4>正在加载</h4>
          <p className="muted-text">读取当前 run 的真实聚合详情中。</p>
        </section>
      ) : null}
    </PageFrame>
  );
}
