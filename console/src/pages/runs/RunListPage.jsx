import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import { formatDateTime } from "../../utils/dateTime";

function formatDuration(durationMs) {
  if (typeof durationMs !== "number") {
    return "-";
  }

  return `${durationMs} ms`;
}

function buildStatus(run) {
  if (run.success === false || run.level === "error" || run.errorCode || (run.httpStatus && run.httpStatus >= 400)) {
    return {
      label: "错误",
      className: "tag tag-soft"
    };
  }

  if (run.success === true || run.message === "agent.run.success" || run.message === "agent.run.completed") {
    return {
      label: "成功",
      className: "tag"
    };
  }

  if (run.message === "agent.run.start") {
    return {
      label: "进行中",
      className: "tag tag-neutral"
    };
  }

  return {
    label: "信息",
    className: "tag tag-neutral"
  };
}

function stringifyValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

function shorten(value, maxLength = 96) {
  const text = stringifyValue(value);
  if (!text) {
    return null;
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function buildRequestSummary(item) {
  const bizParams = item.request?.bizParams || {};
  const segments = [];

  if (bizParams.opportunityId) {
    segments.push(`opportunityId=${bizParams.opportunityId}`);
  }

  if (bizParams.rawText) {
    segments.push(`rawText=${shorten(bizParams.rawText, 140)}`);
  }

  if (bizParams.specialCustomOrderNo) {
    segments.push(`specialCustomOrderNo=${bizParams.specialCustomOrderNo}`);
  }

  if (bizParams.customRequirement) {
    segments.push(`customRequirement=${shorten(bizParams.customRequirement, 140)}`);
  }

  if (segments.length > 0) {
    return segments.join(" | ");
  }

  const keys = Array.isArray(item.request?.bizParamKeys) ? item.request.bizParamKeys : [];
  return keys.length > 0 ? `keys=${keys.join(", ")}` : "-";
}

export function RunListPage() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadRuns() {
      setStatus("loading");
      setErrorMessage("");

      try {
        const response = await apiClient.listRuns();
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setStatus("error");
          setErrorMessage(
            response?.payload?.error?.message || "运行列表读取失败。"
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
        setErrorMessage(error.message || "运行列表读取失败。");
      }
    }

    loadRuns();

    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(() => {
    const successCount = items.filter((item) => item.success === true).length;
    const failureCount = items.filter(
      (item) => item.success === false || item.level === "error" || Boolean(item.errorCode)
    ).length;
    const inProgressCount = items.filter(
      (item) => item.success !== true && item.success !== false
    ).length;

    return {
      total: items.length,
      successCount,
      failureCount,
      inProgressCount
    };
  }, [items]);

  return (
    <PageFrame
      eyebrow="运行"
      title="接口调用日志"
      description="从真实 API 日志读取最近请求摘要，每个 requestId 只展示一条汇总记录。"
      actions={<span className="pill">真实接口：GET /api/console/runs</span>}
    >
      <section className="stats-grid">
        <article className="stat-card">
          <span className="meta-label">最近请求数</span>
          <strong>{metrics.total}</strong>
          <p>默认读取最近的接口请求汇总。</p>
        </article>
        <article className="stat-card">
          <span className="meta-label">成功请求</span>
          <strong>{metrics.successCount}</strong>
          <p>本次调用最终返回成功响应的请求数。</p>
        </article>
        <article className="stat-card">
          <span className="meta-label">失败请求</span>
          <strong>{metrics.failureCount}</strong>
          <p>最终返回错误响应的请求数。</p>
        </article>
        <article className="stat-card">
          <span className="meta-label">进行中</span>
          <strong>{metrics.inProgressCount}</strong>
          <p>已开始但还没有落到最终结果事件的请求。</p>
        </article>
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
            <p className="eyebrow">最近请求</p>
            <h4>接口调用摘要</h4>
          </div>
          <span className="pill">
            {status === "loading" ? "加载中" : `${items.length} 条记录`}
          </span>
        </div>

        <div className="runs-table-head">
          <span>事件 / 请求</span>
          <span>场景 / 运行模式</span>
          <span>请求摘要</span>
          <span>结果</span>
          <span>时间</span>
        </div>

        <div className="runs-table-body">
          {items.map((item) => {
            const statusBadge = buildStatus(item);

            return (
              <Link className="run-row" key={item.logId} to={`/runs/${item.runId}`}>
                <div className="run-primary">
                  <strong>{item.messageLabel || item.message || "-"}</strong>
                  <span className="mono-text">{item.requestId || "-"}</span>
                  <p>{item.traceId || "追踪 ID 暂未落盘"}</p>
                </div>

                <div className="run-meta">
                  <span className="meta-value">{item.scene || "-"}</span>
                  <span className="meta-value">
                    {item.requestedMode || "-"} -&gt; {item.effectiveMode || "-"}
                  </span>
                  <span className="meta-value">{item.executionMode || "-"}</span>
                </div>

                <div className="run-meta">
                  <span className="meta-value">{buildRequestSummary(item)}</span>
                </div>

                <div className="run-meta">
                  <span className={statusBadge.className}>{statusBadge.label}</span>
                  <span className="meta-value">
                    {item.httpStatus ? `HTTP ${item.httpStatus}` : "-"}
                  </span>
                  <span className="meta-value">{formatDuration(item.durationMs)}</span>
                  <span className="meta-value">{item.errorCode || "-"}</span>
                </div>

                <div className="run-meta">
                  <span className="meta-value">{formatDateTime(item.timestamp)}</span>
                </div>
              </Link>
            );
          })}

          {status === "ready" && items.length === 0 ? (
            <div className="empty-panel">
              <h4>暂无请求摘要</h4>
              <p>当前日志源没有可展示的接口调用记录。</p>
            </div>
          ) : null}
        </div>
      </section>
    </PageFrame>
  );
}
