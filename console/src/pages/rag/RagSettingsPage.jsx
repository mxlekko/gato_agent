import { useCallback, useEffect, useState } from "react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import {
  RagErrorState,
  RagLoadingState,
  RagStatusBanner
} from "./components";

const EMPTY_FORM = {
  ragServiceBaseUrl: "",
  requestTimeoutMs: "15000",
  defaultTopK: "5",
  embeddingModel: "text-embedding-v4",
  collectionName: "local_rag_mvp__text_embedding_v4",
  sceneBindingsText: "{}"
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

function prettyJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function formFromSettings(settings) {
  const config = settings?.config || {};

  return {
    ragServiceBaseUrl: config.ragServiceBaseUrl || EMPTY_FORM.ragServiceBaseUrl,
    requestTimeoutMs: String(config.requestTimeoutMs || EMPTY_FORM.requestTimeoutMs),
    defaultTopK: String(config.defaultTopK || EMPTY_FORM.defaultTopK),
    embeddingModel: config.embeddingModel || EMPTY_FORM.embeddingModel,
    collectionName: config.collectionName || EMPTY_FORM.collectionName,
    sceneBindingsText: prettyJson(config.sceneBindings)
  };
}

function parseInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} 必须是整数。`);
  }
  return parsed;
}

function buildPayload(form) {
  let sceneBindings;
  try {
    sceneBindings = JSON.parse(form.sceneBindingsText || "{}");
  } catch (error) {
    throw new Error(`场景绑定 JSON 不合法：${error.message}`);
  }

  return {
    ragServiceBaseUrl: form.ragServiceBaseUrl.trim(),
    requestTimeoutMs: parseInteger(form.requestTimeoutMs, "请求超时"),
    defaultTopK: parseInteger(form.defaultTopK, "默认 Top K"),
    embeddingModel: form.embeddingModel.trim(),
    collectionName: form.collectionName.trim(),
    sceneBindings
  };
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

function KeyStatusTag({ configured }) {
  return (
    <span className={configured ? "tag tag-success" : "tag tag-warning"}>
      {configured ? "已配置" : "未配置"}
    </span>
  );
}

export function RagSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getRagSettings();
      const data = unwrapResponse(response);
      setSettings(data);
      setForm(formFromSettings(data));
    } catch (caughtError) {
      setSettings(null);
      setError(caughtError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);

    try {
      const payload = buildPayload(form);
      const response = await apiClient.updateRagSettings(payload);
      const data = unwrapResponse(response);
      setSettings(data);
      setForm(formFromSettings(data));
      setNotice({
        status: "success",
        title: "RAG 设置已保存",
        detail: data?.currentRevisionId ? `revision ${data.currentRevisionId}` : data?.storagePath
      });
    } catch (caughtError) {
      setNotice({ status: "error", title: "保存失败", detail: caughtError.message });
    } finally {
      setSaving(false);
    }
  }

  const readOnly = settings?.readOnly || {};

  return (
    <PageFrame
      eyebrow="RAG"
      title="RAG 设置"
      description="维护非敏感 RAG 配置，密钥仍由环境变量管理。"
      actions={(
        <button className="button-secondary" type="button" onClick={loadSettings}>
          刷新
        </button>
      )}
    >
      {notice ? (
        <RagStatusBanner status={notice.status} title={notice.title} detail={notice.detail} />
      ) : null}

      {loading ? <RagLoadingState label="正在读取 RAG 设置" /> : null}

      {!loading && error ? <RagErrorState error={error} onRetry={loadSettings} /> : null}

      {!loading && !error ? (
        <>
          <section className="section-card">
            <div className="section-header">
              <div>
                <h4>密钥与运行信息</h4>
                <p className="section-text">页面只读取配置状态，不展示或保存密钥值。</p>
              </div>
              <span className="tag tag-neutral">{settings?.storageTable || "cfg_platform_resources"}</span>
            </div>
            <div className="rag-stat-grid">
              <article className="stat-card">
                <span className="meta-label">DASHSCOPE_API_KEY</span>
                <strong><KeyStatusTag configured={readOnly.dashscopeApiKeyConfigured} /></strong>
                <p>Embedding 与重建索引</p>
              </article>
              <article className="stat-card">
                <span className="meta-label">Chat API Key</span>
                <strong><KeyStatusTag configured={readOnly.chatApiKeyConfigured} /></strong>
                <p>CHAT_API_KEY / 网关密钥</p>
              </article>
              <article className="stat-card">
                <span className="meta-label">Python 服务版本</span>
                <strong>{readOnly.pythonServiceVersion || "-"}</strong>
                <p>只读状态</p>
              </article>
              <article className="stat-card">
                <span className="meta-label">Chroma 目录</span>
                <strong className="mono-text">{readOnly.chromaPersistDirectory || "-"}</strong>
                <p>不写入 Git</p>
              </article>
            </div>
          </section>

          <form className="section-card form-stack" onSubmit={handleSave}>
            <div className="section-header">
              <div>
                <h4>非敏感配置</h4>
                <p className="section-text">
                  拆分策略已移动到文档上传流程；这里仅维护全局服务与检索配置。
                </p>
              </div>
              <span className="tag tag-neutral">更新于 {formatDateTime(settings?.updatedAt)}</span>
            </div>

            <div className="form-grid-two">
              <label className="field-group">
                <span>RAG 服务地址</span>
                <input
                  className="field-input"
                  onChange={(event) => updateForm("ragServiceBaseUrl", event.target.value)}
                  value={form.ragServiceBaseUrl}
                />
                <p className="field-help">仅允许本机 http loopback 地址；Docker 部署允许 rag 服务名。</p>
              </label>
              <label className="field-group">
                <span>请求超时 ms</span>
                <input
                  className="field-input"
                  min="1000"
                  onChange={(event) => updateForm("requestTimeoutMs", event.target.value)}
                  type="number"
                  value={form.requestTimeoutMs}
                />
              </label>
              <label className="field-group">
                <span>默认 Top K</span>
                <input
                  className="field-input"
                  max="10"
                  min="1"
                  onChange={(event) => updateForm("defaultTopK", event.target.value)}
                  type="number"
                  value={form.defaultTopK}
                />
              </label>
              <label className="field-group">
                <span>Embedding 模型</span>
                <input
                  className="field-input"
                  onChange={(event) => updateForm("embeddingModel", event.target.value)}
                  value={form.embeddingModel}
                />
              </label>
              <label className="field-group">
                <span>Collection</span>
                <input
                  className="field-input"
                  onChange={(event) => updateForm("collectionName", event.target.value)}
                  value={form.collectionName}
                />
              </label>
              <label className="field-group">
                <span>场景绑定 JSON</span>
                <textarea
                  className="field-input field-textarea rag-sync-small-textarea"
                  onChange={(event) => updateForm("sceneBindingsText", event.target.value)}
                  value={form.sceneBindingsText}
                />
                <p className="field-help">
                  格式：<span className="mono-text">{"{\"scene\":{\"knowledgeBase\":\"collection\"}}"}</span>
                </p>
              </label>
            </div>

            <div className="button-row">
              <button className="button-primary" disabled={saving} type="submit">
                {saving ? "保存中" : "保存设置"}
              </button>
              <button className="button-secondary" disabled={saving} onClick={loadSettings} type="button">
                取消修改
              </button>
            </div>
          </form>
        </>
      ) : null}
    </PageFrame>
  );
}
