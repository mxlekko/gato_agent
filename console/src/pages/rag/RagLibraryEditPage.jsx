import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Tag } from "@arco-design/web-react";
import { IconRefresh, IconSave } from "@arco-design/web-react/icon";
import { useNavigate, useParams } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import {
  RagEmptyState,
  RagErrorState,
  RagLoadingState,
  RagStatusBanner
} from "./components";

const LIBRARY_REFRESH_SIGNAL_KEY = "rag-library-refresh-signal";

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

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN") : "-";
}

function chunkIdOf(chunk, index) {
  return chunk?.chunkId || chunk?.chunk_id || `chunk-${index}`;
}

function chunkIndexOf(chunk, index) {
  return Number.isFinite(Number(chunk?.chunkIndex ?? chunk?.chunk_index))
    ? Number(chunk?.chunkIndex ?? chunk?.chunk_index)
    : index;
}

function normalizeChunk(chunk, index) {
  return {
    id: chunkIdOf(chunk, index),
    text: String(chunk?.text || ""),
    originalIndex: chunkIndexOf(chunk, index)
  };
}

function chunksFromContent(content) {
  const parts = String(content || "")
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks = parts.length ? parts : [String(content || "").trim()].filter(Boolean);
  return chunks.map((text, index) => ({
    id: `draft-${index}`,
    text,
    originalIndex: index
  }));
}

function chunkTextsForSave(chunks) {
  return chunks
    .map((chunk) => chunk.text.trim())
    .filter(Boolean);
}

function areChunkTextsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((text, index) => text === right[index]);
}

function selectionFromEvent(event) {
  const target = event?.target;
  if (
    !target
    || !Number.isFinite(target.selectionStart)
    || !Number.isFinite(target.selectionEnd)
  ) {
    return null;
  }

  return {
    start: target.selectionStart,
    end: target.selectionEnd
  };
}

function clampSelection(selection, text) {
  if (!selection) {
    return null;
  }

  const textLength = String(text || "").length;
  const start = Math.max(0, Math.min(selection.start, textLength));
  const end = Math.max(0, Math.min(selection.end, textLength));
  return {
    start: Math.min(start, end),
    end: Math.max(start, end)
  };
}

function selectionSize(selection) {
  if (!selection) {
    return 0;
  }
  return Math.max(0, selection.end - selection.start);
}

function splitTextBySelection(text, selection) {
  const source = String(text || "");
  const safeSelection = clampSelection(selection, source);

  if (!source.trim()) {
    return { chunks: null, message: "当前片段为空，无法拆分。" };
  }

  if (!safeSelection) {
    return { chunks: null, message: "请先在片段中选中文本，或把光标放到拆分位置。" };
  }

  if (safeSelection.start === safeSelection.end) {
    if (safeSelection.start <= 0 || safeSelection.start >= source.length) {
      return { chunks: null, message: "光标需要放在片段内容中间。" };
    }

    const chunks = [
      source.slice(0, safeSelection.start).trim(),
      source.slice(safeSelection.start).trim()
    ].filter(Boolean);
    if (chunks.length < 2) {
      return { chunks: null, message: "光标两侧需要都有文本内容。" };
    }
    return { chunks, message: "" };
  }

  const chunks = [
    source.slice(0, safeSelection.start).trim(),
    source.slice(safeSelection.start, safeSelection.end).trim(),
    source.slice(safeSelection.end).trim()
  ].filter(Boolean);

  if (chunks.length < 2) {
    return { chunks: null, message: "选区需要和其他文本一起拆分成至少两个片段。" };
  }

  return { chunks, message: "" };
}

function notifyLibraryRefresh(docId) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      LIBRARY_REFRESH_SIGNAL_KEY,
      JSON.stringify({
        docId,
        updatedAt: Date.now()
      })
    );
  } catch {
    // Refresh notification is best-effort; saving itself has already succeeded.
  }
}

