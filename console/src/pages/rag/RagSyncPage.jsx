import { useCallback, useEffect, useMemo, useState } from "react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import {
  RagConfirmDialog,
  RagEmptyState,
  RagErrorState,
  RagLoadingState,
  RagStatusBanner
} from "./components";

const DEFAULT_TEXT_TEMPLATE = `案例编号：{code}

历史定制需求：
{customRequest}

历史产品部方案：
{invSolutions}`;

const EMPTY_FORM = {
  name: "",
  dbUrl: "env:RAG_SYNC_DB_URL",
  tableName: "",
  primaryKey: "id",
  updatedAtColumn: "updated_at",
  whereClause: "",
  intervalMinutes: "5",
  batchSize: "100",
  active: false,
  selectColumns: "code\ncustomRequest\ninvSolutions",
  textTemplate: DEFAULT_TEXT_TEMPLATE,
  dictionaryRules: "{}"
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

function syncJobIdOf(job) {
  return job?.syncJobId || job?.id || job?.sync_job_id || "";
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
    minute: "2-digit"
  }).format(date);
}

function redactDbUrl(value) {
  const text = String(value || "");
  if (!text) {
    return "-";
  }
  if (text.startsWith("env:") || text.startsWith("sqlite:///")) {
    return text;
  }
  return text
    .replace(/:\/\/([^:/?#]+):([^@/?#]+)@/, "://$1:<redacted>@")
    .replace(/([?;&](?:password|pwd)=)[^;&]+/gi, "$1<redacted>");
}

function containsPlaintextSecret(value) {
  const text = String(value || "");
  if (!text || text.startsWith("env:") || text.startsWith("sqlite:///")) {
    return false;
  }
  return /:\/\/[^:/?#]+:[^@/?#]+@/.test(text) || /([?;&]|^)(password|pwd)=/i.test(text);
}

function parseSelectColumns(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formFromJob(job) {
  return {
    name: job?.name || "",
    dbUrl: job?.dbUrl || job?.db_url || "env:RAG_SYNC_DB_URL",
    tableName: job?.tableName || job?.table_name || "",
    primaryKey: job?.primaryKey || job?.primary_key || "id",
    updatedAtColumn: job?.updatedAtColumn || job?.updated_at_column || "updated_at",
    whereClause: job?.whereClause || job?.where_clause || "",
    intervalMinutes: String(job?.intervalMinutes || job?.interval_minutes || "5"),
    batchSize: String(job?.batchSize || job?.batch_size || "100"),
    active: Boolean(job?.active),
    selectColumns: Array.isArray(job?.selectColumns || job?.select_columns)
      ? (job.selectColumns || job.select_columns).join("\n")
      : "",
    textTemplate: job?.textTemplate || job?.text_template || DEFAULT_TEXT_TEMPLATE,
    dictionaryRules: JSON.stringify(job?.dictionaryRules || job?.dictionary_rules || {}, null, 2)
  };
}

function buildPayload(form) {
  if (containsPlaintextSecret(form.dbUrl)) {
    throw new Error("数据库连接 URL 请使用 env:VARIABLE_NAME，不能保存明文密码。");
  }
  if (String(form.dbUrl || "").includes("<redacted>")) {
    throw new Error("当前连接串已脱敏，请改为 env:VARIABLE_NAME 后保存。");
  }

  let dictionaryRules;
  try {
    dictionaryRules = JSON.parse(form.dictionaryRules || "{}");
  } catch (error) {
    throw new Error(`字典规则 JSON 不合法：${error.message}`);
  }

  const selectColumns = parseSelectColumns(form.selectColumns);
  if (selectColumns.length === 0) {
    throw new Error("至少填写一个取数字段。");
  }

  return {
    name: form.name.trim(),
    dbUrl: form.dbUrl.trim(),
    tableName: form.tableName.trim(),
    primaryKey: form.primaryKey.trim(),
    updatedAtColumn: form.updatedAtColumn.trim(),
    whereClause: form.whereClause.trim(),
    intervalMinutes: Number(form.intervalMinutes) || 5,
    batchSize: Number(form.batchSize) || 100,
    active: form.active,
    selectColumns,
    textTemplate: form.textTemplate,
    dictionaryRules
  };
}

export function RagSyncPage() {
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [recentRows, setRecentRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const selectedJob = useMemo(
    () => jobs.find((job) => syncJobIdOf(job) === selectedId) || null,
    [jobs, selectedId]
  );

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.listRagDbSyncJobs();
      const data = unwrapResponse(response);
      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    } catch (caughtError) {
      setJobs([]);
      setError(caughtError);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadJobDetail = useCallback(async (syncJobId) => {
    if (!syncJobId) {
      return;
    }

    setActionLoading("detail");
    setNotice(null);

    try {
      const response = await apiClient.getRagDbSyncJob(syncJobId, { stateLimit: 30 });
      const data = unwrapResponse(response);
      setSelectedId(syncJobId);
      setForm(formFromJob(data?.job));
      setRecentRows(Array.isArray(data?.recentRows) ? data.recentRows : []);
      setColumns([]);
    } catch (caughtError) {
      setNotice({ status: "error", title: "读取同步任务失败", detail: caughtError.message });
    } finally {
      setActionLoading("");
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function startCreate() {
    setSelectedId("");
    setForm(EMPTY_FORM);
    setRecentRows([]);
    setColumns([]);
    setNotice(null);
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);

    try {
      const payload = buildPayload(form);
      const response = selectedId
        ? await apiClient.updateRagDbSyncJob(selectedId, payload)
        : await apiClient.createRagDbSyncJob(payload);
      const data = unwrapResponse(response);
      const nextId = data?.syncJobId || syncJobIdOf(data?.job) || selectedId;
      setNotice({
        status: "success",
        title: selectedId ? "同步任务已保存" : "同步任务已创建",
        detail: nextId ? `syncJobId: ${nextId}` : undefined
      });
      await loadJobs();
      if (nextId) {
        await loadJobDetail(nextId);
      }
    } catch (caughtError) {
      setNotice({ status: "error", title: "保存失败", detail: caughtError.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleInspectColumns() {
    if (!selectedId) {
      setNotice({ status: "warning", title: "请先保存任务" });
      return;
    }

    setActionLoading("inspect");
    setNotice(null);

    try {
      const response = await apiClient.inspectRagDbSyncColumns(selectedId);
      const data = unwrapResponse(response);
      setColumns(Array.isArray(data?.columns) ? data.columns : []);
      setNotice({ status: "success", title: "字段读取完成" });
    } catch (caughtError) {
      setColumns([]);
      setNotice({ status: "error", title: "读取字段失败", detail: caughtError.message });
    } finally {
      setActionLoading("");
    }
  }

  async function handleRunNow(resetWatermark = false) {
    if (!selectedId) {
      setNotice({ status: "warning", title: "请先保存任务" });
      return;
    }

    setActionLoading(resetWatermark ? "reset-run" : "run");
    setNotice(null);

    try {
      const response = await apiClient.runRagDbSyncJob(selectedId, { resetWatermark });
      const data = unwrapResponse(response);
      setNotice({
        status: "success",
        title: resetWatermark ? "已重置水位并触发同步" : "已触发同步",
        detail: data?.jobId ? `execution jobId: ${data.jobId}` : undefined
      });
      await loadJobDetail(selectedId);
    } catch (caughtError) {
      setNotice({ status: "error", title: "触发同步失败", detail: caughtError.message });
    } finally {
      setActionLoading("");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return;
    }

    const syncJobId = syncJobIdOf(deleteTarget);
    setActionLoading("delete");
    setNotice(null);

    try {
      const response = await apiClient.deleteRagDbSyncJob(syncJobId);
      unwrapResponse(response);
      setDeleteTarget(null);
      startCreate();
      setNotice({ status: "success", title: "同步任务已删除", detail: deleteTarget.name });
      await loadJobs();
    } catch (caughtError) {
      setNotice({ status: "error", title: "删除失败", detail: caughtError.message });
    } finally {
      setActionLoading("");
    }
  }

  return (
    <PageFrame
      eyebrow="RAG"
      title="数据库同步"
      description="配置业务数据库到 RAG 知识库的增量同步任务。"
      actions={(
        <button className="button-secondary" type="button" onClick={loadJobs}>
          刷新
        </button>
      )}
    >
      {notice ? (
        <RagStatusBanner status={notice.status} title={notice.title} detail={notice.detail} />
      ) : null}

      <div className="rag-sync-layout">
        <section className="section-card">
          <div className="section-header">
            <div>
              <h4>同步任务</h4>
              <p className="section-text">{loading ? "加载中" : `${jobs.length} 个任务`}</p>
            </div>
            <button className="button-secondary button-inline" type="button" onClick={startCreate}>
              新建
            </button>
          </div>

          {loading ? <RagLoadingState label="正在读取同步任务" /> : null}
          {!loading && error ? <RagErrorState error={error} onRetry={loadJobs} /> : null}
          {!loading && !error && jobs.length === 0 ? (
            <RagEmptyState title="暂无同步任务" detail="新建任务后可触发数据库增量同步。" />
          ) : null}
          {!loading && !error && jobs.length > 0 ? (
            <div className="rag-sync-job-list">
              {jobs.map((job) => {
                const syncJobId = syncJobIdOf(job);
                const active = syncJobId === selectedId;

                return (
                  <button
                    className={`rag-sync-job-row${active ? " rag-sync-job-row-active" : ""}`}
                    key={syncJobId}
                    onClick={() => loadJobDetail(syncJobId)}
                    type="button"
                  >
                    <span>
                      <strong>{job.name || "-"}</strong>
                      <em className="mono-text">{syncJobId}</em>
                    </span>
                    <span>
                      <span className={job.active ? "tag tag-success" : "tag tag-neutral"}>
                        {job.active ? "启用" : "停用"}
                      </span>
                      <em>{job.tableName || job.table_name || "-"}</em>
                    </span>
                    <span>
                      <em>成功 {formatDateTime(job.lastSuccessAt || job.last_success_at)}</em>
                      <em>{job.lastError || job.last_error || ""}</em>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        <form className="section-card rag-sync-form" onSubmit={handleSave}>
          <div className="section-header">
            <div>
              <h4>{selectedId ? "编辑任务" : "新建任务"}</h4>
              <p className="section-text">
                {selectedId ? selectedId : "推荐使用 env:RAG_SYNC_DB_URL 管理连接串"}
              </p>
            </div>
            <span className="tag tag-neutral">env:XXX</span>
          </div>

          <div className="rag-sync-form-grid">
            <label className="field-group">
              <span>任务名称</span>
              <input
                className="field-input"
                onChange={(event) => updateForm("name", event.target.value)}
                value={form.name}
              />
            </label>
            <label className="field-group">
              <span>数据库连接 URL</span>
              <input
                className="field-input"
                onChange={(event) => updateForm("dbUrl", event.target.value)}
                type={containsPlaintextSecret(form.dbUrl) ? "password" : "text"}
                value={form.dbUrl}
              />
              <p className="field-help">推荐 `env:VARIABLE_NAME`，页面不会展示已保存的真实密码。</p>
            </label>
            <label className="field-group">
              <span>源表</span>
              <input
                className="field-input"
                onChange={(event) => updateForm("tableName", event.target.value)}
                value={form.tableName}
              />
            </label>
            <label className="field-group">
              <span>主键字段</span>
              <input
                className="field-input"
                onChange={(event) => updateForm("primaryKey", event.target.value)}
                value={form.primaryKey}
              />
            </label>
            <label className="field-group">
              <span>增量水位字段</span>
              <input
                className="field-input"
                onChange={(event) => updateForm("updatedAtColumn", event.target.value)}
                value={form.updatedAtColumn}
              />
            </label>
            <label className="field-group">
              <span>过滤条件</span>
              <input
                className="field-input"
                onChange={(event) => updateForm("whereClause", event.target.value)}
                placeholder="可选，不写 WHERE"
                value={form.whereClause}
              />
            </label>
            <label className="field-group">
              <span>同步间隔</span>
              <input
                className="field-input"
                min="1"
                onChange={(event) => updateForm("intervalMinutes", event.target.value)}
                type="number"
                value={form.intervalMinutes}
              />
            </label>
            <label className="field-group">
              <span>批量大小</span>
              <input
                className="field-input"
                min="1"
                onChange={(event) => updateForm("batchSize", event.target.value)}
                type="number"
                value={form.batchSize}
              />
            </label>
          </div>

          <label className="checkbox-option">
            <input
              checked={form.active}
              onChange={(event) => updateForm("active", event.target.checked)}
              type="checkbox"
            />
            <span>启用定时同步</span>
          </label>

          <label className="field-group">
            <span>取数字段</span>
            <textarea
              className="field-input rag-sync-small-textarea"
              onChange={(event) => updateForm("selectColumns", event.target.value)}
              value={form.selectColumns}
            />
          </label>

          <label className="field-group">
            <span>向量文本模板</span>
            <textarea
              className="field-input field-textarea"
              onChange={(event) => updateForm("textTemplate", event.target.value)}
              value={form.textTemplate}
            />
          </label>

          <label className="field-group">
            <span>字典规则 JSON</span>
            <textarea
              className="field-input field-textarea"
              onChange={(event) => updateForm("dictionaryRules", event.target.value)}
              value={form.dictionaryRules}
            />
          </label>

          <div className="button-row">
            <button className="button-primary" disabled={saving} type="submit">
              {saving ? "保存中" : "保存任务"}
            </button>
            <button
              className="button-secondary"
              disabled={!selectedId || Boolean(actionLoading)}
              onClick={handleInspectColumns}
              type="button"
            >
              {actionLoading === "inspect" ? "读取中" : "读取表字段"}
            </button>
            <button
              className="button-secondary"
              disabled={!selectedId || Boolean(actionLoading)}
              onClick={() => handleRunNow(false)}
              type="button"
            >
              {actionLoading === "run" ? "触发中" : "立即同步"}
            </button>
            <button
              className="button-secondary"
              disabled={!selectedId || Boolean(actionLoading)}
              onClick={() => handleRunNow(true)}
              type="button"
            >
              重置水位并同步
            </button>
            <button
              className="button-secondary"
              disabled={!selectedJob || Boolean(actionLoading)}
              onClick={() => setDeleteTarget(selectedJob)}
              type="button"
            >
              删除
            </button>
          </div>
        </form>
      </div>

      <div className="rag-sync-result-grid">
        <section className="section-card">
          <div className="section-header">
            <div>
              <h4>读取字段</h4>
              <p className="section-text">{columns.length ? `${columns.length} 个字段` : "未读取"}</p>
            </div>
          </div>
          {columns.length === 0 ? (
            <RagEmptyState title="暂无字段" detail="保存任务后可读取源表字段。" />
          ) : (
            <div className="rag-sync-column-list">
              {columns.map((column) => (
                <div className="rag-sync-column-row" key={column["字段名"] || column.name}>
                  <strong>{column["字段名"] || column.name || "-"}</strong>
                  <span>{column["类型"] || column.type || "-"}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="section-card">
          <div className="section-header">
            <div>
              <h4>最近同步记录</h4>
              <p className="section-text">{recentRows.length ? `${recentRows.length} 条记录` : "暂无记录"}</p>
            </div>
            {selectedJob ? <span className="tag tag-neutral">{redactDbUrl(selectedJob.dbUrl || selectedJob.db_url)}</span> : null}
          </div>
          {recentRows.length === 0 ? (
            <RagEmptyState title="暂无同步记录" detail="触发同步后会显示 sourceId、vectorId 和状态。" />
          ) : (
            <div className="rag-sync-state-list">
              {recentRows.map((row, index) => (
                <article className="rag-sync-state-row" key={`${row.source_id || row.sourceId}-${index}`}>
                  <div>
                    <strong>{row.source_id || row.sourceId || "-"}</strong>
                    <em className="mono-text">{row.vector_id || row.vectorId || "-"}</em>
                  </div>
                  <div>
                    <span className={row.sync_status === "synced" ? "tag tag-success" : "tag tag-neutral"}>
                      {row.sync_status || row.syncStatus || "-"}
                    </span>
                    <em>{formatDateTime(row.synced_at || row.syncedAt)}</em>
                  </div>
                  <p>{row.error_message || row.errorMessage || ""}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <RagConfirmDialog
        cancelLabel="取消"
        confirmLabel={actionLoading === "delete" ? "删除中" : "确认删除"}
        detail={deleteTarget ? `将删除同步任务 ${deleteTarget.name || syncJobIdOf(deleteTarget)}。` : ""}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        open={Boolean(deleteTarget)}
        title="删除同步任务"
      />
    </PageFrame>
  );
}
