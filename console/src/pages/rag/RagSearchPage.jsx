import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, InputNumber, Select, Space, Tag } from "@arco-design/web-react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import {
  RagEmptyState,
  RagErrorState,
  RagLoadingState,
  RagStatusBanner
} from "./components";

const TextArea = Input.TextArea;
const Option = Select.Option;

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

function normalizeScore(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4) : "-";
}

function docIdOf(document) {
  return document?.docId || document?.doc_id || "";
}

function fileNameOf(document) {
  return document?.fileName || document?.file_name || "-";
}

function compactId(value) {
  const text = String(value || "");
  return text.length > 18 ? `${text.slice(0, 8)}...${text.slice(-6)}` : text;
}

function fileNameFromPath(filePath) {
  const text = String(filePath || "");
  const parts = text.split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function buildSourceItems(match) {
  const metadata = match?.metadata || {};
  const fileName =
    metadata.file_name ||
    metadata.fileName ||
    metadata.file ||
    fileNameFromPath(metadata.file_path || metadata.path);
  const sourceType = metadata.source_type || metadata.sourceType || metadata.type;
  const docId = metadata.doc_id || metadata.docId || match?.docId || match?.doc_id;
  const chunkIndex = metadata.chunk_index ?? metadata.chunkIndex;
  const startBlockIndex = metadata.start_block_index ?? metadata.startBlockIndex;
  const endBlockIndex = metadata.end_block_index ?? metadata.endBlockIndex;
  const items = [];

  if (fileName) {
    items.push({ label: "文件", value: fileName });
  }

  if (sourceType) {
    items.push({ label: "类型", value: sourceType });
  }

  if (docId) {
    items.push({ label: "Doc", value: compactId(docId) });
  }

  if (chunkIndex !== undefined && chunkIndex !== null && chunkIndex !== "") {
    items.push({ label: "Chunk", value: String(chunkIndex) });
  } else if (startBlockIndex !== undefined && startBlockIndex !== null && startBlockIndex !== "") {
    const blockValue =
      endBlockIndex !== undefined && endBlockIndex !== null && endBlockIndex !== "" && endBlockIndex !== startBlockIndex
        ? `${startBlockIndex}-${endBlockIndex}`
        : String(startBlockIndex);
    items.push({ label: "Block", value: blockValue });
  }

  return items.length > 0 ? items : [{ label: "来源", value: "未标记" }];
}

export function RagSearchPage() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState("3");
  const [docId, setDocId] = useState("");
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const matches = useMemo(
    () => (Array.isArray(result?.matches) ? result.matches : []),
    [result]
  );

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    setDocumentsError(null);

    try {
      const response = await apiClient.listRagDocuments();
      const data = unwrapResponse(response);
      setDocuments(Array.isArray(data?.documents) ? data.documents : []);
    } catch (caughtError) {
      setDocuments([]);
      setDocumentsError(caughtError);
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!query.trim()) {
      setResult(null);
      setError(new Error("query 不能为空。"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = {
        requestId: `console-rag-${Date.now()}`,
        query: query.trim(),
        topK: Number(topK) || 3
      };

      if (docId.trim()) {
        payload.docId = docId.trim();
      }

      const response = await apiClient.searchRag(payload);
      setResult(unwrapResponse(response));
    } catch (caughtError) {
      setResult(null);
      setError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageFrame
      eyebrow="RAG"
      title="检索测试"
      description="输入业务问题，查看本地知识库返回的相似片段。"
    >
      <form className="rag-search-layout" onSubmit={handleSubmit}>
        <Card className="section-card rag-search-query-card" bordered>
          <div className="form-stack">
            <label className="field-group">
              <span>Query</span>
              <TextArea
                className="field-input rag-query-input"
                onChange={setQuery}
                placeholder="输入需要检索的业务问题或定制要求"
                value={query}
              />
            </label>

            <div className="form-grid-two">
              <label className="field-group">
                <span>Top K</span>
                <InputNumber
                  className="field-input"
                  min={1}
                  max={10}
                  onChange={(value) => setTopK(String(value || ""))}
                  value={topK === "" ? undefined : Number(topK)}
                />
              </label>
              <label className="field-group">
                <span>Doc ID</span>
                <Select
                  allowClear
                  className="field-input rag-doc-select"
                  loading={documentsLoading}
                  notFoundContent={documentsError ? "文档列表加载失败" : "暂无文档"}
                  onChange={(value) => setDocId(value || "")}
                  placeholder={documentsLoading ? "正在加载文档" : "全部文档"}
                  showSearch
                  value={docId || undefined}
                >
                  {documents.map((document) => {
                    const optionDocId = docIdOf(document);
                    return (
                      <Option key={optionDocId} value={optionDocId}>
                        {fileNameOf(document)} / {optionDocId}
                      </Option>
                    );
                  })}
                </Select>
                {documentsError ? (
                  <p className="field-help field-help-warning">文档列表加载失败，检索仍可按全库执行。</p>
                ) : null}
              </label>
            </div>

            <div className="button-row">
              <Button htmlType="submit" loading={loading} type="primary">
                执行检索
              </Button>
              <Button
                onClick={() => {
                  setQuery("");
                  setDocId("");
                  setResult(null);
                  setError(null);
                }}
              >
                清空
              </Button>
            </div>
          </div>
        </Card>

        <Card className="section-card rag-search-results-card" bordered>
          <div className="section-header">
            <div>
              <h4>返回结果</h4>
              <p className="section-text">
                {result ? `query: ${result.query || query}` : "等待检索请求"}
              </p>
            </div>
            {result ? <Tag bordered>Top K {result.topK || topK}</Tag> : null}
          </div>

          {loading ? <RagLoadingState label="正在检索" /> : null}
          {!loading && error ? <RagErrorState error={error} /> : null}
          {!loading && !error && !result ? (
            <RagEmptyState title="暂无检索结果" detail="提交 query 后会展示 matches。" />
          ) : null}
          {!loading && !error && result && matches.length === 0 ? (
            <RagStatusBanner
              status="warning"
              title="未命中片段"
              detail="当前 query 没有返回 matches。"
            />
          ) : null}
          {!loading && !error && matches.length > 0 ? (
            <div className="rag-match-list">
              {matches.map((match, index) => (
                <article className="rag-match-card" key={`${index}-${match.text?.slice(0, 24) || "match"}`}>
                  <div className="rag-match-head">
                    <strong>Match {index + 1}</strong>
                    <Space wrap>
                      <Tag bordered color="arcoblue">score {normalizeScore(match.score)}</Tag>
                      <Tag bordered>distance {normalizeScore(match.distance)}</Tag>
                    </Space>
                  </div>
                  <p className="rag-match-text">{match.text || "-"}</p>
                  <div className="rag-source-strip" aria-label="片段来源">
                    {buildSourceItems(match).map((item) => (
                      <span className="rag-source-item" key={`${item.label}-${item.value}`}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </Card>
      </form>
    </PageFrame>
  );
}