export function RagLibraryEditPage() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [savedChunkTexts, setSavedChunkTexts] = useState([]);
  const [chunkSelections, setChunkSelections] = useState({});

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
      const nextChunks = Array.isArray(chunksData?.chunks)
        ? chunksData.chunks.map(normalizeChunk)
        : [];
      const normalizedChunks = nextChunks.length ? nextChunks : chunksFromContent(detailData?.content);
      setDetail(detailData);
      setChunks(normalizedChunks);
      setSavedChunkTexts(chunkTextsForSave(normalizedChunks));
      setChunkSelections({});
    } catch (caughtError) {
      setDetail(null);
      setChunks([]);
      setSavedChunkTexts([]);
      setChunkSelections({});
      setError(caughtError);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  function updateChunkText(index, text) {
    setChunks((current) => current.map((chunk, chunkIndex) => (
      chunkIndex === index ? { ...chunk, text } : chunk
    )));
  }

  function rememberChunkSelection(chunkId, event) {
    const nextSelection = selectionFromEvent(event);
    if (!nextSelection) {
      return;
    }
    setChunkSelections((current) => ({
      ...current,
      [chunkId]: nextSelection
    }));
  }

  function splitChunk(index) {
    let splitMessage = "";
    let didSplit = false;

    setChunks((current) => {
      const chunk = current[index];
      if (!chunk) {
        return current;
      }

      const { chunks: splitParts, message } = splitTextBySelection(chunk.text, chunkSelections[chunk.id]);
      if (!splitParts) {
        splitMessage = message;
        return current;
      }

      const nextChunks = [...current];
      const timestamp = Date.now();
      const replacementChunks = splitParts.map((text, partIndex) => ({
        ...(partIndex === 0 ? chunk : {}),
        id: partIndex === 0 ? chunk.id : `${chunk.id}-split-${timestamp}-${partIndex}`,
        text,
        originalIndex: index + partIndex
      }));
      nextChunks.splice(index, 1, ...replacementChunks);
      didSplit = true;
      return nextChunks;
    });

    if (!didSplit) {
      setNotice({ status: "warning", title: "无法拆分", detail: splitMessage || "请调整选区后重试。" });
      return;
    }

    setChunkSelections({});
    setNotice(null);
  }

  function mergeWithNext(index) {
    setChunks((current) => {
      if (index < 0 || index >= current.length - 1) {
        return current;
      }
      const nextChunks = [...current];
      const merged = {
        ...nextChunks[index],
        text: `${nextChunks[index].text.trim()}\n\n${nextChunks[index + 1].text.trim()}`.trim()
      };
      nextChunks.splice(index, 2, merged);
      return nextChunks;
    });
  }

  function deleteChunk(index) {
    setChunks((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((_, chunkIndex) => chunkIndex !== index);
    });
  }

  function addChunkAfter(index) {
    setChunks((current) => {
      const nextChunks = [...current];
      nextChunks.splice(index + 1, 0, {
        id: `draft-${Date.now()}`,
        text: "",
        originalIndex: index + 1
      });
      return nextChunks;
    });
  }

  async function handleSaveChunks() {
    const chunkTexts = chunkTextsForSave(chunks);
    const payloadChunks = chunkTexts.map((text) => ({ text }));

    if (!payloadChunks.length) {
      setNotice({ status: "warning", title: "至少保留一个非空片段" });
      return;
    }

    if (areChunkTextsEqual(chunkTexts, savedChunkTexts)) {
      setNotice({ status: "neutral", title: "没有变更", detail: "当前切块内容未变化，无需重新写入向量库。" });
      return;
    }

    setSaving(true);
    setNotice(null);

    try {
      const response = await apiClient.updateRagDocumentChunks(docId, { chunks: payloadChunks });
      const data = unwrapResponse(response);
      const nextChunks = Array.isArray(data?.chunks) ? data.chunks.map(normalizeChunk) : payloadChunks.map(normalizeChunk);
      setChunks(nextChunks);
      setSavedChunkTexts(chunkTextsForSave(nextChunks));
      setNotice({
        status: "success",
        title: "切块已保存",
        detail: `${payloadChunks.length} 个片段已写入向量库。`
      });
      notifyLibraryRefresh(docId);
      window.setTimeout(() => {
        window.close();
        window.setTimeout(() => {
          if (!window.closed) {
            navigate("/rag/library", { replace: true });
          }
        }, 300);
      }, 500);
    } catch (caughtError) {
      setNotice({ status: "error", title: "保存失败", detail: caughtError.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleVectorSplit() {
    setSplitting(true);
    setNotice(null);

    try {
      const response = await apiClient.reindexRagDocument(docId, {});
      const data = unwrapResponse(response);
      const jobId = data?.jobId || data?.job?.jobId;
      if (!jobId) {
        throw new Error("未返回重建任务 ID。");
      }

      let finalJob = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const jobResponse = await apiClient.getRagJob(jobId);
        const jobData = unwrapResponse(jobResponse);
        finalJob = jobData?.job || null;
        if (finalJob?.status === "succeeded" || finalJob?.status === "failed") {
          break;
        }
      }

      if (finalJob?.status !== "succeeded") {
        throw new Error(finalJob?.error?.message || "向量拆分任务未完成。");
      }

      await loadDetail();
      setNotice({
        status: "success",
        title: "向量拆分完成",
        detail: finalJob?.result?.chunkCount ? `${finalJob.result.chunkCount} 个片段` : undefined
      });
    } catch (caughtError) {
      setNotice({ status: "error", title: "向量拆分失败", detail: caughtError.message });
    } finally {
      setSplitting(false);
    }
  }

  return (
    <main className="rag-document-standalone-page">
      <PageFrame
        eyebrow="RAG"
        title="编辑切块"
        description={manifest ? `${fileNameOf(manifest)} / ${docIdOf(manifest)}` : "向量拆分、编辑片段、合并或拆分切块。"}
        actions={(
          <>
            <Button disabled={loading || splitting || saving} icon={<IconRefresh />} loading={splitting} onClick={handleVectorSplit}>
              重新向量拆分
            </Button>
            <Button disabled={loading || splitting || saving} icon={<IconSave />} loading={saving} onClick={handleSaveChunks} type="primary">
              保存切块
            </Button>
          </>
        )}
      >
        {notice ? (
          <RagStatusBanner status={notice.status} title={notice.title} detail={notice.detail} />
        ) : null}

        {loading ? <RagLoadingState label="正在读取文档与切块" /> : null}
        {!loading && error ? (
          <RagErrorState error={error} onRetry={loadDetail} />
        ) : null}

        {!loading && !error && detail ? (
          <div className="rag-document-edit-layout">
            <Card className="section-card rag-document-edit-original" bordered>
              <div className="section-header">
                <div>
                  <h4>原文</h4>
                  <p className="section-text">{fileNameOf(manifest)}</p>
                </div>
                <Tag bordered>{formatNumber(String(detail.content || "").length)} chars</Tag>
              </div>
              <div className="rag-document-original">
                <pre>{detail.content || ""}</pre>
              </div>
            </Card>

            <Card className="section-card rag-document-edit-chunks" bordered>
              <div className="section-header">
                <div>
                  <h4>切块片段</h4>
                  <p className="section-text">{chunks.length} 个片段，可编辑后保存回向量库。</p>
                </div>
              </div>

              {chunks.length === 0 ? (
                <RagEmptyState title="暂无片段" detail="点击重新向量拆分生成片段。" />
              ) : (
                <div className="rag-chunk-editor-list">
                  {chunks.map((chunk, index) => (
                    <article className="rag-chunk-editor-card" key={chunk.id}>
                      <div className="rag-match-head">
                        <strong>Chunk {index + 1}</strong>
                        <Tag bordered>{formatNumber(chunk.text.length)} chars</Tag>
                      </div>
                      <Input.TextArea
                        autoSize={{ minRows: 5 }}
                        className="field-input field-textarea rag-chunk-editor-textarea"
                        onChange={(value) => updateChunkText(index, value)}
                        onFocus={(event) => rememberChunkSelection(chunk.id, event)}
                        onKeyUp={(event) => rememberChunkSelection(chunk.id, event)}
                        onMouseUp={(event) => rememberChunkSelection(chunk.id, event)}
                        onSelect={(event) => rememberChunkSelection(chunk.id, event)}
                        value={chunk.text}
                      />
                      <div className="rag-chunk-editor-actions">
                        <div className="rag-chunk-selection-state">
                          {selectionSize(clampSelection(chunkSelections[chunk.id], chunk.text)) > 0 ? (
                            <Tag bordered color="blue">
                              已选 {formatNumber(selectionSize(clampSelection(chunkSelections[chunk.id], chunk.text)))} chars
                            </Tag>
                          ) : null}
                        </div>
                        <div className="button-row">
                          <Button htmlType="button" onClick={() => splitChunk(index)} size="small">
                            按选区拆分
                          </Button>
                          <Button disabled={index >= chunks.length - 1} htmlType="button" onClick={() => mergeWithNext(index)} size="small">
                            合并下一个
                          </Button>
                          <Button htmlType="button" onClick={() => addChunkAfter(index)} size="small">
                            新增片段
                          </Button>
                          <Button disabled={chunks.length <= 1} htmlType="button" onClick={() => deleteChunk(index)} size="small" status="danger">
                            删除片段
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Card>
          </div>
        ) : null}
      </PageFrame>
    </main>
  );
}
