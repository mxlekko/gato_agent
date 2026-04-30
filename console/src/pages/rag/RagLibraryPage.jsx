import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Input, Select, Tag } from "@arco-design/web-react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import {
  RagConfirmDialog,
  RagEmptyState,
  RagErrorState,
  RagLoadingState,
  RagStatusBanner
} from "./components";

const Option = Select.Option;
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".csv", ".json"]);

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

function docIdOf(document) {
  return document?.docId || document?.doc_id || "";
}

function fileNameOf(document) {
  return document?.fileName || document?.file_name || "-";
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN") : "-";
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

function extensionOf(fileName) {
  const match = String(fileName || "").toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return window.btoa(binary);
}

async function buildUploadPayload(file) {
  if (TEXT_EXTENSIONS.has(extensionOf(file.name))) {
    return {
      fileName: file.name,
      content: await file.text()
    };
  }

  return {
    fileName: file.name,
    contentBase64: arrayBufferToBase64(await file.arrayBuffer())
  };
}

function chunkIdOf(chunk, index) {
  return chunk?.chunkId || chunk?.chunk_id || `chunk-${index}`;
}

function chunkIndexOf(chunk, index) {
  return Number.isFinite(Number(chunk?.chunkIndex ?? chunk?.chunk_index))
    ? Number(chunk?.chunkIndex ?? chunk?.chunk_index)
    : index;
}

export function RagLibraryPage() {
  const fileInputRef = useRef(null);
  const [keyword, setKeyword] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [documents, setDocuments] = useState([]);
  const [total, setTotal] = useState(0);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState(null);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksError, setChunksError] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [editContent, setEditContent] = useState("");
  const [notice, setNotice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const selectedSummary = documents.find((document) => docIdOf(document) === selectedDocId) || null;
  const manifest = detail?.manifest || selectedSummary || null;
  const canEdit = Boolean(selectedDocId && !detailLoading && detail && !actionLoading);

  const loadDocuments = useCallback(async (options = {}) => {
    const nextKeyword = options.keyword ?? keyword;
    const nextSourceType = options.sourceType ?? sourceType;
    const preferredDocId = options.selectedDocId ?? selectedDocId;

    setDocumentsLoading(true);
    setDocumentsError(null);

    try {
      const response = await apiClient.listRagDocuments({
        keyword: nextKeyword.trim(),
        sourceType: nextSourceType
      });
      const data = unwrapResponse(response);
      const nextDocuments = Array.isArray(data?.documents) ? data.documents : [];
      setDocuments(nextDocuments);
      setTotal(Number.isFinite(Number(data?.total)) ? Number(data.total) : nextDocuments.length);

      if (preferredDocId && !nextDocuments.some((document) => docIdOf(document) === preferredDocId)) {
        setSelectedDocId("");
        setDetail(null);
        setEditContent("");
        setChunks([]);
      }
    } catch (caughtError) {
      setDocuments([]);
      setTotal(0);
      setDocumentsError(caughtError);
    } finally {
      setDocumentsLoading(false);
    }
  }, [keyword, selectedDocId, sourceType]);

  const loadChunks = useCallback(async (docId) => {
    setChunksLoading(true);
    setChunksError(null);

    try {
      const response = await apiClient.listRagDocumentChunks(docId, { limit: 100 });
      const data = unwrapResponse(response);
      setChunks(Array.isArray(data?.chunks) ? data.chunks : []);
    } catch (caughtError) {
      setChunks([]);
      setChunksError(caughtError);
    } finally {
      setChunksLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (docId) => {
    setDetailLoading(true);
    setDetailError(null);

    try {
      const response = await apiClient.getRagDocument(docId);
      const data = unwrapResponse(response);
      setDetail(data);
      setEditContent(typeof data?.content === "string" ? data.content : "");
    } catch (caughtError) {
      setDetail(null);
      setEditContent("");
      setDetailError(caughtError);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, []);

  async function handleSelectDocument(docId) {
    if (!docId) {
      return;
    }

    setSelectedDocId(docId);
    setNotice(null);
    await Promise.all([loadDetail(docId), loadChunks(docId)]);
  }

  async function handleFilterSubmit(event) {
    event.preventDefault();
    await loadDocuments({
      keyword,
      sourceType,
      selectedDocId
    });
  }

  async function handleUpload(event) {
    event.preventDefault();

    if (!uploadFile) {
      setNotice({ status: "warning", title: "请选择文件" });
      return;
    }

    setUploadLoading(true);
    setNotice(null);

    try {
      const payload = await buildUploadPayload(uploadFile);
      const response = await apiClient.uploadRagDocument(payload);
      const data = unwrapResponse(response);
      const nextDocId = data?.docId || docIdOf(data?.document);

      setUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setNotice({
        status: "success",
        title: "文档已上传",
        detail: nextDocId ? `docId: ${nextDocId}` : fileNameOf(data?.document)
      });
      await loadDocuments({ selectedDocId: nextDocId || selectedDocId });
      if (nextDocId) {
        await handleSelectDocument(nextDocId);
      }
    } catch (caughtError) {
      setNotice({ status: "error", title: "上传失败", detail: caughtError.message });
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleSaveContent() {
    if (!selectedDocId) {
      return;
    }

    setActionLoading("save");
    setNotice(null);

    try {
      const response = await apiClient.updateRagDocument(selectedDocId, { content: editContent });
      unwrapResponse(response);
      setNotice({
        status: "success",
        title: "文档内容已保存",
        detail: "索引状态会在重新索引后更新。"
      });
      await loadDocuments({ selectedDocId });
      await loadDetail(selectedDocId);
    } catch (caughtError) {
      setNotice({ status: "error", title: "保存失败", detail: caughtError.message });
    } finally {
      setActionLoading("");
    }
  }

  async function handleReindex() {
    if (!selectedDocId) {
      return;
    }

    setActionLoading("reindex");
    setNotice(null);

    try {
      const response = await apiClient.reindexRagDocument(selectedDocId, {});
      const data = unwrapResponse(response);
      setNotice({
        status: "success",
        title: "已创建重建任务",
        detail: data?.jobId ? `jobId: ${data.jobId}` : "任务已进入队列。"
      });
      await loadDocuments({ selectedDocId });
      await loadChunks(selectedDocId);
    } catch (caughtError) {
      setNotice({ status: "error", title: "重建失败", detail: caughtError.message });
    } finally {
      setActionLoading("");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      return;
    }

    const docId = docIdOf(confirmDelete);
    setActionLoading("delete");
    setNotice(null);

    try {
      const response = await apiClient.deleteRagDocument(docId);
      unwrapResponse(response);
      setConfirmDelete(null);
      setSelectedDocId("");
      setDetail(null);
      setEditContent("");
      setChunks([]);
      setNotice({ status: "success", title: "文档已删除", detail: fileNameOf(confirmDelete) });
      await loadDocuments({ selectedDocId: "" });
    } catch (caughtError) {
      setNotice({ status: "error", title: "删除失败", detail: caughtError.message });
    } finally {
      setActionLoading("");
    }
  }

  return (
    <PageFrame
      eyebrow="RAG"
      title="文档库"
      description="上传、编辑、重建索引并查看文档片段。"
      actions={(
        <Button onClick={() => loadDocuments()}>
          刷新
        </Button>
      )}
    >
      {notice ? (
        <RagStatusBanner status={notice.status} title={notice.title} detail={notice.detail} />
      ) : null}

      <div className="rag-library-layout">
        <Card className="section-card rag-library-search-card" bordered>
          <div className="section-header">
            <div>
              <h4>文档检索</h4>
              <p className="section-text">按文件名和来源类型筛选文档。</p>
            </div>
            <Tag bordered>Search</Tag>
          </div>

          <form className="form-stack" onSubmit={handleFilterSubmit}>
            <label className="field-group">
              <span>关键词</span>
              <Input
                className="field-input"
                onChange={setKeyword}
                placeholder="文件名"
                value={keyword}
              />
            </label>
            <label className="field-group">
              <span>来源类型</span>
              <Select
                allowClear
                className="field-input"
                onChange={(value) => setSourceType(value || "")}
                placeholder="全部"
                value={sourceType}
              >
                <Option value="md">Markdown</Option>
                <Option value="txt">Text</Option>
                <Option value="docx">DOCX</Option>
                <Option value="pdf">PDF</Option>
                <Option value="png">PNG</Option>
                <Option value="jpg">JPG</Option>
              </Select>
            </label>
            <div className="button-row">
              <Button htmlType="submit" type="primary">
                查询
              </Button>
              <Button
                onClick={() => {
                  setKeyword("");
                  setSourceType("");
                  loadDocuments({ keyword: "", sourceType: "", selectedDocId });
                }}
              >
                重置
              </Button>
            </div>
          </form>
        </Card>

        <Card className="section-card rag-library-upload-card" bordered>
          <div className="section-header">
            <div>
              <h4>文件上传</h4>
              <p className="section-text">导入本地文件后进入文档库。</p>
            </div>
            <Tag bordered>Upload</Tag>
          </div>

          <form className="rag-upload-box" onSubmit={handleUpload}>
            <label className="field-group">
              <span>上传文件</span>
              <input
                className="field-input"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                ref={fileInputRef}
                type="file"
              />
            </label>
            <Button htmlType="submit" loading={uploadLoading}>
              {uploadLoading ? "上传中" : "上传"}
            </Button>
          </form>
        </Card>

        <Card className="section-card rag-library-list-card" bordered>
          <div className="section-header">
            <div>
              <h4>文件列表</h4>
              <p className="section-text">{documentsLoading ? "加载中" : `${total} 个文档`}</p>
            </div>
            <Tag bordered>Library</Tag>
          </div>

          {documentsLoading ? <RagLoadingState label="正在读取文档列表" /> : null}
          {!documentsLoading && documentsError ? (
            <RagErrorState error={documentsError} onRetry={() => loadDocuments()} />
          ) : null}
          {!documentsLoading && !documentsError && documents.length === 0 ? (
            <RagEmptyState title="暂无文档" detail="上传文件后会出现在文档库。" />
          ) : null}
          {!documentsLoading && !documentsError && documents.length > 0 ? (
            <div className="rag-doc-list">
              {documents.map((document) => {
                const docId = docIdOf(document);
                const active = docId === selectedDocId;

                return (
                  <button
                    className={`rag-doc-row${active ? " rag-doc-row-active" : ""}`}
                    key={docId}
                    onClick={() => handleSelectDocument(docId)}
                    type="button"
                  >
                    <span>
                      <strong>{fileNameOf(document)}</strong>
                      <em className="mono-text">{docId}</em>
                    </span>
                    <span className="rag-doc-row-meta">
                      <IndexStatusTag status={document.indexStatus} />
                      <span>{formatNumber(document.chunkCount)} chunks</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </Card>

        <Card className="section-card rag-library-detail" bordered>
          <div className="section-header">
            <div>
              <h4>详情</h4>
              <p className="section-text">
                {manifest ? `${fileNameOf(manifest)} / ${docIdOf(manifest)}` : "未选择文档"}
              </p>
            </div>
            {manifest ? (
              <IndexStatusTag status={manifest.indexStatus} />
            ) : null}
          </div>

          {!selectedDocId ? (
            <RagEmptyState title="请选择文档" detail="左侧列表选择文档后展示内容和片段。" />
          ) : null}

          {selectedDocId && detailLoading ? <RagLoadingState label="正在读取文档详情" /> : null}

          {selectedDocId && !detailLoading && detailError ? (
            <RagErrorState error={detailError} onRetry={() => loadDetail(selectedDocId)} />
          ) : null}

          {selectedDocId && !detailLoading && !detailError && detail ? (
            <>
              <div className="rag-detail-meta-grid">
                <div>
                  <span className="meta-label">来源类型</span>
                  <strong>{manifest?.sourceType || manifest?.source_type || "-"}</strong>
                </div>
                <div>
                  <span className="meta-label">字符数</span>
                  <strong>{formatNumber(manifest?.charCount)}</strong>
                </div>
                <div>
                  <span className="meta-label">块数</span>
                  <strong>{formatNumber(manifest?.blockCount)}</strong>
                </div>
                <div>
                  <span className="meta-label">更新时间</span>
                  <strong>{formatDateTime(manifest?.updatedAt)}</strong>
                </div>
              </div>

              <label className="field-group">
                <span>内容</span>
                <Input.TextArea
                  className="field-input field-textarea rag-document-editor"
                  onChange={setEditContent}
                  value={editContent}
                />
              </label>

              <div className="button-row">
                <Button
                  disabled={!canEdit}
                  loading={actionLoading === "save"}
                  onClick={handleSaveContent}
                  type="primary"
                >
                  {actionLoading === "save" ? "保存中" : "保存内容"}
                </Button>
                <Button
                  disabled={!selectedDocId || Boolean(actionLoading)}
                  loading={actionLoading === "reindex"}
                  onClick={handleReindex}
                >
                  {actionLoading === "reindex" ? "创建中" : "重建索引"}
                </Button>
                <Button
                  disabled={!selectedSummary || Boolean(actionLoading)}
                  onClick={() => setConfirmDelete(selectedSummary)}
                  status="danger"
                >
                  删除
                </Button>
              </div>

              <div className="rag-chunk-panel">
                <div className="section-header">
                  <div>
                    <h4>片段</h4>
                    <p className="section-text">{chunksLoading ? "加载中" : `${chunks.length} 个片段`}</p>
                  </div>
                  <Button
                    disabled={chunksLoading}
                    onClick={() => loadChunks(selectedDocId)}
                    size="small"
                  >
                    刷新片段
                  </Button>
                </div>

                {chunksLoading ? <RagLoadingState label="正在读取片段" /> : null}
                {!chunksLoading && chunksError ? (
                  <RagErrorState error={chunksError} onRetry={() => loadChunks(selectedDocId)} />
                ) : null}
                {!chunksLoading && !chunksError && chunks.length === 0 ? (
                  <RagEmptyState title="暂无片段" detail="重建索引完成后会展示 chunk 内容。" />
                ) : null}
                {!chunksLoading && !chunksError && chunks.length > 0 ? (
                  <div className="rag-chunk-list">
                    {chunks.map((chunk, index) => (
                      <article className="rag-chunk-card" key={chunkIdOf(chunk, index)}>
                        <div className="rag-match-head">
                          <strong>Chunk {chunkIndexOf(chunk, index) + 1}</strong>
                          <Tag bordered>
                            {formatNumber(chunk.charCount ?? chunk.char_count)} chars
                          </Tag>
                        </div>
                        <p className="rag-match-text">{chunk.text || "-"}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </Card>
      </div>

      <RagConfirmDialog
        cancelLabel="取消"
        confirmLabel={actionLoading === "delete" ? "删除中" : "确认删除"}
        detail={confirmDelete ? `将删除 ${fileNameOf(confirmDelete)} 及其索引片段。` : ""}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        open={Boolean(confirmDelete)}
        title="删除文档"
      />
    </PageFrame>
  );
}
