import { useCallback, useEffect, useState } from "react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import {
  RagEmptyState,
  RagErrorState,
  RagLoadingState,
  RagStatusBanner
} from "./components";

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

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN") : "-";
}

export function RagOverviewPage() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getRagHealth();
      setHealth(unwrapResponse(response));
    } catch (caughtError) {
      setHealth(null);
      setError(caughtError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const serviceOk = health?.service === "ok";

  return (
    <PageFrame
      eyebrow="RAG"
      title="知识库总览"
      description="本地 RAG 服务状态、向量集合和片段规模。"
      actions={(
        <button className="button-secondary" type="button" onClick={loadHealth}>
          刷新
        </button>
      )}
    >
      {loading ? <RagLoadingState label="正在读取 RAG 服务状态" /> : null}

      {!loading && error ? <RagErrorState error={error} onRetry={loadHealth} /> : null}

      {!loading && !error && health ? (
        <>
          <RagStatusBanner
            status={serviceOk ? "success" : "warning"}
            title={serviceOk ? "RAG 服务可用" : "RAG 服务状态异常"}
            detail={`当前集合 ${health.collection || "-"}，embedding ${health.embeddingModel || "-"}`}
          />

          <div className="rag-stat-grid">
            <article className="stat-card">
              <span className="meta-label">服务状态</span>
              <strong>{health.service || "-"}</strong>
              <p>health endpoint</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">Embedding 模型</span>
              <strong>{health.embeddingModel || "-"}</strong>
              <p>当前向量化模型</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">Collection</span>
              <strong className="mono-text">{health.collection || "-"}</strong>
              <p>Chroma 集合</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">Chunk 数</span>
              <strong>{formatNumber(health.chunkCount)}</strong>
              <p>已索引片段</p>
            </article>
          </div>

          <section className="section-card">
            <div className="section-header">
              <div>
                <h4>最近任务</h4>
                <p className="section-text">任务队列接口将在后续批次接入。</p>
              </div>
              <span className="tag tag-neutral">待接入</span>
            </div>
            <RagEmptyState title="暂无任务数据" detail="当前批次只接入 health 和 search。" />
          </section>
        </>
      ) : null}
    </PageFrame>
  );
}
