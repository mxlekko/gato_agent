import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";

function SummaryCard({ label, value, detail }) {
  return (
    <article className="stat-card">
      <span className="meta-label">{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function DiffCheckItem({ item }) {
  const stateLabel = item.passed === true ? "一致" : item.passed === false ? "不一致" : "未知";

  return (
    <article className="compare-check-card">
      <div className="compare-check-head">
        <strong>{item.label}</strong>
        <span className={`pill ${item.passed === false ? "pill-warm" : ""}`}>{stateLabel}</span>
      </div>
      <p>{item.description}</p>
    </article>
  );
}

export function ShadowComparePage() {
  const { runId } = useParams();
  const [compare, setCompare] = useState(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadCompare() {
      setStatus("loading");
      setErrorMessage("");

      try {
        const response = await apiClient.getShadow(runId);
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setCompare(null);
          setStatus("error");
          setErrorMessage(
            response?.payload?.error?.message || "影子对比读取失败。"
          );
          return;
        }

        setCompare(response?.payload?.data || null);
        setStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setCompare(null);
        setStatus("error");
        setErrorMessage(error.message || "影子对比读取失败。");
      }
    }

    loadCompare();

    return () => {
      active = false;
    };
  }, [runId]);

  const checks = Array.isArray(compare?.diffSummary?.checks)
    ? compare.diffSummary.checks
    : [];
  const differences = Array.isArray(compare?.differences)
    ? compare.differences
    : [];
  const shadowNodeStatuses = Array.isArray(compare?.shadow?.nodeStatuses)
    ? compare.shadow.nodeStatuses
    : [];

  return (
    <PageFrame
      eyebrow="影子对比"
      title={runId}
      description="对比旧链路返回与影子流程返回之间的差异摘要，并跳转到追踪页继续排查。"
      actions={<span className="pill">真实接口：GET /api/console/runs/:runId/shadow</span>}
    >
      {status === "error" ? (
        <section className="section-card">
          <h4>读取失败</h4>
          <p className="muted-text">{errorMessage}</p>
        </section>
      ) : null}

      {compare ? (
        <>
          <section className="stats-grid">
            <SummaryCard
              label="差异校验"
              value={
                compare.available
                  ? compare.diffSummary?.passed === true
                    ? "通过"
                    : "未通过"
                  : "不适用"
              }
              detail={compare.scene || "-"}
            />
            <SummaryCard
              label="差异数量"
              value={
                typeof compare.diffSummary?.differenceCount === "number"
                  ? String(compare.diffSummary.differenceCount)
                  : "-"
              }
              detail={compare.note || "当前只展示日志里已落盘的影子摘要。"}
            />
            <SummaryCard
              label="基线链路"
              value={compare.baseline?.mode || "legacy"}
              detail={`成功=${String(compare.baseline?.success)} / HTTP=${compare.baseline?.httpStatus || "-"}`}
            />
            <SummaryCard
              label="影子链路"
              value={compare.shadow?.mode || "未生成"}
              detail={
                compare.shadow
                  ? `成功=${String(compare.shadow?.resultSuccess)} / 节点=${compare.shadow?.nodeRunCount || 0}`
                  : "当前运行没有影子执行记录"
              }
            />
          </section>

          {!compare.available ? (
            <section className="section-card">
              <div className="callout callout-neutral">
                <strong>当前没有可比较的影子结果</strong>
                <p>{compare.note || "该运行尚未生成影子对比摘要。"}</p>
              </div>
              <div className="compare-link-row">
                <Link className="inline-page-link" to={compare.links?.runDetailPath || `/runs/${runId}`}>
                  返回运行详情
                </Link>
                {compare.links?.baselineTracePath ? (
                  <Link className="inline-page-link" to={compare.links.baselineTracePath}>
                    查看基线追踪
                  </Link>
                ) : null}
              </div>
            </section>
          ) : (
            <>
              <div className="detail-grid">
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">校验项</p>
                      <h4>差异摘要</h4>
                    </div>
                  </div>
                  <div className="compare-check-grid">
                    {checks.map((item) => (
                      <DiffCheckItem key={item.id} item={item} />
                    ))}
                  </div>
                </section>

                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">跳转</p>
                      <h4>继续排查</h4>
                    </div>
                  </div>
                  <div className="compare-link-list">
                    <Link className="inline-page-link" to={compare.links?.runDetailPath || `/runs/${runId}`}>
                      返回运行详情
                    </Link>
                    {compare.links?.baselineTracePath ? (
                      <Link className="inline-page-link" to={compare.links.baselineTracePath}>
                        查看基线追踪
                      </Link>
                    ) : null}
                    {compare.links?.shadowTracePath ? (
                      <Link className="inline-page-link" to={compare.links.shadowTracePath}>
                        查看影子追踪
                      </Link>
                    ) : null}
                  </div>
                  <div className="callout callout-neutral">
                    <strong>节点级差异在追踪页继续展开</strong>
                    <p>本页先给出摘要和关键字段差异，节点执行明细由 FE2-T3 接上。</p>
                  </div>
                </section>
              </div>

              <div className="detail-grid">
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">字段</p>
                      <h4>关键字段差异</h4>
                    </div>
                  </div>
                  {differences.length > 0 ? (
                    <div className="compare-diff-list">
                      {differences.map((item) => (
                        <article className="compare-diff-item" key={item.id}>
                          <div className="compare-diff-head">
                            <strong>{item.label}</strong>
                            <span className={`pill ${item.severity === "high" ? "pill-warm" : ""}`}>
                              {item.severity}
                            </span>
                          </div>
                          <div className="compare-diff-grid">
                            <div className="meta-block">
                              <span className="meta-label">基线</span>
                              <span className="meta-value">{item.baselineValue}</span>
                            </div>
                            <div className="meta-block">
                              <span className="meta-label">影子</span>
                              <span className="meta-value">{item.shadowValue}</span>
                            </div>
                          </div>
                          {item.description ? <p>{item.description}</p> : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="callout callout-success">
                      <strong>当前没有识别到关键字段差异</strong>
                      <p>日志中的影子摘要全部通过，或当前日志尚未持久化更细粒度字段差异。</p>
                    </div>
                  )}
                </section>

                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">节点</p>
                      <h4>影子节点概览</h4>
                    </div>
                  </div>
                  {shadowNodeStatuses.length > 0 ? (
                    <div className="simple-list">
                      {shadowNodeStatuses.map((item, index) => (
                        <div className="simple-list-row" key={`${item.nodeId || "node"}-${index}`}>
                          <div>
                            <span className="meta-label">节点 ID</span>
                            <strong>{item.nodeId || "-"}</strong>
                          </div>
                          <div>
                            <span className="meta-label">状态</span>
                            <strong>{item.status || "-"}</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="callout callout-neutral">
                      <strong>当前没有可展示的节点摘要</strong>
                      <p>日志只保留了 shadow 级别摘要，节点级执行细节请查看 trace 页面。</p>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </>
      ) : status === "loading" ? (
        <section className="section-card">
          <h4>加载中</h4>
          <p className="muted-text">正在读取 shadow 对比摘要...</p>
        </section>
      ) : null}
    </PageFrame>
  );
}
