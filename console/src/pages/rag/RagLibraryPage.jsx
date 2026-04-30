import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Input, Modal, Select, Tag } from "@arco-design/web-react";
import { IconPlus, IconRefresh, IconSearch, IconUpload } from "@arco-design/web-react/icon";
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
const SUPPORTED_UPLOAD_EXTENSIONS = [
  ".md",
  ".markdown",
  ".txt",
  ".docx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp"
];
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const UPLOAD_ACCEPT = SUPPORTED_UPLOAD_EXTENSIONS.join(",");
const UPLOAD_HELP_TEXT = "支持 Markdown、TXT、DOCX、PDF、PNG、JPG、JPEG、GIF、BMP、WebP。";
const LIBRARY_REFRESH_SIGNAL_KEY = "rag-library-refresh-signal";
const DEFAULT_UPLOAD_CHUNK_STRATEGY = "balanced";
const CHUNK_STRATEGY_PRESETS = {
  fine: {
    label: "精细拆分",
    description: "片段更短，适合条款、评分规则、流程步骤较密集的文档。",
    config: {
      minChars: "180",
      maxChars: "560",
      overlapChars: "80",
      similarityThreshold: "0.62"
    }
  },
  balanced: {
    label: "均衡拆分",
    description: "兼顾上下文完整和检索粒度，适合大多数业务文档。",
    config: {
      minChars: "280",
      maxChars: "900",
      overlapChars: "80",
      similarityThreshold: "0.58"
    }
  },
  broad: {
    label: "长段拆分",
    description: "片段更长，适合背景说明、方案文档、上下文依赖较强的内容。",
    config: {
      minChars: "500",
      maxChars: "1400",
      overlapChars: "120",
      similarityThreshold: "0.52"
    }
  }
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

function docIdOf(document) {
  return document?.docId || document?.doc_id || "";
}

function fileNameOf(document) {
  return document?.fileName || document?.file_name || "-";
}

function fileTypeOf(document) {
  const sourceType = document?.sourceType || document?.source_type || extensionOf(fileNameOf(document)).replace(".", "");
  return sourceType ? String(sourceType).toUpperCase() : "-";
}

function fileSizeOf(document) {
  return document?.fileSize ?? document?.file_size ?? 0;
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

function chunkFormFromPreset(strategy) {
  return {
    ...(CHUNK_STRATEGY_PRESETS[strategy] || CHUNK_STRATEGY_PRESETS[DEFAULT_UPLOAD_CHUNK_STRATEGY]).config
  };
}

function parseChunkInteger(value, label, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 的整数。`);
  }
  return parsed;
}

function parseChunkFloat(value, label, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 之间的数字。`);
  }
  return parsed;
}

