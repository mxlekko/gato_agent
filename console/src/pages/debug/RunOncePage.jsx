import { useEffect, useMemo, useRef, useState } from "react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";

const CONTRACT_REVIEW_SCENE = "non-standard-contract-risk-review";
const CONTRACT_FILE_ACCEPT = [
  ".bmp",
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".doc",
  ".docx",
  ".wps",
  ".pdf",
  ".ofd",
  ".xlsx",
  "image/bmp",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "application/msword",
  "application/pdf",
  "application/ofd",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
].join(",");

const scenePresets = {
  "payment-info-split": {
    label: "收款信息拆分",
    note: "默认示例走直模链路，通常最适合先验证前后端联调链路是否畅通。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      rawText:
        "收款方：上海某某科技有限公司；开户行：中国银行上海浦东分行；账号：1234567890123456789"
    }
  },
  "sales-opportunity-advisor": {
    label: "销售机会推进建议（辅助链路）",
    note: "该场景依赖网关、上下文辅助器、模型工具和技能链路，适合验证运行时场景。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      opportunityId: "2052956605598666752"
    }
  },
  "sales-opportunity-smart-entry": {
    label: "销售机会智能录入",
    note: "该场景是销售机会推进建议的独立复制场景，拥有自己的 skill、query 和可编辑资产文件。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      opportunityId: "2052956605598666752",
      rawText:
        "客户确认这单属于招标已设计场景，推荐品牌可以替换，核心参数满足，投标时间改为2026-04-30，采购时间预计2026-05-20。"
    }
  },
  "sales-opportunity-advisor-directdb": {
    label: "销售机会推进建议（直连数据库）",
    note: "该场景依赖网关、直连数据库执行器、模型工具和技能链路，适合验证配置化第二业务。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      opportunityId: "2052956605598666752"
    }
  },
  "special-custom-product-solution": {
    label: "特殊定制产品部方案",
    note: "该场景使用定制要求调用本地 RAG 检索相似片段，再生成产品部方案 JSON；需要 19104 RAG 服务可用。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      specialCustomOrderNo: "TSDZ-20260428-001",
      customRequirement:
        "客户需要基于现有销售画像能力做一个特殊定制方案：支持按行业、区域和客户等级组合筛选，输出重点客户清单，并在页面展示推荐理由、最近拜访记录和下一步跟进建议。"
    }
  },
  [CONTRACT_REVIEW_SCENE]: {
    label: "非标合同风险审查",
    note: "该场景使用 baseFile/baseFileURL 二选一。单次调试可直接上传合同文件，页面会按 multipart/form-data 发送。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {}
  }
};

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function buildInitialFormState(scene = "payment-info-split", bizParamsExample = null) {
  const preset = scenePresets[scene];

  return {
    scene,
    tenantId: preset?.tenantId || "tenant-a",
    userId: preset?.userId || "user-a",
    bizParamsText: prettyJson(preset?.bizParams || bizParamsExample || {})
  };
}

function sampleValueForBizParam(fieldName) {
  const normalized = String(fieldName || "").trim();
  const lowerName = normalized.toLowerCase();

  if (!normalized) {
    return "示例值";
  }

  if (lowerName === "opportunityid" || lowerName.endsWith("opportunityid")) {
    return "2052956605598666752";
  }

  if (lowerName === "rawtext" || lowerName.endsWith("text")) {
    return "客户确认这单属于招标已设计场景，核心参数满足，预计 2026-05-20 完成采购。";
  }

  if (lowerName === "basefileurl") {
    return "https://example.com/contracts/contract.pdf";
  }

  if (lowerName.includes("requirement") || lowerName.includes("需求")) {
    return "客户需要按行业、区域和客户等级组合筛选，输出重点客户清单和下一步跟进建议。";
  }

  if (lowerName.endsWith("no") || lowerName.endsWith("code") || lowerName.includes("order")) {
    return "TEST-20260507-001";
  }

  if (lowerName.endsWith("id")) {
    return `${normalized}-001`;
  }

  if (lowerName.includes("date") || lowerName.includes("time")) {
    return "2026-05-07";
  }

  if (lowerName.includes("count") || lowerName.includes("amount") || lowerName.includes("limit")) {
    return 1;
  }

  return `示例${normalized}`;
}

