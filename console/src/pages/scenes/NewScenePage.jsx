import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { consoleClient } from "../../services/clientFactory";

const DEFAULT_INPUT_CONTRACT = {
  required: ["rawText"],
  fields: {
    rawText: {
      type: "string",
      sourcePath: "request.bizParams.rawText"
    }
  }
};

const DEFAULT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {},
  required: []
};

const QUERY_OPERATORS = [
  ["equals", "等于"],
  ["contains", "包含"],
  ["starts_with", "开头匹配"],
  ["ends_with", "结尾匹配"],
  ["greater_or_equal", "大于等于"],
  ["less_or_equal", "小于等于"],
  ["in", "包含于数组"]
];

const RESULT_MODES = [
  ["single-row", "单条记录"],
  ["multi-rows", "多条记录"],
  ["column-values", "列值列表"],
  ["aggregate-value", "聚合值"]
];
const SCENE_ID_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const QUERY_NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJsonField(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON：${error.message}`);
  }
}

function validateSlug(value, label, { min = 3, max = 80 } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    throw new Error(`${label} 不能为空。`);
  }
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${label} 长度必须是 ${min} 到 ${max} 个字符。`);
  }
  if (!SCENE_ID_PATTERN.test(normalized) || normalized.includes("--")) {
    throw new Error(`${label} 只能使用小写字母、数字和中划线，必须以小写字母开头，并以小写字母或数字结尾。`);
  }

  return normalized;
}

function validateQueryName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("QueryProfile 名称不能为空。");
  }
  if (normalized.length < 3 || normalized.length > 100 || !QUERY_NAME_PATTERN.test(normalized) || normalized.includes("--")) {
    throw new Error("QueryProfile 名称只能使用小写字母、数字和中划线，必须以小写字母开头，并以小写字母或数字结尾。");
  }

  return normalized;
}

function buildTemplateKey(template) {
  return template?.name ? `${template.name}@${template.version || "v1"}` : "";
}

function deriveFieldNames(inputContract = {}) {
  const required = Array.isArray(inputContract.required) ? inputContract.required : [];
  const fields = inputContract.fields && typeof inputContract.fields === "object"
    ? Object.keys(inputContract.fields)
    : [];
  return Array.from(new Set([...required, ...fields])).filter(Boolean);
}

function formatErrorDetails(response) {
  const error = response?.payload?.error;
  if (!error?.details) {
    return "";
  }

  return JSON.stringify(error.details, null, 2);
}