function buildChunkConfig(form) {
  const minChars = parseChunkInteger(form.minChars, "最小字符数", { minimum: 1, maximum: 50000 });
  const maxChars = parseChunkInteger(form.maxChars, "最大字符数", { minimum: 2, maximum: 100000 });
  const overlapChars = parseChunkInteger(form.overlapChars, "重叠字符数", { minimum: 0, maximum: 50000 });
  const similarityThreshold = parseChunkFloat(form.similarityThreshold, "语义相似阈值", {
    minimum: 0,
    maximum: 1
  });

  if (maxChars <= minChars) {
    throw new Error("最大字符数必须大于最小字符数。");
  }
  if (overlapChars >= maxChars) {
    throw new Error("重叠字符数必须小于最大字符数。");
  }

  return {
    minChars,
    maxChars,
    overlapChars,
    similarityThreshold
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function editorUrlForDoc(docId) {
  if (typeof window === "undefined") {
    return "";
  }
  return `${window.location.origin}/rag/library/${encodeURIComponent(docId)}/edit`;
}

function indexStatusLabel(status) {
  const labels = {
    indexed: "已索引",
    processing: "处理中",
    stale: "需重建",
    not_indexed: "未索引"
  };
  return labels[status] || status || "-";
}

function indexStatusColor(status) {
  if (status === "processing") {
    return "blue";
  }
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
  const refreshSignalRef = useRef("");
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
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadStep, setUploadStep] = useState("file");
  const [uploadStrategy, setUploadStrategy] = useState(DEFAULT_UPLOAD_CHUNK_STRATEGY);
  const [uploadChunkForm, setUploadChunkForm] = useState(chunkFormFromPreset(DEFAULT_UPLOAD_CHUNK_STRATEGY));
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState("");
  const [processingDocIds, setProcessingDocIds] = useState(() => new Set());
  const [actionLoading, setActionLoading] = useState("");
  const [editContent, setEditContent] = useState("");
  const [notice, setNotice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const selectedSummary = documents.find((document) => docIdOf(document) === selectedDocId) || null;
  const manifest = detail?.manifest || selectedSummary || null;
  const canEdit = Boolean(selectedDocId && !detailLoading && detail && !actionLoading);

  function setDocumentProcessing(docId, processing) {
    if (!docId) {
      return;
    }
    setProcessingDocIds((current) => {
      const next = new Set(current);
      if (processing) {
        next.add(docId);
      } else {
        next.delete(docId);
      }
      return next;
    });
  }

  async function monitorReindexJob(jobId, docId, fileName) {
    try {
      let finalJob = null;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await sleep(1000);
        const jobResponse = await apiClient.getRagJob(jobId);
        const jobData = unwrapResponse(jobResponse);
        finalJob = jobData?.job || null;
        if (finalJob?.status === "succeeded" || finalJob?.status === "failed") {
          break;
        }
      }

      if (finalJob?.status !== "succeeded") {
        throw new Error(finalJob?.error?.message || "拆分任务未完成。");
      }

      setNotice({
        status: "success",
        title: "文档已处理完成",
        detail: finalJob?.result?.chunkCount ? `${fileName || "文档"} / ${finalJob.result.chunkCount} 个片段` : fileName
      });
    } catch (caughtError) {
      setNotice({ status: "error", title: "文档处理失败", detail: caughtError.message });
    } finally {
      setDocumentProcessing(docId, false);
      await loadDocuments({ selectedDocId: docId });
    }
  }

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    refreshSignalRef.current = window.localStorage.getItem(LIBRARY_REFRESH_SIGNAL_KEY) || "";

    const refreshIfChanged = () => {
      const nextSignal = window.localStorage.getItem(LIBRARY_REFRESH_SIGNAL_KEY) || "";
      if (nextSignal && nextSignal !== refreshSignalRef.current) {
        refreshSignalRef.current = nextSignal;
        loadDocuments();
      }
    };

    const handleStorage = (event) => {
      if (event.key === LIBRARY_REFRESH_SIGNAL_KEY) {
        refreshSignalRef.current = event.newValue || "";
        loadDocuments();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfChanged();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", refreshIfChanged);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", refreshIfChanged);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadDocuments]);

  async function handleSelectDocument(docId) {
    if (!docId) {
      return;
    }

    handleOpenDocumentDetail(docId);
  }

  function handleOpenDocumentDetail(docId) {
    if (!docId || typeof window === "undefined") {
      return;
    }
    const detailUrl = `${window.location.origin}/rag/library/${encodeURIComponent(docId)}`;
    window.open(detailUrl, "_blank", "noopener,noreferrer");
  }

  function handleOpenDocumentEditor(docId) {
    if (!docId || typeof window === "undefined") {
      return;
    }
    const editUrl = editorUrlForDoc(docId);
    window.open(editUrl, "_blank", "noopener,noreferrer");
  }

  async function handleFilterSubmit(event) {
    event.preventDefault();
    await loadDocuments({
      keyword,
      sourceType,
      selectedDocId
    });
  }

  function resetUploadWorkflow() {
    setUploadStep("file");
    setUploadStrategy(DEFAULT_UPLOAD_CHUNK_STRATEGY);
    setUploadChunkForm(chunkFormFromPreset(DEFAULT_UPLOAD_CHUNK_STRATEGY));
    setUploadProgressText("");
    setUploadDragActive(false);
  }

  function openUploadModal() {
    setNotice(null);
    resetUploadWorkflow();
    setUploadFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploadModalOpen(true);
  }

  function closeUploadModal() {
    if (uploadLoading) {
      return;
    }
    setUploadModalOpen(false);
    resetUploadWorkflow();
    setUploadFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleUploadFileList(files) {
    const nextFile = files?.[0] || null;
    setUploadFile(nextFile);
  }

  function handleUploadStrategyChange(value) {
    const nextStrategy = value || DEFAULT_UPLOAD_CHUNK_STRATEGY;
    setUploadStrategy(nextStrategy);
    if (CHUNK_STRATEGY_PRESETS[nextStrategy]) {
      setUploadChunkForm(chunkFormFromPreset(nextStrategy));
    }
  }

  function updateUploadChunkForm(field, value) {
    setUploadStrategy("custom");
    setUploadChunkForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function handleUploadDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!uploadLoading) {
      setUploadDragActive(true);
    }
  }

  function handleUploadDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setUploadDragActive(false);
    }
  }

  function handleUploadDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setUploadDragActive(false);
    if (!uploadLoading) {
      handleUploadFileList(event.dataTransfer?.files);
    }
  }

  async function handleUpload(event) {
    event?.preventDefault();

    if (!uploadFile) {
      setNotice({ status: "warning", title: "请选择文件" });
      return;
    }

    if (uploadStep === "file") {
      setUploadStep("strategy");
      setNotice(null);
      return;
    }

    setUploadLoading(true);
    setNotice(null);
    setUploadProgressText("正在上传文件");

    try {
      const chunkConfig = buildChunkConfig(uploadChunkForm);
      const payload = await buildUploadPayload(uploadFile);
      const response = await apiClient.uploadRagDocument(payload);
      const data = unwrapResponse(response);
      const nextDocId = data?.docId || docIdOf(data?.document);
      if (!nextDocId) {
        throw new Error("上传成功但未返回文档 ID。");
      }

      setUploadProgressText("正在创建拆分任务");
      const reindexResponse = await apiClient.reindexRagDocument(nextDocId, chunkConfig);
      const reindexData = unwrapResponse(reindexResponse);
      const jobId = reindexData?.jobId || reindexData?.job?.jobId;
      if (!jobId) {
        throw new Error("未返回拆分任务 ID。");
      }

      setUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setUploadModalOpen(false);
      resetUploadWorkflow();
      setDocumentProcessing(nextDocId, true);
      setNotice({
        status: "neutral",
        title: "文档处理中",
        detail: `${fileNameOf(data?.document)} 已进入拆分队列，完成后列表状态会自动更新。`
      });
      await loadDocuments({ selectedDocId: nextDocId || selectedDocId });
      monitorReindexJob(jobId, nextDocId, fileNameOf(data?.document));
    } catch (caughtError) {
      setNotice({ status: "error", title: "上传或拆分失败", detail: caughtError.message });
    } finally {
      setUploadLoading(false);
      setUploadProgressText("");
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

  async function handleReindex(targetDocId = selectedDocId) {
    if (!targetDocId) {
      return;
    }

    setActionLoading(`reindex:${targetDocId}`);
    setNotice(null);

    try {
      const response = await apiClient.reindexRagDocument(targetDocId, {});
      const data = unwrapResponse(response);
      setNotice({
        status: "success",
        title: "已创建重建任务",
        detail: data?.jobId ? `jobId: ${data.jobId}` : "任务已进入队列。"
      });
      await loadDocuments({ selectedDocId });
      if (targetDocId === selectedDocId) {
        await loadChunks(selectedDocId);
      }
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
      setDocumentProcessing(docId, false);
      if (docId === selectedDocId) {
        setSelectedDocId("");
        setDetail(null);
        setEditContent("");
        setChunks([]);
      }
      setNotice({ status: "success", title: "文档已删除", detail: fileNameOf(confirmDelete) });
      await loadDocuments({ selectedDocId: docId === selectedDocId ? "" : selectedDocId });
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
        <Button icon={<IconRefresh />} onClick={() => loadDocuments()}>
          刷新
        </Button>
      )}
    >
      {notice ? (
        <RagStatusBanner status={notice.status} title={notice.title} detail={notice.detail} />
      ) : null}

      <div className="rag-library-layout">
        <Card className="section-card rag-library-search-card" bordered>
          <form className="rag-library-filter-row" onSubmit={handleFilterSubmit}>
            <Button
              htmlType="button"
              icon={<IconPlus />}
              onClick={openUploadModal}
              type="primary"
            >
              文件上传
            </Button>
            <label className="rag-library-filter-field">
              <span>关键词</span>
              <Input
                className="field-input rag-library-keyword-input"
                onChange={setKeyword}
                placeholder="文件名"
                value={keyword}
              />
            </label>
            <label className="rag-library-filter-field">
              <span>来源类型</span>
              <Select
                allowClear
                className="field-input rag-library-source-select"
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
            <Button htmlType="submit" icon={<IconSearch />}>
              查询
            </Button>
            <Button
              htmlType="button"
              onClick={() => {
                setKeyword("");
                setSourceType("");
                loadDocuments({ keyword: "", sourceType: "", selectedDocId });
              }}
            >
              重置
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
            <div className="rag-doc-table">
              <div className="rag-doc-table-head">
                <span>序号</span>
                <span>文件名称</span>
                <span>文件类型</span>
                <span>文件大小</span>
                <span>状态</span>
                <span>片段数</span>
                <span>操作列</span>
              </div>
              <div className="rag-doc-table-body">
                {documents.map((document, index) => {
                  const docId = docIdOf(document);
                  const isProcessing = processingDocIds.has(docId);
                  return (
                    <div
                      className="rag-doc-table-row"
                      key={docId}
                      onClick={() => handleOpenDocumentDetail(docId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleOpenDocumentDetail(docId);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span>{index + 1}</span>
                      <strong title={fileNameOf(document)}>{fileNameOf(document)}</strong>
                      <span>{fileTypeOf(document)}</span>
                      <span>{formatFileSize(fileSizeOf(document))}</span>
                      <span>
                        <IndexStatusTag status={isProcessing ? "processing" : document.indexStatus} />
                      </span>
                      <span>{isProcessing ? "-" : formatNumber(document.chunkCount)}</span>
                      <span className="rag-doc-table-actions">
                        <Button
                          htmlType="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenDocumentDetail(docId);
                          }}
                          size="mini"
                        >
                          查看
                        </Button>
                        <Button
                          htmlType="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenDocumentEditor(docId);
                          }}
                          size="mini"
                        >
                          编辑
                        </Button>
                        <Button
                          disabled={Boolean(actionLoading)}
                          htmlType="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirmDelete(document);
                          }}
                          size="mini"
                          status="danger"
                        >
                          删除
                        </Button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
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

      <Modal
        footer={null}
        onCancel={closeUploadModal}
        style={{ width: 680 }}
        title="文件上传"
        visible={uploadModalOpen}
      >
        <form className="rag-upload-dialog-form" onSubmit={handleUpload}>
          <div className="rag-upload-steps">
            <span className={uploadStep === "file" ? "rag-upload-step-active" : ""}>1 文件上传</span>
            <span className={uploadStep === "strategy" ? "rag-upload-step-active" : ""}>2 拆分策略</span>
          </div>

          {uploadStep === "file" ? (
            <label
              className={`rag-upload-dropzone${uploadDragActive ? " rag-upload-dropzone-active" : ""}${uploadLoading ? " rag-upload-dropzone-disabled" : ""}`}
              onDragLeave={handleUploadDragLeave}
              onDragOver={handleUploadDragOver}
              onDrop={handleUploadDrop}
            >
              <input
                accept={UPLOAD_ACCEPT}
                className="rag-upload-native-input"
                disabled={uploadLoading}
                onChange={(event) => handleUploadFileList(event.target.files)}
                ref={fileInputRef}
                type="file"
              />
              <span className="rag-upload-dropzone-icon">
                <IconUpload />
              </span>
              <strong>{uploadFile ? uploadFile.name : "点击或拖拽文件到这里"}</strong>
              <em>{uploadFile ? `${formatFileSize(uploadFile.size)}，可点击重新选择` : UPLOAD_HELP_TEXT}</em>
            </label>
          ) : (
            <div className="rag-upload-strategy-panel">
              <div className="rag-upload-selected-file">
                <span>已选择文件</span>
                <strong>{uploadFile?.name || "-"}</strong>
                <em>{formatFileSize(uploadFile?.size)}</em>
              </div>

              <label className="field-group">
                <span>拆分策略</span>
                <Select
                  className="field-input"
                  disabled={uploadLoading}
                  onChange={handleUploadStrategyChange}
                  value={uploadStrategy}
                >
                  {Object.entries(CHUNK_STRATEGY_PRESETS).map(([key, preset]) => (
                    <Option key={key} value={key}>{preset.label}</Option>
                  ))}
                  <Option value="custom">自定义策略</Option>
                </Select>
                <p className="field-help">
                  {CHUNK_STRATEGY_PRESETS[uploadStrategy]?.description || "手动调整下方参数后，将按自定义策略拆分。"}
                </p>
              </label>

              <div className="form-grid-two rag-upload-chunk-grid">
                <label className="field-group">
                  <span>最小字符数</span>
                  <input
                    className="field-input"
                    disabled={uploadLoading}
                    min="1"
                    onChange={(event) => updateUploadChunkForm("minChars", event.target.value)}
                    type="number"
                    value={uploadChunkForm.minChars}
                  />
                </label>
                <label className="field-group">
                  <span>最大字符数</span>
                  <input
                    className="field-input"
                    disabled={uploadLoading}
                    min="2"
                    onChange={(event) => updateUploadChunkForm("maxChars", event.target.value)}
                    type="number"
                    value={uploadChunkForm.maxChars}
                  />
                </label>
                <label className="field-group">
                  <span>重叠字符数</span>
                  <input
                    className="field-input"
                    disabled={uploadLoading}
                    min="0"
                    onChange={(event) => updateUploadChunkForm("overlapChars", event.target.value)}
                    type="number"
                    value={uploadChunkForm.overlapChars}
                  />
                </label>
                <label className="field-group">
                  <span>语义相似阈值</span>
                  <input
                    className="field-input"
                    disabled={uploadLoading}
                    max="1"
                    min="0"
                    onChange={(event) => updateUploadChunkForm("similarityThreshold", event.target.value)}
                    step="0.01"
                    type="number"
                    value={uploadChunkForm.similarityThreshold}
                  />
                </label>
              </div>

              {uploadProgressText ? (
                <p className="rag-upload-progress-text">{uploadProgressText}</p>
              ) : null}
            </div>
          )}
          <div className="button-row rag-upload-dialog-actions">
            <Button disabled={uploadLoading} htmlType="button" onClick={closeUploadModal}>
              取消
            </Button>
            {uploadStep === "strategy" ? (
              <Button disabled={uploadLoading} htmlType="button" onClick={() => setUploadStep("file")}>
                上一步
              </Button>
            ) : null}
            <Button htmlType="submit" loading={uploadLoading} type="primary">
              {uploadLoading ? "处理中" : uploadStep === "file" ? "下一步" : "确认上传并拆分"}
            </Button>
          </div>
        </form>
      </Modal>
    </PageFrame>
  );
}