function extractBizParamNameFromMapping(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^request\.bizParams\.([a-zA-Z0-9_-]+)$/u);
  return match ? match[1] : "";
}

function buildBizParamsExampleFromWorkflow(workflow) {
  const inputContract = workflow?.inputContract || {};
  const names = new Set();

  for (const fieldName of inputContract.requiredBizParams || []) {
    if (fieldName) {
      names.add(fieldName);
    }
  }

  for (const [fieldName, mappingValue] of Object.entries(inputContract.inputMapping || {})) {
    if (fieldName) {
      names.add(fieldName);
    }

    const mappedName = extractBizParamNameFromMapping(mappingValue);
    if (mappedName) {
      names.add(mappedName);
    }
  }

  return Object.fromEntries(
    Array.from(names).map((fieldName) => [fieldName, sampleValueForBizParam(fieldName)])
  );
}

function getScenePublishState(sceneItem) {
  const publishState = sceneItem?.publishState || sceneItem?.configState?.publishState || "";
  const hasPublishedSnapshot = sceneItem?.hasPublishedSnapshot ?? sceneItem?.configState?.hasPublishedSnapshot;
  const hasUnpublishedChanges = sceneItem?.configState?.hasUnpublishedChanges === true;

  if (publishState === "unpublished" || hasPublishedSnapshot === false) {
    return {
      runnable: false,
      label: "未发布",
      help: "这个场景目前只有配置中心草稿，还没有进入 active runtime。发布成功后才能在单次请求调试中执行。"
    };
  }

  if (hasUnpublishedChanges) {
    return {
      runnable: true,
      label: "运行当前发布版",
      help: "这个场景有草稿未发布；单次请求调试会运行 active runtime 中的当前发布版本。"
    };
  }

  return {
    runnable: true,
    label: "可运行",
    help: "这个场景已经发布到 active runtime，可以通过真实接口调试。"
  };
}

function buildSceneOptions(sceneItems, listStatus) {
  if (sceneItems.length === 0 && listStatus !== "ready") {
    return Object.entries(scenePresets).map(([scene, preset]) => ({
      scene,
      label: preset.label,
      note: preset.note,
      publishLabel: "内置示例",
      runnable: true
    }));
  }

  const seen = new Set();
  const options = sceneItems.map((item) => {
    seen.add(item.scene);
    const preset = scenePresets[item.scene];
    const publishState = getScenePublishState(item);

    return {
      scene: item.scene,
      label: item.title || preset?.label || item.scene,
      note: preset?.note || publishState.help,
      publishLabel: publishState.label,
      runnable: publishState.runnable
    };
  });

  for (const [scene, preset] of Object.entries(scenePresets)) {
    if (!seen.has(scene)) {
      options.push({
        scene,
        label: preset.label,
        note: preset.note,
        publishLabel: "内置示例",
        runnable: true
      });
    }
  }

  return options;
}

function buildRequestBody({ scene, tenantId, userId, bizParams }) {
  const body = {
    scene,
    bizParams
  };

  const normalizedTenantId = tenantId.trim();
  const normalizedUserId = userId.trim();

  if (normalizedTenantId || normalizedUserId) {
    body.runtimeContext = {
      tenantId: normalizedTenantId || undefined,
      userId: normalizedUserId || undefined
    };
  }

  return body;
}

