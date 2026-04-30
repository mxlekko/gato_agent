import { useCallback, useEffect, useMemo, useState } from "react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import {
  RagEmptyState,
  RagErrorState,
  RagLoadingState,
  RagStatusBanner
} from "./components";

const JOB_TYPE_LABELS = {
  document_import: "文档导入",
  document_reindex: "文档重建",
  full_reindex: "全量重建",
  db_sync: "数据库同步"
};

const JOB_STATUS_LABELS = {
  pending: "等待中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消"
};

function extractError(response) {
  const error = response?.payload?.error;
  return error?.message || `请求失败，HTTP ${response?.status || "unknown"}`;
}

function unwrapResponse(response) {
  if (!response.ok || response.payload?.success === false) {
    throw new Error(extractError(response));
  }

  return response.payload?.data || null;
}

function jobIdOf(job) {
  return job?.jobId || job?.job_id || "";
}

function jobTypeOf(job) {
  return job?.type || job?.jobType || job?.job_type || "";
}

function jobLabel(job) {
  const type = jobTypeOf(job);
  return JOB_TYPE_LABELS[type] || type || "-";
}

function statusLabel(status) {
  return JOB_STATUS_LABELS[status] || status || "-";
}

function statusClass(status) {
  if (status === "succeeded") {
    return "tag tag-success";
  }
  if (status === "failed" || status === "cancelled") {
    return "tag tag-danger";
  }
  if (status === "running") {
    return "tag tag-warning";
  }
  return "tag tag-neutral";
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function progressOf(job) {
  const value = Number(job?.progress);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function prettyJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

export function RagJobsPage() {
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const activeCount = useMemo(
    () => jobs.filter((job) => ["pending", "running"].includes(job.status)).length,
    [jobs]
  );

  const failedCount = useMemo(
    () => jobs.filter((job) => job.status === "failed").length,
    [jobs]
  );

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.listRagJobs({
        limit: 50,
        status: statusFilter,
        type: typeFilter
      });
      const data = unwrapResponse(response);
      const nextJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      setJobs(nextJobs);
      setTotal(Number.isFinite(Number(data?.total)) ? Number(data.total) : nextJobs.length);
      setSelectedJob((currentJob) => {
        if (!currentJob) {
          return currentJob;
        }
        return nextJobs.some((job) => jobIdOf(job) === jobIdOf(currentJob)) ? currentJob : null;
      });
    } catch (caughtError) {
      setJobs([]);
      setTotal(0);
      setError(caughtError);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  async function handleSelectJob(job) {
    const jobId = jobIdOf(job);
    if (!jobId) {
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    setSelectedJob(job);

    try {
      const response = await apiClient.getRagJob(jobId);
      const data = unwrapResponse(response);
      setSelectedJob(data?.job || job);
    } catch (caughtError) {
      setDetailError(caughtError);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <PageFrame
      eyebrow="RAG"
      title="任务队列"
      description="查看文档导入、索引重建和同步任务状态。"
      actions={(
        <button className="button-secondary" type="button" onClick={loadJobs}>
          刷新
        </button>
      )}
    >
      <div className="rag-stat-grid">
        <article className="stat-card">
          <span className="meta-label">当前筛选</span>
          <strong>{total}</strong>
          <p>任务记录</p>
        </article>
        <article className="stat-card">
          <span className="meta-label">进行中</span>
          <strong>{activeCount}</strong>
          <p>pending / running</p>
        </article>
        <article className="stat-card">
          <span className="meta-label">失败</span>
          <strong>{failedCount}</strong>
          <p>需要人工查看错误信息</p>
        </article>
        <article className="stat-card">
          <span className="meta-label">更新时间</span>
          <strong>{formatDateTime(jobs[0]?.updatedAt || jobs[0]?.updated_at)}</strong>
          <p>最新任务</p>
        </article>
      </div>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h4>筛选</h4>
            <p className="section-text">按任务类型和状态查看队列。</p>
          </div>
          <span className="tag tag-neutral">Jobs</span>
        </div>
        <div className="rag-jobs-filter-row">
          <label className="field-group">
            <span>类型</span>
            <select
              className="field-input"
              onChange={(event) => setTypeFilter(event.target.value)}
              value={typeFilter}
            >
              <option value="">全部</option>
              <option value="document_import">文档导入</option>
              <option value="document_reindex">文档重建</option>
              <option value="full_reindex">全量重建</option>
              <option value="db_sync">数据库同步</option>
            </select>
          </label>
          <label className="field-group">
            <span>状态</span>
            <select
              className="field-input"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="">全部</option>
              <option value="pending">等待中</option>
              <option value="running">执行中</option>
              <option value="succeeded">已完成</option>
              <option value="failed">失败</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
          <div className="button-row rag-jobs-filter-actions">
            <button className="button-primary" type="button" onClick={loadJobs}>
              应用
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => {
                setTypeFilter("");
                setStatusFilter("");
              }}
            >
              重置
            </button>
          </div>
        </div>
      </section>

      {loading ? <RagLoadingState label="正在读取任务队列" /> : null}
      {!loading && error ? <RagErrorState error={error} onRetry={loadJobs} /> : null}

      {!loading && !error ? (
        <div className="rag-jobs-layout">
          <section className="section-card">
            <div className="section-header">
              <div>
                <h4>任务列表</h4>
                <p className="section-text">{total} 条记录</p>
              </div>
            </div>

            {jobs.length === 0 ? (
              <RagEmptyState title="暂无任务" detail="触发重建索引后会出现任务记录。" />
            ) : (
              <div className="rag-jobs-table">
                <div className="rag-jobs-table-head">
                  <span>任务</span>
                  <span>状态</span>
                  <span>进度</span>
                  <span>更新时间</span>
                </div>
                <div className="rag-jobs-table-body">
                  {jobs.map((job) => {
                    const progress = progressOf(job);
                    const active = selectedJob && jobIdOf(job) === jobIdOf(selectedJob);

                    return (
                      <button
                        className={`rag-job-row${active ? " rag-job-row-active" : ""}`}
                        key={jobIdOf(job)}
                        onClick={() => handleSelectJob(job)}
                        type="button"
                      >
                        <span>
                          <strong>{jobLabel(job)}</strong>
                          <em className="mono-text">{jobIdOf(job)}</em>
                          <em>{job.message || "-"}</em>
                        </span>
                        <span>
                          <span className={statusClass(job.status)}>
                            {statusLabel(job.status)}
                          </span>
                        </span>
                        <span className="rag-progress-cell">
                          <span className="rag-progress-track">
                            <span style={{ width: `${progress}%` }} />
                          </span>
                          <em>{progress}%</em>
                        </span>
                        <span>{formatDateTime(job.updatedAt || job.updated_at)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <h4>任务详情</h4>
                <p className="section-text">
                  {selectedJob ? jobIdOf(selectedJob) : "未选择任务"}
                </p>
              </div>
              {selectedJob ? (
                <span className={statusClass(selectedJob.status)}>
                  {statusLabel(selectedJob.status)}
                </span>
              ) : null}
            </div>

            {!selectedJob ? (
              <RagEmptyState title="请选择任务" detail="点击左侧任务查看 payload、result 和错误信息。" />
            ) : null}
            {selectedJob && detailLoading ? <RagLoadingState label="正在读取任务详情" /> : null}
            {selectedJob && !detailLoading && detailError ? (
              <RagErrorState error={detailError} onRetry={() => handleSelectJob(selectedJob)} />
            ) : null}
            {selectedJob && !detailLoading ? (
              <>
                <RagStatusBanner
                  status={selectedJob.status === "failed" ? "error" : "neutral"}
                  title={selectedJob.message || jobLabel(selectedJob)}
                  detail={`创建 ${formatDateTime(selectedJob.createdAt || selectedJob.created_at)}，更新 ${formatDateTime(selectedJob.updatedAt || selectedJob.updated_at)}`}
                />
                <div className="rag-detail-meta-grid">
                  <div>
                    <span className="meta-label">类型</span>
                    <strong>{jobLabel(selectedJob)}</strong>
                  </div>
                  <div>
                    <span className="meta-label">状态</span>
                    <strong>{statusLabel(selectedJob.status)}</strong>
                  </div>
                  <div>
                    <span className="meta-label">进度</span>
                    <strong>{progressOf(selectedJob)}%</strong>
                  </div>
                  <div>
                    <span className="meta-label">任务 ID</span>
                    <strong className="mono-text">{jobIdOf(selectedJob)}</strong>
                  </div>
                </div>
                {selectedJob.error ? (
                  <RagStatusBanner
                    status="error"
                    title={selectedJob.error.code || "任务错误"}
                    detail={selectedJob.error.message || prettyJson(selectedJob.error)}
                  />
                ) : null}
                <div className="rag-job-json-grid">
                  <div>
                    <span className="meta-label">Payload</span>
                    <pre className="rag-json-block">{prettyJson(selectedJob.payload)}</pre>
                  </div>
                  <div>
                    <span className="meta-label">Result</span>
                    <pre className="rag-json-block">{prettyJson(selectedJob.result)}</pre>
                  </div>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </PageFrame>
  );
}