export function NewScenePage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [templatesStatus, setTemplatesStatus] = useState("loading");
  const [templatesError, setTemplatesError] = useState("");
  const [scene, setScene] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [inputContractText, setInputContractText] = useState(prettyJson(DEFAULT_INPUT_CONTRACT));
  const [outputSchemaText, setOutputSchemaText] = useState(prettyJson(DEFAULT_OUTPUT_SCHEMA));
  const [promptText, setPromptText] = useState("");
  const [dictionaryText, setDictionaryText] = useState("");
  const [rulesText, setRulesText] = useState("");
  const [queryName, setQueryName] = useState("");
  const [queryTitle, setQueryTitle] = useState("");
  const [queryTable, setQueryTable] = useState("");
  const [queryIdField, setQueryIdField] = useState("");
  const [queryWhereField, setQueryWhereField] = useState("");
  const [queryOperator, setQueryOperator] = useState("equals");
  const [queryParam, setQueryParam] = useState("");
  const [queryResultMode, setQueryResultMode] = useState("single-row");
  const [queryResultFields, setQueryResultFields] = useState("*");
  const [queryLimit, setQueryLimit] = useState("1");
  const [ragTopK, setRagTopK] = useState("5");
  const [ragDocId, setRagDocId] = useState("");
  const [ragQuery, setRagQuery] = useState("");
  const [ragFailOnError, setRagFailOnError] = useState(true);
  const [submitStatus, setSubmitStatus] = useState("idle");
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitDetails, setSubmitDetails] = useState("");

  useEffect(() => {
    let active = true;

    async function loadTemplates() {
      setTemplatesStatus("loading");
      setTemplatesError("");

      try {
        const response = await consoleClient.listSceneTemplates();
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setTemplatesStatus("error");
          setTemplatesError(response?.payload?.error?.message || "模板列表读取失败。");
          return;
        }

        const nextTemplates = response?.payload?.data?.items || [];
        setTemplates(nextTemplates);
        setTemplateKey((current) => current || buildTemplateKey(nextTemplates[0]));
        setTemplatesStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setTemplatesStatus("error");
        setTemplatesError(error.message || "模板列表读取失败。");
      }
    }

    loadTemplates();

    return () => {
      active = false;
    };
  }, []);

  const selectedTemplate = useMemo(() => {
    return templates.find((template) => buildTemplateKey(template) === templateKey) || null;
  }, [templates, templateKey]);

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }

    if (selectedTemplate.inputContract) {
      setInputContractText(prettyJson(selectedTemplate.inputContract));
    }
    if (selectedTemplate.outputSchema) {
      setOutputSchemaText(prettyJson(selectedTemplate.outputSchema));
    }

    setPromptText(selectedTemplate.assetDefaults?.prompt?.contentText || "");
    setDictionaryText(selectedTemplate.assetDefaults?.dictionary?.contentText || "field_name\tfield_description\n");
    setRulesText(selectedTemplate.assetDefaults?.rules?.contentText || "");

    const queryDefaults = selectedTemplate.queryProfileDefaults;
    if (queryDefaults?.primaryEntity) {
      setQueryTable(queryDefaults.primaryEntity.table || "");
      setQueryIdField(queryDefaults.primaryEntity.idField || "");
    }
    if (queryDefaults?.where) {
      setQueryWhereField(queryDefaults.where.field || "");
      setQueryOperator(queryDefaults.where.operator || "equals");
      setQueryParam(queryDefaults.where.param || "");
    }
    if (queryDefaults?.resultPolicy) {
      setQueryResultMode(queryDefaults.resultPolicy.mode || "single-row");
      setQueryResultFields(Array.isArray(queryDefaults.resultPolicy.fields)
        ? queryDefaults.resultPolicy.fields.join(", ")
        : "*");
      setQueryLimit(String(queryDefaults.resultPolicy.limit || 1));
    }

    const ragDefaults = selectedTemplate.ragDefaults;
    if (ragDefaults) {
      setRagTopK(String(ragDefaults.topK || 5));
      setRagDocId(ragDefaults.docId || "");
      setRagQuery(ragDefaults.query || "");
      setRagFailOnError(ragDefaults.failOnError !== false);
    }
  }, [selectedTemplate]);

  const inputFieldNames = useMemo(() => {
    try {
      return deriveFieldNames(JSON.parse(inputContractText));
    } catch (error) {
      return [];
    }
  }, [inputContractText]);

  useEffect(() => {
    if (!scene.trim()) {
      return;
    }

    setQueryName((current) => current || `${scene.trim().toLowerCase()}-query`);
  }, [scene]);

  useEffect(() => {
    if (!inputFieldNames.length) {
      return;
    }

    setQueryParam((current) => current || inputFieldNames[0]);
    setQueryWhereField((current) => current || inputFieldNames[0]);
    setQueryIdField((current) => current || inputFieldNames[0]);
  }, [inputFieldNames]);

  useEffect(() => {
    if (queryResultMode === "single-row") {
      setQueryLimit("1");
    } else if (queryLimit === "1") {
      setQueryLimit("20");
    }
  }, [queryResultMode]);

  function buildPayload() {
    const inputContract = parseJsonField(inputContractText, "输入配置");
    const outputSchema = parseJsonField(outputSchemaText, "输出结构");
    const [templateName, templateVersion = "v1"] = templateKey.split("@");
    const normalizedScene = validateSlug(scene, "Scene ID");
    const payload = {
      scene: normalizedScene,
      title,
      description,
      templateRef: {
        name: templateName,
        version: templateVersion
      },
      inputContract,
      outputSchema,
      assets: {
        prompt: {
          contentText: promptText
        }
      }
    };

    if (selectedTemplate?.supportedAssetTypes?.includes("dictionary")) {
      payload.assets.dictionary = {
        contentText: dictionaryText
      };
    }

    if (selectedTemplate?.supportedAssetTypes?.includes("rules")) {
      payload.assets.rules = {
        contentText: rulesText
      };
    }

    if (selectedTemplate?.requiresQueryProfile) {
      payload.queryProfile = {
        enabled: true,
        name: validateQueryName(queryName),
        title: queryTitle,
        primaryEntity: {
          table: queryTable,
          idField: queryIdField || queryWhereField
        },
        where: [
          {
            field: queryWhereField,
            operator: queryOperator,
            param: queryParam
          }
        ],
        resultPolicy: {
          mode: queryResultMode,
          fields: queryResultFields
            .split(",")
            .map((fieldName) => fieldName.trim())
            .filter(Boolean),
          limit: Number(queryLimit)
        }
      };
    }

    if (selectedTemplate?.requiresRag) {
      payload.ragConfig = {
        topK: Number(ragTopK),
        docId: ragDocId,
        query: ragQuery,
        failOnError: ragFailOnError
      };
    }

    return payload;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitStatus("saving");
    setSubmitMessage("");
    setSubmitDetails("");

    let payload;
    try {
      payload = buildPayload();
    } catch (error) {
      setSubmitStatus("error");
      setSubmitMessage(error.message || "表单内容无效。");
      return;
    }

    try {
      const response = await consoleClient.createScene(payload);
      if (!response?.ok || response?.payload?.success === false) {
        setSubmitStatus("error");
        setSubmitMessage(response?.payload?.error?.message || "场景草稿创建失败。");
        setSubmitDetails(formatErrorDetails(response));
        return;
      }

      const createdScene = response?.payload?.data?.scene || payload.scene;
      setSubmitStatus("success");
      setSubmitMessage("场景草稿已创建。");
      navigate(`/scenes/${createdScene}`);
    } catch (error) {
      setSubmitStatus("error");
      setSubmitMessage(error.message || "场景草稿创建失败。");
    }
  }

  const previewItems = [
    { label: "场景模板", value: selectedTemplate ? `${selectedTemplate.sourceSceneTitle || selectedTemplate.title} (${buildTemplateKey(selectedTemplate)})` : "-" },
    { label: "来源场景", value: selectedTemplate?.sourceScene || "-" },
    { label: "底层流程", value: selectedTemplate?.workflowTemplateRef ? `${selectedTemplate.workflowTemplateRef.name}@${selectedTemplate.workflowTemplateRef.version}` : "-" },
    { label: "模板节点", value: selectedTemplate ? `${selectedTemplate.nodeCount || 0}` : "-" },
    { label: "查询配置", value: selectedTemplate?.requiresQueryProfile ? "启用" : "不启用" },
    { label: "RAG 检索", value: selectedTemplate?.requiresRag ? "启用" : "不启用" },
    { label: "草稿资源", value: selectedTemplate?.requiresQueryProfile ? "scene config / skill / query / assets" : "scene config / skill / assets" }
  ];

  return (
    <PageFrame
      eyebrow="场景"
      title="新增场景"
      description="选择一个现有场景抽象出的场景模板，保存后进入现有编译预览和发布链路。"
      actions={<Link className="button-secondary" to="/scenes">返回列表</Link>}
    >
      {templatesStatus === "error" ? (
        <section className="section-card">
          <h4>模板读取失败</h4>
          <p className="muted-text">{templatesError}</p>
        </section>
      ) : null}

      <form className="new-scene-layout" onSubmit={handleSubmit}>
        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">基础信息</p>
              <h4>场景与场景模板</h4>
            </div>
            <span className="pill">
              {templatesStatus === "loading" ? "读取模板" : "写入草稿"}
            </span>
          </div>

          <div className="form-grid-two">
            <div className="field-group">
              <label htmlFor="new-scene-id">Scene ID</label>
              <input
                className="field-input"
                id="new-scene-id"
                onChange={(event) => setScene(event.target.value)}
                placeholder="例如：customer-complaint-attribution"
                required
                value={scene}
              />
              <p className="field-help">3 到 80 位；只能用小写字母、数字和中划线；必须以小写字母开头，不能用纯数字，例如 `scene-9527`。</p>
            </div>
            <div className="field-group">
              <label htmlFor="new-scene-title">标题</label>
              <input
                className="field-input"
                id="new-scene-title"
                onChange={(event) => setTitle(event.target.value)}
                placeholder="客户投诉归因"
                required
                value={title}
              />
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="new-scene-description">描述</label>
            <textarea
              className="field-input"
              id="new-scene-description"
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
          </div>

          <div className="field-group">
            <label htmlFor="new-scene-template">场景模板</label>
            <select
              className="field-input"
              disabled={templatesStatus === "loading"}
              id="new-scene-template"
              onChange={(event) => setTemplateKey(event.target.value)}
              required
              value={templateKey}
            >
              <option value="">请选择模板</option>
              {templates.map((template) => (
                <option
                  key={buildTemplateKey(template)}
                  value={buildTemplateKey(template)}
                >
                  {template.sourceSceneTitle || template.title || template.name} ({buildTemplateKey(template)})
                </option>
              ))}
            </select>
          </div>

          {selectedTemplate ? (
            <div className="template-summary-grid">
              <div className="meta-block">
                <span className="meta-label">来源场景</span>
                <span className="meta-value">{selectedTemplate.sourceScene || "-"}</span>
              </div>
              <div className="meta-block">
                <span className="meta-label">底层流程</span>
                <span className="meta-value">
                  {selectedTemplate.workflowTemplateRef
                    ? `${selectedTemplate.workflowTemplateRef.name}@${selectedTemplate.workflowTemplateRef.version}`
                    : "-"}
                </span>
              </div>
              <div className="meta-block">
                <span className="meta-label">查询</span>
                <span className="meta-value">
                  {selectedTemplate.requiresQueryProfile ? "需要 QueryProfile" : "不需要 QueryProfile"}
                </span>
              </div>
              <div className="meta-block">
                <span className="meta-label">RAG</span>
                <span className="meta-value">
                  {selectedTemplate.requiresRag ? "启用知识检索" : "不启用"}
                </span>
              </div>
              <div className="meta-block">
                <span className="meta-label">资产</span>
                <span className="meta-value">
                  {selectedTemplate.supportedAssetTypes?.join(" / ") || "-"}
                </span>
              </div>
              <div className="meta-block">
                <span className="meta-label">节点</span>
                <span className="meta-value">{selectedTemplate.orderedNodeIds?.join(" -> ") || "-"}</span>
              </div>
            </div>
          ) : null}
        </section>

        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">契约</p>
              <h4>输入与输出</h4>
            </div>
          </div>

          <div className="form-grid-two">
            <div className="field-group">
              <label htmlFor="new-scene-input-contract">输入配置 JSON</label>
              <textarea
                className="field-input field-textarea new-scene-json"
                id="new-scene-input-contract"
                onChange={(event) => setInputContractText(event.target.value)}
                value={inputContractText}
              />
            </div>
            <div className="field-group">
              <label htmlFor="new-scene-output-schema">输出结构 JSON Schema</label>
              <textarea
                className="field-input field-textarea new-scene-json"
                id="new-scene-output-schema"
                onChange={(event) => setOutputSchemaText(event.target.value)}
                value={outputSchemaText}
              />
            </div>
          </div>
        </section>

        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">资产</p>
              <h4>Prompt / 字典 / 规则</h4>
            </div>
            <span className="pill">写入草稿资产</span>
          </div>

          <div className="field-group">
            <label htmlFor="new-scene-prompt">Prompt</label>
            <textarea
              className="field-input field-textarea new-scene-asset-textarea"
              id="new-scene-prompt"
              onChange={(event) => setPromptText(event.target.value)}
              value={promptText}
            />
          </div>

          {selectedTemplate?.supportedAssetTypes?.includes("dictionary") ? (
            <div className="field-group">
              <label htmlFor="new-scene-dictionary">Dictionary TSV</label>
              <textarea
                className="field-input field-textarea new-scene-asset-textarea"
                id="new-scene-dictionary"
                onChange={(event) => setDictionaryText(event.target.value)}
                value={dictionaryText}
              />
            </div>
          ) : null}

          {selectedTemplate?.supportedAssetTypes?.includes("rules") ? (
            <div className="field-group">
              <label htmlFor="new-scene-rules">Rules</label>
              <textarea
                className="field-input field-textarea new-scene-asset-textarea"
                id="new-scene-rules"
                onChange={(event) => setRulesText(event.target.value)}
                value={rulesText}
              />
            </div>
          ) : null}
        </section>

        {selectedTemplate?.requiresQueryProfile ? (
          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">查询</p>
                <h4>QueryProfile</h4>
              </div>
              <span className="pill">generic-query-runner</span>
            </div>

            <div className="form-grid-two">
              <div className="field-group">
                <label htmlFor="new-scene-query-name">QueryProfile 名称</label>
                <input
                  className="field-input"
                  id="new-scene-query-name"
                  onChange={(event) => setQueryName(event.target.value)}
                  placeholder="例如：customer-orders-by-customer-id"
                  required
                  value={queryName}
                />
                <p className="field-help">3 到 100 位；只能用小写字母、数字和中划线；必须以小写字母开头，例如 `order-query-9527`。</p>
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-query-title">QueryProfile 标题</label>
                <input
                  className="field-input"
                  id="new-scene-query-title"
                  onChange={(event) => setQueryTitle(event.target.value)}
                  value={queryTitle}
                />
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-query-table">主表</label>
                <input
                  className="field-input"
                  id="new-scene-query-table"
                  onChange={(event) => setQueryTable(event.target.value)}
                  placeholder="t_customer_order"
                  required
                  value={queryTable}
                />
                <p className="field-help">填写数据库表名，只允许安全标识符，例如 `t_customer_order`。</p>
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-query-id-field">主键 / 业务标识字段</label>
                <input
                  className="field-input"
                  id="new-scene-query-id-field"
                  onChange={(event) => setQueryIdField(event.target.value)}
                  required
                  value={queryIdField}
                />
                <p className="field-help">填写主键或业务标识字段名，例如 `customerId`、`opportunityId`。</p>
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-query-where-field">条件字段</label>
                <input
                  className="field-input"
                  id="new-scene-query-where-field"
                  onChange={(event) => setQueryWhereField(event.target.value)}
                  required
                  value={queryWhereField}
                />
                <p className="field-help">填写用于过滤的字段名，不能写 SQL 片段。</p>
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-query-param">请求参数</label>
                <select
                  className="field-input"
                  id="new-scene-query-param"
                  onChange={(event) => setQueryParam(event.target.value)}
                  required
                  value={queryParam}
                >
                  <option value="">请选择参数</option>
                  {inputFieldNames.map((fieldName) => (
                    <option key={fieldName} value={fieldName}>
                      {fieldName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-query-operator">条件操作符</label>
                <select
                  className="field-input"
                  id="new-scene-query-operator"
                  onChange={(event) => setQueryOperator(event.target.value)}
                  value={queryOperator}
                >
                  {QUERY_OPERATORS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-query-mode">结果模式</label>
                <select
                  className="field-input"
                  id="new-scene-query-mode"
                  onChange={(event) => setQueryResultMode(event.target.value)}
                  value={queryResultMode}
                >
                  {RESULT_MODES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-query-fields">返回字段</label>
                <input
                  className="field-input"
                  id="new-scene-query-fields"
                  onChange={(event) => setQueryResultFields(event.target.value)}
                  required
                  value={queryResultFields}
                />
                <p className="field-help">可填 `*`，或用英文逗号分隔字段名；不要把 `*` 和字段名混用。</p>
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-query-limit">Limit</label>
                <input
                  className="field-input"
                  id="new-scene-query-limit"
                  min="1"
                  onChange={(event) => setQueryLimit(event.target.value)}
                  required
                  type="number"
                  value={queryLimit}
                />
                <p className="field-help">必须填写；范围 1 到 1000。单条记录模式固定为 1。</p>
              </div>
            </div>
          </section>
        ) : null}

        {selectedTemplate?.requiresRag ? (
          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">RAG</p>
                <h4>检索策略</h4>
              </div>
              <span className="pill">retrieve_knowledge_context</span>
            </div>

            <div className="form-grid-two">
              <div className="field-group">
                <label htmlFor="new-scene-rag-topk">TopK</label>
                <input
                  className="field-input"
                  id="new-scene-rag-topk"
                  max="20"
                  min="1"
                  onChange={(event) => setRagTopK(event.target.value)}
                  required
                  type="number"
                  value={ragTopK}
                />
              </div>
              <div className="field-group">
                <label htmlFor="new-scene-rag-docid">限定文档 ID</label>
                <input
                  className="field-input"
                  id="new-scene-rag-docid"
                  onChange={(event) => setRagDocId(event.target.value)}
                  placeholder="留空表示不限定"
                  value={ragDocId}
                />
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="new-scene-rag-query">检索 query 覆盖</label>
              <input
                className="field-input"
                id="new-scene-rag-query"
                onChange={(event) => setRagQuery(event.target.value)}
                placeholder="留空表示运行时按请求构造"
                value={ragQuery}
              />
            </div>

            <label className="checkbox-row" htmlFor="new-scene-rag-fail">
              <input
                checked={ragFailOnError}
                id="new-scene-rag-fail"
                onChange={(event) => setRagFailOnError(event.target.checked)}
                type="checkbox"
              />
              <span>检索失败时阻断生成</span>
            </label>
          </section>
        ) : null}

        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">预览</p>
              <h4>编译输入</h4>
            </div>
          </div>
          <div className="kv-grid">
            {previewItems.map((item) => (
              <div className="meta-block" key={item.label}>
                <span className="meta-label">{item.label}</span>
                <span className="meta-value">{item.value}</span>
              </div>
            ))}
          </div>

          {submitStatus === "error" ? (
            <div className="callout callout-error">
              <strong>保存失败</strong>
              <p>{submitMessage}</p>
              {submitDetails ? <pre className="error-detail-pre">{submitDetails}</pre> : null}
            </div>
          ) : null}

          {submitStatus === "success" ? (
            <div className="callout callout-success">
              <strong>已完成</strong>
              <p>{submitMessage}</p>
            </div>
          ) : null}

          <div className="button-row">
            <button
              className="button-primary"
              disabled={submitStatus === "saving" || templatesStatus === "loading"}
              type="submit"
            >
              {submitStatus === "saving" ? "保存中..." : "保存草稿"}
            </button>
            <Link className="button-secondary" to="/scenes">取消</Link>
          </div>
        </section>
      </form>
    </PageFrame>
  );
}