function formatFileSize(value) {
  const bytes = Number(value);
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

function buildContractReviewFormData({ scene, tenantId, userId, file, baseFileURL }) {
  const formData = new FormData();
  formData.append("scene", scene);

  if (file) {
    formData.append("baseFile", file, file.name);
  } else {
    formData.append("baseFileURL", baseFileURL.trim());
  }

  const normalizedTenantId = tenantId.trim();
  const normalizedUserId = userId.trim();
  if (normalizedTenantId || normalizedUserId) {
    formData.append("runtimeContext", JSON.stringify({
      tenantId: normalizedTenantId || undefined,
      userId: normalizedUserId || undefined
    }));
  }

  return formData;
}

function buildContractReviewPreview({ scene, tenantId, userId, file, baseFileURL }) {
  const preview = {
    contentType: "multipart/form-data",
    scene,
    fields: {}
  };

  if (file) {
    preview.fields.baseFile = {
      fileName: file.name,
      fileMimeType: file.type || null,
      sizeBytes: file.size,
      size: formatFileSize(file.size)
    };
  } else if (baseFileURL.trim()) {
    preview.fields.baseFileURL = baseFileURL.trim();
  } else {
    preview.fields.baseFile = null;
    preview.fields.baseFileURL = null;
  }

  const normalizedTenantId = tenantId.trim();
  const normalizedUserId = userId.trim();
  if (normalizedTenantId || normalizedUserId) {
    preview.runtimeContext = {
      tenantId: normalizedTenantId || undefined,
      userId: normalizedUserId || undefined
    };
  }

  return preview;
}

export function RunOncePage() {
  const [formState, setFormState] = useState(() =>
    buildInitialFormState("payment-info-split")
  );
  const [sceneItems, setSceneItems] = useState([]);
  const [sceneListStatus, setSceneListStatus] = useState("loading");
  const [sceneListError, setSceneListError] = useState("");
  const [sceneExampleStatus, setSceneExampleStatus] = useState("idle");
  const [sceneExampleMessage, setSceneExampleMessage] = useState("");
  const [sceneExampleReloadKey, setSceneExampleReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");
  const [lastRun, setLastRun] = useState(null);
  const [contractFile, setContractFile] = useState(null);
  const [contractFileURL, setContractFileURL] = useState("");
  const contractFileInputRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function loadScenes() {
      setSceneListStatus("loading");
      setSceneListError("");

      try {
        const response = await apiClient.listScenes();
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setSceneListStatus("error");
          setSceneListError(response?.payload?.error?.message || "场景列表读取失败。");
          return;
        }

        const items = response?.payload?.data?.items || [];
        setSceneItems(items);
        setSceneListStatus("ready");

        if (!items.some((item) => item.scene === formState.scene)) {
          const fallbackScene = (
            items.find((item) => getScenePublishState(item).runnable)
            || items[0]
          )?.scene;

          if (fallbackScene) {
            setFormState(buildInitialFormState(fallbackScene));
          }
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setSceneListStatus("error");
        setSceneListError(error.message || "场景列表读取失败。");
      }
    }

    loadScenes();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadDynamicExample() {
      if (!formState.scene || scenePresets[formState.scene]) {
        setSceneExampleStatus("idle");
        setSceneExampleMessage("");
        return;
      }

      setSceneExampleStatus("loading");
      setSceneExampleMessage("正在按场景输入契约生成业务参数示例。");

      try {
        const response = await apiClient.getSceneWorkflow(formState.scene);
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setSceneExampleStatus("error");
          setSceneExampleMessage(response?.payload?.error?.message || "业务参数示例生成失败。");
          return;
        }

        const example = buildBizParamsExampleFromWorkflow(response?.payload?.data || {});
        setFormState((current) => {
          if (current.scene !== formState.scene) {
            return current;
          }

          return {
            ...current,
            bizParamsText: prettyJson(example)
          };
        });
        setSceneExampleStatus("ready");
        setSceneExampleMessage(
          Object.keys(example).length > 0
            ? "已根据场景输入契约生成示例，可按实际请求修改。"
            : "当前场景没有声明必填业务参数，示例保持为空对象。"
        );
      } catch (error) {
        if (!active) {
          return;
        }

        setSceneExampleStatus("error");
        setSceneExampleMessage(error.message || "业务参数示例生成失败。");
      }
    }

    loadDynamicExample();

    return () => {
      active = false;
    };
  }, [formState.scene, sceneExampleReloadKey]);

  const sceneOptions = useMemo(
    () => buildSceneOptions(sceneItems, sceneListStatus),
    [sceneItems, sceneListStatus]
  );
  const selectedOption = sceneOptions.find((item) => item.scene === formState.scene);
  const selectedPreset = scenePresets[formState.scene];
  const selectedSceneCanRun = selectedOption?.runnable !== false;
  const isContractReviewScene = formState.scene === CONTRACT_REVIEW_SCENE;

  const requestPreview = useMemo(() => {
    if (isContractReviewScene) {
      return prettyJson(buildContractReviewPreview({
        scene: formState.scene,
        tenantId: formState.tenantId,
        userId: formState.userId,
        file: contractFile,
        baseFileURL: contractFileURL
      }));
    }

    try {
      const bizParams = JSON.parse(formState.bizParamsText);
      return prettyJson(
        buildRequestBody({
          scene: formState.scene,
          tenantId: formState.tenantId,
          userId: formState.userId,
          bizParams
        })
      );
    } catch {
      return "bizParams 不是合法 JSON，当前无法生成请求预览。";
    }
  }, [contractFile, contractFileURL, formState, isContractReviewScene]);

  function updateField(field, value) {
    setFormState((current) => ({
      ...current,
      [field]: value
    }));
  }

  function applyPreset(scene) {
    setFormState(buildInitialFormState(scene));
    setContractFile(null);
    setContractFileURL("");
    if (contractFileInputRef.current) {
      contractFileInputRef.current.value = "";
    }
    setLocalError("");
    setSceneExampleMessage("");
    setSceneExampleStatus(scenePresets[scene] ? "idle" : "loading");
    if (!scenePresets[scene]) {
      setSceneExampleReloadKey((current) => current + 1);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    if (!selectedSceneCanRun) {
      setLocalError("当前场景还没有发布到 active runtime。请先在发布链路中发布场景，发布成功后再回来做单次请求调试。");
      return;
    }

    let requestBody = null;
    let submitRequest = null;

    if (isContractReviewScene) {
      if (!contractFile && !contractFileURL.trim()) {
        setLocalError("请上传合同文件，或填写 baseFileURL。");
        return;
      }

      const formData = buildContractReviewFormData({
        scene: formState.scene,
        tenantId: formState.tenantId,
        userId: formState.userId,
        file: contractFile,
        baseFileURL: contractFileURL
      });
      requestBody = buildContractReviewPreview({
        scene: formState.scene,
        tenantId: formState.tenantId,
        userId: formState.userId,
        file: contractFile,
        baseFileURL: contractFileURL
      });
      submitRequest = () => apiClient.runAgentFormData(formData);
    } else {
      let bizParams = null;
      try {
        bizParams = JSON.parse(formState.bizParamsText);
      } catch (error) {
        setLocalError(`bizParams JSON 解析失败：${error.message}`);
        return;
      }

      requestBody = buildRequestBody({
        scene: formState.scene,
        tenantId: formState.tenantId,
        userId: formState.userId,
        bizParams
      });
      submitRequest = () => apiClient.runAgent(requestBody);
    }

    setSubmitting(true);
    const startedAt = Date.now();

    try {
      const response = await submitRequest();
      setLastRun({
        requestBody,
        response,
        durationMs: Date.now() - startedAt,
        ranAt: new Date().toISOString()
      });
    } catch (error) {
      setLastRun({
        requestBody,
        response: {
          ok: false,
          status: 0,
          payload: {
            success: false,
            requestId: null,
            data: null,
            error: {
              code: "NETWORK_ERROR",
              message: error.message || "请求失败。",
              httpStatus: 0,
              stage: "console-submit",
              retryable: true,
              details: null
            }
          }
        },
        durationMs: Date.now() - startedAt,
        ranAt: new Date().toISOString()
      });
    } finally {
      setSubmitting(false);
    }
  }

  const responsePayload = lastRun?.response?.payload || null;
  const responseError = responsePayload?.error || null;

  return (
    <PageFrame
      eyebrow="调试"
      title="单次请求调试"
      description="本页始终调用真实 `POST /api/agent/run`，用于做最小联调、参数校验和错误定位。"
      actions={
        <div className="tag-list">
          <span className="tag tag-soft">真实接口：POST /api/agent/run</span>
          <span className="tag">不走模拟数据</span>
        </div>
      }
    >
      <div className="detail-grid">
        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">请求</p>
              <h4>请求表单</h4>
            </div>
            <button
              className="button-secondary"
              onClick={() => applyPreset(formState.scene)}
              type="button"
            >
              载入当前场景示例
            </button>
          </div>

          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="field-group">
              <label htmlFor="scene">场景</label>
              <select
                className="field-input"
                id="scene"
                onChange={(event) => applyPreset(event.target.value)}
                value={formState.scene}
              >
                {sceneOptions.map((item) => (
                  <option key={item.scene} value={item.scene}>
                    {item.label} ({item.scene}){item.runnable ? "" : " - 未发布"}
                  </option>
                ))}
              </select>
              <div className="tag-list">
                <span className={selectedSceneCanRun ? "tag tag-success" : "tag tag-warning"}>
                  {selectedOption?.publishLabel || "状态未知"}
                </span>
                {sceneListStatus === "loading" ? (
                  <span className="tag tag-neutral">场景目录加载中</span>
                ) : null}
              </div>
              <p className="field-help">
                {selectedOption?.note || selectedPreset?.note || "新场景没有内置示例参数，请按场景详情页里的输入契约填写业务参数 JSON。"}
              </p>
              {sceneListStatus === "error" ? (
                <p className="field-help field-help-warning">
                  场景目录读取失败，当前仅展示内置调试示例：{sceneListError}
                </p>
              ) : null}
            </div>

            <div className="form-grid-two">
              <div className="field-group">
                <label htmlFor="tenantId">租户 ID</label>
                <input
                  className="field-input"
                  id="tenantId"
                  onChange={(event) => updateField("tenantId", event.target.value)}
                  placeholder="tenant-a"
                  type="text"
                  value={formState.tenantId}
                />
              </div>

              <div className="field-group">
                <label htmlFor="userId">用户 ID</label>
                <input
                  className="field-input"
                  id="userId"
                  onChange={(event) => updateField("userId", event.target.value)}
                  placeholder="user-a"
                  type="text"
                  value={formState.userId}
                />
              </div>
            </div>

            {isContractReviewScene ? (
              <div className="contract-debug-panel">
                <div className="field-group">
                  <label htmlFor="contractBaseFile">合同文件 baseFile</label>
                  <input
                    accept={CONTRACT_FILE_ACCEPT}
                    className="field-input"
                    id="contractBaseFile"
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] || null;
                      setContractFile(nextFile);
                      if (nextFile) {
                        setContractFileURL("");
                      }
                    }}
                    ref={contractFileInputRef}
                    type="file"
                  />
                  <p className="field-help">
                    支持 bmp/jpg/jpeg/png/tif/tiff、doc/docx/wps/pdf/ofd/xlsx；选择文件后会按 multipart/form-data 的 baseFile 字段直接上传。
                  </p>
                  {contractFile ? (
                    <div className="rag-upload-selected-file">
                      <span>已选择</span>
                      <strong>{contractFile.name}</strong>
                      <em>{formatFileSize(contractFile.size)}</em>
                    </div>
                  ) : null}
                </div>

                <div className="field-group">
                  <label htmlFor="contractBaseFileURL">baseFileURL</label>
                  <input
                    className="field-input"
                    disabled={Boolean(contractFile)}
                    id="contractBaseFileURL"
                    onChange={(event) => setContractFileURL(event.target.value)}
                    placeholder="https://example.com/contracts/contract.pdf"
                    type="url"
                    value={contractFileURL}
                  />
                  <p className="field-help">
                    和 baseFile 二选一；已选择 baseFile 时，baseFileURL 不会提交。
                  </p>
                </div>
              </div>
            ) : (
              <div className="field-group">
                <label htmlFor="bizParams">业务参数 JSON</label>
                <textarea
                  className="field-input field-textarea"
                  id="bizParams"
                  onChange={(event) => updateField("bizParamsText", event.target.value)}
                  spellCheck="false"
                  value={formState.bizParamsText}
                />
                <p className="field-help">
                  这里直接编辑业务参数对象，页面会自动拼成统一请求包。
                </p>
                {sceneExampleMessage ? (
                  <p className={`field-help ${sceneExampleStatus === "error" ? "field-help-warning" : ""}`}>
                    {sceneExampleMessage}
                  </p>
                ) : null}
              </div>
            )}

            {localError ? (
              <div className="callout callout-error">
                <strong>本地校验失败</strong>
                <p>{localError}</p>
              </div>
            ) : null}

            <div className="button-row">
              <button className="button-primary" disabled={submitting || !selectedSceneCanRun} type="submit">
                {submitting ? "请求发送中..." : "发送真实请求"}
              </button>
            </div>
          </form>
        </section>

        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">预览</p>
              <h4>请求预览</h4>
            </div>
          </div>
          <div className="code-panel">
            <pre>{requestPreview}</pre>
          </div>
        </section>
      </div>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">响应</p>
            <h4>响应与错误信息</h4>
          </div>
          {lastRun ? (
            <span className="pill">{lastRun.durationMs} ms</span>
          ) : null}
        </div>

        {lastRun ? (
          <>
            <div className="response-summary">
              <div className="meta-block">
                <span className="meta-label">HTTP 状态</span>
                <span className="meta-value">{lastRun.response.status}</span>
              </div>
              <div className="meta-block">
                <span className="meta-label">是否成功</span>
                <span className="meta-value">
                  {String(Boolean(responsePayload?.success))}
                </span>
              </div>
              <div className="meta-block">
                <span className="meta-label">请求 ID</span>
                <span className="mono-text">
                  {responsePayload?.requestId || "-"}
                </span>
              </div>
              <div className="meta-block">
                <span className="meta-label">执行时间</span>
                <span className="meta-value">{lastRun.durationMs} ms</span>
              </div>
            </div>

            {responseError ? (
              <div className="callout callout-error">
                <strong>
                  {responseError.code || "REQUEST_FAILED"}
                </strong>
                <p>{responseError.message}</p>
              </div>
            ) : (
              <div className="callout callout-success">
                <strong>请求成功</strong>
                <p>已收到真实接口返回，可继续用这个页面做参数调试。</p>
              </div>
            )}

            <div className="detail-grid">
              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">提交内容</p>
                    <h4>实际提交请求</h4>
                  </div>
                </div>
                <div className="code-panel">
                  <pre>{prettyJson(lastRun.requestBody)}</pre>
                </div>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">响应包</p>
                    <h4>原始响应</h4>
                  </div>
                </div>
                <div className="code-panel">
                  <pre>{prettyJson(responsePayload)}</pre>
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="empty-panel">
            <h4>还没有发起请求</h4>
            <p>先选择场景并提交一次真实 `/api/agent/run` 请求。</p>
          </div>
        )}
      </section>
    </PageFrame>
  );
}
