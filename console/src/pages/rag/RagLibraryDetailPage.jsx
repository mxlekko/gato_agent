import { useCallback, useEffect, useState } from "react";
import { Button, Card, Tag } from "@arco-design/web-react";
import { IconEdit } from "@arco-design/web-react/icon";
import { useNavigate, useParams } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import {
  RagEmptyState,
  RagErrorState,
  RagLoadingState
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

function fileNameOf(document) {
  return document?.fileName || document?.file_name || "-";
}

function docIdOf(document) {
  return document?.docId || document?.doc_id || "";
}

function sourceTypeOf(document) {
  const sourceType = document?.sourceType || document?.source_type || "";
  if (sourceType) {
    return String(sourceType).toLowerCase();
  }

  const match = fileNameOf(document).toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : "";
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN") : "-";
}

function formatFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function chunkIdOf(chunk, index) {
  return chunk?.chunkId || chunk?.chunk_id || `chunk-${index}`;
}

function chunkIndexOf(chunk, index) {
  return Number.isFinite(Number(chunk?.chunkIndex ?? chunk?.chunk_index))
    ? Number(chunk?.chunkIndex ?? chunk?.chunk_index)
    : index;
}

function chunkCharCountOf(chunk) {
  return chunk?.charCount ?? chunk?.char_count ?? chunk?.metadata?.char_count ?? "";
}

function indexStatusLabel(status) {
  const labels = {
    indexed: "已索引",
    stale: "需重建",
    not_indexed: "未索引"
  };
  return labels[status] || status || "-";
}

function indexStatusColor(status) {
  if (status === "indexed") {
    return "green";
  }
  if (status === "stale") {
    return "orange";
  }
  return "gray";
}

function IndexStatusTag({ status }) {
  return (
    <Tag bordered color={indexStatusColor(status)}>
      {indexStatusLabel(status)}
    </Tag>
  );
}

function OriginalFilePreview({ content, manifest }) {
  const docId = docIdOf(manifest);
  const sourceType = sourceTypeOf(manifest);
  const previewUrl = docId ? apiClient.getRagDocumentOriginalUrl(docId) : "";
  const isImage = ["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(sourceType);
  const isPdf = sourceType === "pdf";
  const isText = ["md", "markdown", "txt"].includes(sourceType);
  const isDocx = sourceType === "docx";

  return (
    <Card className="section-card rag-document-source-card" bordered>
      <div className="section-header">
        <div>
          <h4>上传原件</h4>
          <p className="section-text">
            {fileNameOf(manifest)} / {sourceType ? sourceType.toUpperCase() : "-"} / {formatFileSize(manifest?.fileSize ?? manifest?.file_size)}
          </p>
        </div>
        {previewUrl ? (
          <a className="button-secondary button-inline" href={previewUrl} rel="noreferrer" target="_blank">
            打开原件
          </a>
        ) : null}
      </div>

      {!previewUrl ? (
        <RagEmptyState title="暂无原件" detail="没有可预览的上传原件。" />
      ) : null}

      {previewUrl && isImage ? (
        <div className="rag-document-source-image-wrap">
          <img alt={fileNameOf(manifest)} className="rag-document-source-image" src={previewUrl} />
        </div>
      ) : null}

      {previewUrl && (isPdf || isText) ? (
        <iframe
          className="rag-document-source-frame"
          src={previewUrl}
          title={`${fileNameOf(manifest)} 原件预览`}
        />
      ) : null}

      {previewUrl && isDocx ? (
        <div className="rag-document-source-fallback">
          <p>DOCX 原件已解析为在线预览；浏览器原生不支持直接嵌入 Word 文件，可点击右上角打开原件。</p>
          <pre>{content || ""}</pre>
        </div>
      ) : null}

      {previewUrl && !isImage && !isPdf && !isText && !isDocx ? (
        <div className="rag-document-source-fallback">
          <p>当前文件类型无法直接在线预览，可点击右上角打开原件。</p>
        </div>
      ) : null}
    </Card>
  );
}

export function RagLibraryDetailPage() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const manifest = detail?.manifest || null;

  const loadDetail = useCallback(async () => {
    if (!docId) {
      setError(new Error("缺少文档 ID。"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [detailResponse, chunksResponse] = await Promise.all([
        apiClient.getRagDocument(docId),
        apiClient.listRagDocumentChunks(docId, { limit: 1000 })
      ]);
      const detailData = unwrapResponse(detailResponse);
      const chunksData = unwrapResponse(chunksResponse);
      setDetail(detailData);
      setChunks(Array.isArray(chunksData?.chunks) ? chunksData.chunks : []);
    } catch (caughtError) {
      setDetail(null);
      setChunks([]);
      setError(caughtError);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  return (
    <main className="rag-document-standalone-page">
      <PageFrame
        eyebrow="RAG"
        title="文档详情"
        description={manifest ? `${fileNameOf(manifest)} / ${docIdOf(manifest)}` : "原文与拆分片段对照。"}
        actions={manifest ? (
          <Button
            icon={<IconEdit />}
            onClick={() => navigate(`/rag/library/${encodeURIComponent(docIdOf(manifest))}/edit`)}
            type="primary"
          >
            编辑
          </Button>
        ) : null}
      >
        {loading ? <RagLoadingState label="正在读取文档详情" /> : null}
        {!loading && error ? (
          <RagErrorState error={error} onRetry={loadDetail} />
        ) : null}
        {!loading && !error && !detail ? (
          <RagEmptyState title="暂无文档" detail="没有读取到文档详情。" />
        ) : null}

        {!loading && !error && detail ? (
          <>
            <OriginalFilePreview content={detail.content} manifest={manifest} />

            <div className="rag-document-detail-layout">
              <Card className="section-card rag-document-detail-panel" bordered>
                <div className="section-header">
                  <div>
                    <h4>原文</h4>
                    <p className="section-text">{fileNameOf(manifest)}</p>
                  </div>
                  <IndexStatusTag status={manifest?.indexStatus} />
                </div>
                <div className="rag-document-original">
                  <pre>{detail.content || ""}</pre>
                </div>
              </Card>

              <Card className="section-card rag-document-detail-panel" bordered>
                <div className="section-header">
                  <div>
                    <h4>拆分片段</h4>
                    <p className="section-text">{chunks.length} 个片段</p>
                  </div>
                </div>

                {chunks.length === 0 ? (
                  <RagEmptyState title="暂无片段" detail="该文档还没有可展示的拆分片段。" />
                ) : (
                  <div className="rag-document-chunk-list">
                    {chunks.map((chunk, index) => (
                      <article className="rag-document-chunk-card" key={chunkIdOf(chunk, index)}>
                        <div className="rag-match-head">
                          <strong>Chunk {chunkIndexOf(chunk, index) + 1}</strong>
                          <Tag bordered>
                            {formatNumber(chunkCharCountOf(chunk))} chars
                          </Tag>
                        </div>
                        <p className="rag-match-text">{chunk.text || "-"}</p>
                      </article>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </>
        ) : null}
      </PageFrame>
    </main>
  );
}
