import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { consoleClient } from "../../services/clientFactory";
import { WorkflowIvrFlow } from "../workflows/WorkflowIvrFlow";
import { WorkflowNodeList } from "../workflows/WorkflowNodeList";

function KeyValueList({ items }) {
  return (
    <div className="kv-grid">
      {items.map((item) => (
        <div className="meta-block" key={item.label}>
          <span className="meta-label">{item.label}</span>
          <span className="meta-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function AssetCard({ label, value, action = null, note = null, detail = null }) {
  return (
    <div className="meta-block">
      <div className="asset-card-header">
        <span className="meta-label">{label}</span>
        {action}
      </div>
      <span className="meta-value">{value}</span>
      {note ? <p className="detail-note">{note}</p> : null}
      {detail ? <p className="asset-card-detail">{detail}</p> : null}
    </div>
  );
}

function formatMappingValue(mapping = {}) {
  return Object.entries(mapping)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ") || "-";
}

function getToolBindingRemark(role, binding = {}) {
  const toolRef = binding.toolRef || "";

  if (role === "context_fetcher") {
    if (toolRef.includes("generic-query-runner")) {
      return "查询服务取数：按 QueryProfile 生成受控参数化查询，并按结果模式返回单条、多条或列值合集。";
    }

    if (toolRef.includes("directdb")) {
      return "查询服务取数：按查询配置调用 DirectDbRunner 拉取业务原始数据。";
    }

    return "查询服务取数：按查询配置调用 ContextHelper 拉取业务原始数据。";
  }

  if (role === "advisory_llm") {
    return "结构化生成：按当前场景提示词、输入上下文和输出结构起草业务结果，可用于建议生成、字段抽取等生成节点。";
  }

  if (role === "output_validator") {
    return "结果校验：按结构定义检查输出字段，并做轻量规范化。";
  }

  return "该工具承担当前节点绑定的执行职责。";
}

function renderToolBindings(toolBindings = {}) {
  const entries = Object.entries(toolBindings);
  if (entries.length === 0) {
    return <p className="muted-text">当前没有工具绑定。</p>;
  }

  return (
    <div className="simple-list">
      {entries.map(([role, binding]) => (
        <div className="simple-list-row" key={role}>
          <div>
            <strong>{role}</strong>
            <p>{binding.purpose}</p>
            <p className="detail-note">{getToolBindingRemark(role, binding)}</p>
          </div>
          <span className="mono-text">{binding.toolRef}</span>
        </div>
      ))}
    </div>
  );
}

function renderConditionalEdges(edges = []) {
  if (edges.length === 0) {
    return <p className="muted-text">当前没有条件分支配置。</p>;
  }

  return (
    <div className="simple-list">
      {edges.map((edge) => (
        <div className="simple-list-row" key={`${edge.from}-${edge.to}-${edge.when}`}>
          <div>
            <strong>
              {edge.from} -&gt; {edge.to}
            </strong>
            <p>{edge.description}</p>
          </div>
          <span className="mono-text">{edge.when}</span>
        </div>
      ))}
    </div>
  );
}

function buildSkillOptionValue(option) {
  return option?.name ? `${option.name}@${option.version || "v1"}` : "";
}

function parseSkillOptionValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const [name, version] = normalized.split("@");
  if (!name) {
    return null;
  }

  return {
    name,
    version: version || "v1"
  };
}

function formatConfigStatus(status) {
  return {
    draft: "草稿",
    active: "启用",
    deprecated: "弃用",
    published: "已发布"
  }[status] || status || "-";
}

function formatPublishState(configState = {}) {
  if (configState.publishState === "unpublished" || configState.hasPublishedSnapshot === false) {
    return "未发布";
  }

  return configState.hasUnpublishedChanges ? "草稿未发布" : "已发布";
}

function buildEmptyModelDraft() {
  return {
    provider: "",
    model: "",
    baseUrl: "",
    temperature: "",
    maxTokens: "",
    timeoutMs: ""
  };
}

const DEFAULT_MODEL_PROVIDER_OPTIONS = [
  {
    provider: "moonshot",
    label: "Moonshot / Kimi",
    defaultModel: "moonshot-v1-8k",
    keyEnvNames: ["MOONSHOT_API_KEY"]
  },
  {
    provider: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    keyEnvNames: ["DEEPSEEK_API_KEY"]
  }
];

function buildModelDraftFromBinding(binding = {}) {
  const configured = binding?.configured || {};
  const effective = binding?.effective || {};

  return {
    provider: configured.provider || effective.provider || "",
    model: configured.model || effective.model || "",
    baseUrl: configured.baseUrl || "",
    temperature: configured.temperature ?? "",
    maxTokens: configured.maxTokens ?? "",
    timeoutMs: configured.timeoutMs ?? ""
  };
}

function buildModelPayloadFromDraft(draft = {}) {
  const payload = {
    provider: String(draft.provider || "").trim(),
    model: String(draft.model || "").trim(),
    baseUrl: String(draft.baseUrl || "").trim()
  };

  for (const field of ["temperature", "maxTokens", "timeoutMs"]) {
    const value = String(draft[field] ?? "").trim();
    if (value) {
      payload[field] = Number(value);
    }
  }

  return payload;
}

function formatModelSource(source) {
  return {
    scene: "场景配置",
    tool: "工具默认",
    env: "环境兜底"
  }[source] || source || "-";
}

export function SceneWorkflowPage() {
  const { scene } = useParams();
  const [workflow, setWorkflow] = useState(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [skillBindingEditorOpen, setSkillBindingEditorOpen] = useState(false);
  const [skillBinding, setSkillBinding] = useState(null);
  const [skillBindingDraft, setSkillBindingDraft] = useState("");
  const [skillBindingStatus, setSkillBindingStatus] = useState("idle");
  const [skillBindingMessage, setSkillBindingMessage] = useState("");
  const [modelBindingEditorOpen, setModelBindingEditorOpen] = useState(false);
  const [modelBinding, setModelBinding] = useState(null);
  const [modelDraft, setModelDraft] = useState(buildEmptyModelDraft);
  const [modelBindingStatus, setModelBindingStatus] = useState("idle");
  const [modelBindingMessage, setModelBindingMessage] = useState("");
  const [workflowView, setWorkflowView] = useState("ivr");
  const [publishStatus, setPublishStatus] = useState("idle");
  const [publishMessage, setPublishMessage] = useState("");
  const [publishResult, setPublishResult] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadWorkflow() {
      setStatus("loading");
      setErrorMessage("");

      try {
        const response = await consoleClient.getSceneWorkflow(scene);
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setWorkflow(null);
          setStatus("error");
          setErrorMessage(
            response?.payload?.error?.message || "流程详情读取失败。"
          );
          return;
        }

        setWorkflow(response?.payload?.data || null);
        setStatus("ready");
        setSkillBindingEditorOpen(false);
        setSkillBinding(null);
        setSkillBindingDraft("");
        setSkillBindingStatus("idle");
        setSkillBindingMessage("");
        setModelBindingEditorOpen(false);
        setModelBinding(response?.payload?.data?.modelBinding || null);
        setModelDraft(buildModelDraftFromBinding(response?.payload?.data?.modelBinding || null));
        setModelBindingStatus("idle");
        setModelBindingMessage("");
        setPublishStatus("idle");
        setPublishMessage("");
        setPublishResult(null);
      } catch (error) {
        if (!active) {
          return;
        }

        setWorkflow(null);
        setStatus("error");
        setErrorMessage(error.message || "流程详情读取失败。");
      }
    }

    loadWorkflow();

    return () => {
      active = false;
    };
  }, [scene]);

  async function reloadWorkflow() {
    const workflowResponse = await consoleClient.getSceneWorkflow(scene);
    if (workflowResponse?.ok && workflowResponse?.payload?.success !== false) {
      const nextWorkflow = workflowResponse?.payload?.data || null;
      setWorkflow(nextWorkflow);
      setModelBinding(nextWorkflow?.modelBinding || null);
      setModelDraft(buildModelDraftFromBinding(nextWorkflow?.modelBinding || null));
      setStatus("ready");
      setErrorMessage("");
      return;
    }

    setStatus("error");
    setErrorMessage(workflowResponse?.payload?.error?.message || "流程详情刷新失败。");
  }

  const overrideableNodeIds = useMemo(() => {
    if (!workflow?.nodesById || !workflow?.orderedNodeIds) {
      return [];
    }

    return workflow.orderedNodeIds.filter((nodeId) => {
      const node = workflow.nodesById[nodeId];
      const hasOverride = Boolean(workflow.nodeOverrides?.[nodeId]);

      return Boolean(
        hasOverride || node?.skipAllowed || node?.reorderable || node?.replaceable
      );
    });
  }, [workflow]);

  async function handleOpenSkillBindingEditor() {
    if (!workflow?.platformManagedScene) {
      return;
    }

    setSkillBindingEditorOpen(true);
    setSkillBindingMessage("");

    if (skillBinding?.scene === scene && Array.isArray(skillBinding?.options)) {
      setSkillBindingDraft(buildSkillOptionValue(skillBinding.current));
      setSkillBindingStatus("ready");
      return;
    }

    setSkillBindingStatus("loading");

    try {
      const response = await consoleClient.getSceneSkillBinding(scene);
      if (!response?.ok || response?.payload?.success === false) {
        setSkillBindingStatus("error");
        setSkillBindingMessage(
          response?.payload?.error?.message || "业务技能绑定读取失败。"
        );
        return;
      }

      const nextSkillBinding = response?.payload?.data || null;
      setSkillBinding(nextSkillBinding);
      setSkillBindingDraft(buildSkillOptionValue(nextSkillBinding?.current));
      setSkillBindingStatus("ready");
    } catch (error) {
      setSkillBindingStatus("error");
      setSkillBindingMessage(error.message || "业务技能绑定读取失败。");
    }
  }

  function handleCancelSkillBindingEdit() {
    setSkillBindingEditorOpen(false);
    setSkillBindingStatus("idle");
    setSkillBindingMessage("");
    setSkillBindingDraft(buildSkillOptionValue(skillBinding?.current));
  }

  async function handleSaveSkillBinding(event) {
    event.preventDefault();
    const selectedSkill = parseSkillOptionValue(skillBindingDraft);

    if (!selectedSkill?.name) {
      setSkillBindingStatus("error");
      setSkillBindingMessage("请先选择一个业务技能。");
      return;
    }

    setSkillBindingStatus("saving");
    setSkillBindingMessage("");

    try {
      const response = await consoleClient.updateSceneSkillBinding(scene, selectedSkill);
      if (!response?.ok || response?.payload?.success === false) {
        setSkillBindingStatus("error");
        setSkillBindingMessage(
          response?.payload?.error?.message || "业务技能绑定保存失败。"
        );
        return;
      }

      const nextSkillBinding = response?.payload?.data || null;
      setSkillBinding(nextSkillBinding);
      setSkillBindingDraft(buildSkillOptionValue(nextSkillBinding?.current));
      setSkillBindingStatus("ready");
      setSkillBindingMessage(
        `已保存业务技能绑定草稿为 ${nextSkillBinding?.current?.title || nextSkillBinding?.current?.name || "目标业务技能"}。`
      );

      await reloadWorkflow();
    } catch (error) {
      setSkillBindingStatus("error");
      setSkillBindingMessage(error.message || "业务技能绑定保存失败。");
    }
  }

  async function handleOpenModelBindingEditor() {
    if (!workflow?.platformManagedScene) {
      return;
    }

    setModelBindingEditorOpen(true);
    setModelBindingMessage("");

    if (modelBinding?.scene === scene) {
      setModelDraft(buildModelDraftFromBinding(modelBinding));
      setModelBindingStatus("ready");
      return;
    }

    setModelBindingStatus("loading");

    try {
      const response = await consoleClient.getSceneModelBinding(scene);
      if (!response?.ok || response?.payload?.success === false) {
        setModelBindingStatus("error");
        setModelBindingMessage(response?.payload?.error?.message || "模型配置读取失败。");
        return;
      }

      const nextModelBinding = response?.payload?.data || null;
      setModelBinding(nextModelBinding);
      setModelDraft(buildModelDraftFromBinding(nextModelBinding));
      setModelBindingStatus("ready");
    } catch (error) {
      setModelBindingStatus("error");
      setModelBindingMessage(error.message || "模型配置读取失败。");
    }
  }

  function handleCancelModelBindingEdit() {
    setModelBindingEditorOpen(false);
    setModelBindingStatus("idle");
    setModelBindingMessage("");
    setModelDraft(buildModelDraftFromBinding(modelBinding));
  }

  async function handleSaveModelBinding(event) {
    event.preventDefault();
    const payload = buildModelPayloadFromDraft(modelDraft);

    if (!payload.provider || !payload.model) {
      setModelBindingStatus("error");
      setModelBindingMessage("请选择模型供应商并填写模型名称。");
      return;
    }

    setModelBindingStatus("saving");
    setModelBindingMessage("");

    try {
      const response = await consoleClient.updateSceneModelBinding(scene, payload);
      if (!response?.ok || response?.payload?.success === false) {
        setModelBindingStatus("error");
        setModelBindingMessage(response?.payload?.error?.message || "模型配置保存失败。");
        return;
      }

      const nextModelBinding = response?.payload?.data || null;
      setModelBinding(nextModelBinding);
      setModelDraft(buildModelDraftFromBinding(nextModelBinding));
      setModelBindingStatus("ready");
      setModelBindingMessage(`已保存模型配置草稿：${nextModelBinding?.effective?.provider || "-"} / ${nextModelBinding?.effective?.model || "-"}。`);

      await reloadWorkflow();
    } catch (error) {
      setModelBindingStatus("error");
      setModelBindingMessage(error.message || "模型配置保存失败。");
    }
  }

  async function handleClearModelBinding() {
    setModelBindingStatus("saving");
    setModelBindingMessage("");

    try {
      const response = await consoleClient.updateSceneModelBinding(scene, {
        clear: true
      });
      if (!response?.ok || response?.payload?.success === false) {
        setModelBindingStatus("error");
        setModelBindingMessage(response?.payload?.error?.message || "模型配置清除失败。");
        return;
      }

      const nextModelBinding = response?.payload?.data || null;
      setModelBinding(nextModelBinding);
      setModelDraft(buildModelDraftFromBinding(nextModelBinding));
      setModelBindingStatus("ready");
      setModelBindingMessage("已清除场景模型配置，运行时会使用工具默认或环境兜底。");

      await reloadWorkflow();
    } catch (error) {
      setModelBindingStatus("error");
      setModelBindingMessage(error.message || "模型配置清除失败。");
    }
  }

  async function handlePublishCurrentDraft() {
    setPublishStatus("publishing");
    setPublishMessage("");
    setPublishResult(null);

    try {
      const response = await consoleClient.publishRelease({
        scopeType: "all",
        scopeValue: "*",
        operator: "console-ui",
        publishNote: `publish scene draft from console: ${scene}`
      });

      if (!response?.ok || response?.payload?.success === false) {
        setPublishStatus("error");
        setPublishMessage(response?.payload?.error?.message || "发布失败。");
        return;
      }

      const result = response?.payload?.data || null;
      setPublishStatus("success");
      setPublishResult(result);
      setPublishMessage(
        `发布成功：${result?.release?.releaseId || "已生成 release"}，active runtime 已切到新 bundle。`
      );
      await reloadWorkflow();
    } catch (error) {
      setPublishStatus("error");
      setPublishMessage(error.message || "发布失败。");
    }
  }

  const currentSkillLabel = workflow?.skill?.title || workflow?.skill?.name || "未纳入模板";
  const currentSkillRef = workflow?.skill
    ? `${workflow.skill.name}@${workflow.skill.version}`
    : "-";
  const canPublishDraft = Boolean(
    workflow?.configState?.hasUnpublishedChanges
    || workflow?.configState?.publishState === "unpublished"
    || workflow?.configState?.hasPublishedSnapshot === false
  );
  const activeModelBinding = modelBinding || workflow?.modelBinding || null;
  const effectiveModel = activeModelBinding?.effective || {};
  const configuredModel = activeModelBinding?.configured || null;
  const modelProviderOptions = activeModelBinding?.providerOptions?.length
    ? activeModelBinding.providerOptions
    : DEFAULT_MODEL_PROVIDER_OPTIONS;
  const selectedModelProviderOption = modelProviderOptions
    .find((option) => option.provider === modelDraft.provider);
  const selectedModelKeyEnvNames = Array.from(new Set([
    "LANGGRAPH_LLM_API_KEY",
    "PROJECT_LLM_API_KEY",
    ...(selectedModelProviderOption?.keyEnvNames || effectiveModel.keyEnvNames || [])
  ]));

  return (
    <PageFrame hideHeader>
      {status === "error" ? (
        <section className="section-card">
          <h4>读取失败</h4>
          <p className="muted-text">{errorMessage}</p>
        </section>
      ) : null}

      {workflow ? (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <span className="meta-label">场景</span>
              <strong>{workflow.title}</strong>
              <p className="mono-text">{workflow.scene}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">模板</span>
              <strong>
	                {workflow.template
	                  ? `${workflow.template.name}@${workflow.template.version}`
	                  : "非模板编排"}
	              </strong>
	              <p>{workflow.template?.title || "当前场景没有可展示的模板绑定。"}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">业务技能</span>
              <strong>{currentSkillLabel}</strong>
              <p className="mono-text">{currentSkillRef}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">数据来源</span>
              <strong>{workflow.dataSourceLabel || "-"}</strong>
              <p>{workflow.allowedModes?.join(" / ") || "-"}</p>
            </article>
          </section>

          <section className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">场景</p>
                  <h4>场景与运行信息</h4>
                </div>
                {canPublishDraft ? (
                  <button
                    className="button-primary"
                    disabled={publishStatus === "publishing"}
                    onClick={handlePublishCurrentDraft}
                    type="button"
                  >
                    {publishStatus === "publishing" ? "发布中..." : "发布到运行态"}
                  </button>
                ) : (
                  <span className="tag tag-success">已发布</span>
                )}
              </div>
              <p className="section-text">{workflow.description}</p>
              {publishMessage ? (
                <div
                  className={`callout ${
                    publishStatus === "error"
                      ? "callout-error"
                      : "callout-success"
                  }`}
                >
                  <strong>{publishStatus === "error" ? "发布失败" : "发布完成"}</strong>
                  <p>{publishMessage}</p>
                  {publishResult?.currentBundleTarget ? (
                    <p>{`Current bundle: ${publishResult.currentBundleTarget}`}</p>
                  ) : null}
                </div>
              ) : canPublishDraft ? (
                <div className="callout callout-neutral">
                  <strong>草稿尚未进入运行态</strong>
                  <p>单次请求调试只调用 active runtime。发布成功后，新增场景才会被 /api/agent/run 识别。</p>
                </div>
              ) : null}
              <KeyValueList
                items={[
                  { label: "执行方式", value: workflow.executionMode || "-" },
                  { label: "路由模式", value: workflow.routingMode || "-" },
                  {
                    label: "允许模式",
                    value: workflow.allowedModes?.join(" / ") || "-"
                  },
                  {
                    label: "平台管理",
                    value: workflow.platformManagedScene ? "是" : "否"
                  },
                  {
                    label: "草稿状态",
                    value: formatConfigStatus(workflow.configState?.draft?.status)
                  },
                  {
                    label: "发布状态",
                    value: formatPublishState(workflow.configState)
                  },
                  {
                    label: "草稿存储",
                    value: workflow.configState?.storagePath || "-"
                  },
                  {
                    label: "未发布改动",
                    value: workflow.configState?.hasUnpublishedChanges ? "有" : "无"
                  },
                  {
                    label: "当前发布",
                    value: workflow.configState?.published?.path || "未发布"
                  }
                ]}
              />
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">绑定</p>
                  <h4>模板与业务技能</h4>
                </div>
              </div>
              <div className="asset-grid">
                <AssetCard
                  label="流程模板"
                  value={workflow.template?.title || "非模板编排"}
	                  detail={
	                    workflow.template
	                      ? `${workflow.template.name}@${workflow.template.version}`
	                      : "当前场景没有可展示的模板绑定。"
	                  }
                />
                <AssetCard
                  label="业务技能"
                  value={currentSkillLabel}
                  note="场景页只负责切换当前草稿绑定的业务技能；提示词、结构定义等具体内容请到“配置目录 / 业务技能”里编辑。"
                  detail={`草稿：${currentSkillRef} | 当前发布：${workflow.configState?.published?.skillRef || "未发布"}`}
                  action={workflow.platformManagedScene ? (
	                    <button
	                      className="button-secondary button-inline"
	                      onClick={handleOpenSkillBindingEditor}
	                      type="button"
                    >
                      编辑
                    </button>
                  ) : null}
                />
                <AssetCard
                  label="生成模型"
                  value={
                    effectiveModel.provider && effectiveModel.model
                      ? `${effectiveModel.provider} / ${effectiveModel.model}`
                      : "-"
                  }
                  note={`当前来源：${formatModelSource(effectiveModel.source)}。密钥只从服务端 .env 读取，场景配置不保存 key。`}
                  detail={
                    configuredModel
                      ? "草稿已指定场景模型"
                      : `继承工具默认：${activeModelBinding?.toolDefault?.provider || "-"} / ${activeModelBinding?.toolDefault?.model || "-"}`
                  }
                  action={workflow.platformManagedScene ? (
                    <button
                      className="button-secondary button-inline"
                      onClick={handleOpenModelBindingEditor}
                      type="button"
                    >
                      编辑
                    </button>
                  ) : null}
                />
              </div>
              {workflow.platformManagedScene && modelBindingEditorOpen ? (
                <form className="asset-editor" onSubmit={handleSaveModelBinding}>
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">模型</p>
                      <h4>场景模型配置</h4>
                    </div>
                    <span className="pill">
                      {modelBindingStatus === "loading"
                        ? "读取中"
                        : modelBindingStatus === "saving"
                          ? "保存中"
                          : "写入草稿"}
                    </span>
                  </div>
                  <p className="section-text">
                    保存后写入配置中心场景草稿；运行时会优先使用这里配置的 provider 和 model，API key 继续从 .env 的供应商密钥读取。
                  </p>
                  {modelBindingMessage ? (
                    <div
                      className={`callout ${
                        modelBindingStatus === "error"
                          ? "callout-error"
                          : "callout-success"
                      }`}
                    >
                      <strong>
                        {modelBindingStatus === "error" ? "保存失败" : "已完成"}
                      </strong>
                      <p>{modelBindingMessage}</p>
                    </div>
                  ) : null}
                  {modelBindingStatus === "loading" ? (
                    <p className="muted-text">正在读取模型配置...</p>
                  ) : (
                    <>
                      <label className="field-label" htmlFor="scene-model-provider">
                        模型供应商
                      </label>
                      <select
                        className="field-input"
                        id="scene-model-provider"
                        onChange={(event) => {
                          const provider = event.target.value;
                          const option = modelProviderOptions.find((item) => item.provider === provider);
                          setModelDraft((currentDraft) => ({
                            ...currentDraft,
                            provider,
                            model: currentDraft.provider === provider
                              ? currentDraft.model
                              : option?.defaultModel || ""
                          }));
                        }}
                        value={modelDraft.provider}
                      >
                        <option value="">请选择供应商</option>
                        {modelProviderOptions.map((option) => (
                          <option key={option.provider} value={option.provider}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <label className="field-label" htmlFor="scene-model-name">
                        模型名称
                      </label>
                      <input
                        className="field-input"
                        id="scene-model-name"
                        onChange={(event) => setModelDraft((currentDraft) => ({
                          ...currentDraft,
                          model: event.target.value
                        }))}
                        placeholder="moonshot-v1-8k"
                        value={modelDraft.model}
                      />
                      <label className="field-label" htmlFor="scene-model-base-url">
                        Base URL
                      </label>
                      <input
                        className="field-input"
                        id="scene-model-base-url"
                        onChange={(event) => setModelDraft((currentDraft) => ({
                          ...currentDraft,
                          baseUrl: event.target.value
                        }))}
                        placeholder="留空使用供应商默认地址"
                        value={modelDraft.baseUrl}
                      />
                      <div className="form-grid-two">
                        <label className="field-label" htmlFor="scene-model-temperature">
                          Temperature
                          <input
                            className="field-input"
                            id="scene-model-temperature"
                            max="2"
                            min="0"
                            onChange={(event) => setModelDraft((currentDraft) => ({
                              ...currentDraft,
                              temperature: event.target.value
                            }))}
                            placeholder="0"
                            step="0.1"
                            type="number"
                            value={modelDraft.temperature}
                          />
                        </label>
                        <label className="field-label" htmlFor="scene-model-max-tokens">
                          Max Tokens
                          <input
                            className="field-input"
                            id="scene-model-max-tokens"
                            min="1"
                            onChange={(event) => setModelDraft((currentDraft) => ({
                              ...currentDraft,
                              maxTokens: event.target.value
                            }))}
                            placeholder="1200"
                            type="number"
                            value={modelDraft.maxTokens}
                          />
                        </label>
                        <label className="field-label" htmlFor="scene-model-timeout">
                          Timeout MS
                          <input
                            className="field-input"
                            id="scene-model-timeout"
                            min="1000"
                            onChange={(event) => setModelDraft((currentDraft) => ({
                              ...currentDraft,
                              timeoutMs: event.target.value
                            }))}
                            placeholder="30000"
                            type="number"
                            value={modelDraft.timeoutMs}
                          />
                        </label>
                      </div>
                      <p className="detail-note">
                        当前供应商会尝试读取这些环境变量：{selectedModelKeyEnvNames.join(", ") || "-"}。
                      </p>
                      <div className="button-row">
                        <button
                          className="button-primary"
                          disabled={modelBindingStatus === "saving"}
                          type="submit"
                        >
                          {modelBindingStatus === "saving" ? "保存中..." : "保存到草稿"}
                        </button>
                        <button
                          className="button-secondary"
                          disabled={modelBindingStatus === "saving"}
                          onClick={handleClearModelBinding}
                          type="button"
                        >
                          使用默认
                        </button>
                        <button
                          className="button-secondary"
                          onClick={handleCancelModelBindingEdit}
                          type="button"
                        >
                          取消
                        </button>
                      </div>
                    </>
                  )}
                </form>
              ) : null}
              {workflow.platformManagedScene && skillBindingEditorOpen ? (
                <form className="asset-editor" onSubmit={handleSaveSkillBinding}>
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">业务技能</p>
                      <h4>切换业务技能</h4>
                    </div>
                    <span className="pill">
                      {skillBindingStatus === "loading"
                        ? "读取中"
                        : skillBindingStatus === "saving"
                          ? "保存中"
                          : "写入草稿"}
                    </span>
                  </div>
                  <p className="section-text">
                    保存后会写入配置中心场景草稿，不会立即改动当前发布文件；运行图和工具绑定会按新的草稿业务技能重新加载。
                  </p>
                  {skillBinding?.publishedCurrent ? (
                    <p className="detail-note">
                      当前发布中的业务技能仍是 {skillBinding.publishedCurrent.title || skillBinding.publishedCurrent.name} ({skillBinding.publishedCurrent.name}@{skillBinding.publishedCurrent.version})。
                    </p>
                  ) : null}
                  {skillBindingMessage ? (
                    <div
                      className={`callout ${
                        skillBindingStatus === "error"
                          ? "callout-error"
                          : "callout-success"
                      }`}
                    >
                      <strong>
                        {skillBindingStatus === "error" ? "保存失败" : "已完成"}
                      </strong>
                      <p>{skillBindingMessage}</p>
                    </div>
                  ) : null}
                  {skillBindingStatus === "loading" ? (
                    <p className="muted-text">正在读取业务技能列表...</p>
                  ) : (
                    <>
                      <label className="field-label" htmlFor="scene-skill-binding">
                        业务技能
                      </label>
                      <select
                        className="field-input"
                        id="scene-skill-binding"
                        onChange={(event) => setSkillBindingDraft(event.target.value)}
                        value={skillBindingDraft}
                      >
                        <option value="">请选择业务技能</option>
                        {(skillBinding?.options || []).map((option) => (
                          <option
                            key={buildSkillOptionValue(option)}
                            value={buildSkillOptionValue(option)}
                          >
                            {(option.title || option.name)
                              ? `${option.title || option.name} (${option.name}@${option.version})`
                              : `${option.name}@${option.version}`}
                          </option>
                        ))}
                      </select>
                      <div className="button-row">
                        <button
                          className="button-primary"
                          disabled={skillBindingStatus === "saving"}
                          type="submit"
                        >
                          {skillBindingStatus === "saving" ? "保存中..." : "保存到草稿"}
                        </button>
                        <button
                          className="button-secondary"
                          onClick={handleCancelSkillBindingEdit}
                          type="button"
                        >
                          取消
                        </button>
                      </div>
                    </>
                  )}
                </form>
              ) : null}
            </section>
          </section>

          {workflow.platformManagedScene ? (
            <>
              <section className="detail-grid">
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">绑定</p>
                      <h4>工具 / 查询绑定</h4>
                    </div>
                  </div>
                  {renderToolBindings(workflow.toolBindings)}
                  <div className="asset-grid">
                    <AssetCard
                      label="查询配置"
                      value={workflow.queryProfileRef || "-"}
                      note="决定当前场景取数时使用哪份 QueryProfile。"
                    />
                    <AssetCard
                      label="输入映射"
                      value={formatMappingValue(workflow.inputContract?.inputMapping || {})}
                      note="把请求字段映射成查询执行所需的入参。"
                    />
                  </div>
                </section>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">视图</p>
                    <h4>流程展示方式</h4>
                  </div>
                  <div className="segmented-control" role="tablist" aria-label="流程展示方式">
                    <button
                      aria-selected={workflowView === "ivr"}
                      className={workflowView === "ivr" ? "is-active" : ""}
                      onClick={() => setWorkflowView("ivr")}
                      role="tab"
                      type="button"
                    >
                      IVR 连线
                    </button>
                    <button
                      aria-selected={workflowView === "nodes"}
                      className={workflowView === "nodes" ? "is-active" : ""}
                      onClick={() => setWorkflowView("nodes")}
                      role="tab"
                      type="button"
                    >
                      节点列表
                    </button>
                  </div>
                </div>
              </section>

              {workflowView === "ivr" ? (
                <WorkflowIvrFlow
                  conditionalEdges={workflow.conditionalEdges}
                  defaultNextByNodeId={workflow.defaultNextByNodeId}
                  orderedNodeIds={workflow.orderedNodeIds}
                  nodesById={workflow.nodesById}
                />
              ) : (
                <WorkflowNodeList
                  orderedNodeIds={workflow.orderedNodeIds}
                  nodesById={workflow.nodesById}
                  nodeOverrides={workflow.nodeOverrides}
                />
              )}

              <section className="detail-grid">
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">覆盖</p>
                      <h4>可覆盖点</h4>
                    </div>
                    <span className="pill">
                      {overrideableNodeIds.length} 个节点
                    </span>
                  </div>
                  <p className="section-text">
                    当前场景可覆盖的点主要集中在数据获取、引用资源包、模型调用和输出校验。
                  </p>
                  <div className="tag-list">
                    {overrideableNodeIds.map((nodeId) => (
                      <span className="tag tag-neutral" key={nodeId}>
                        {nodeId}
                      </span>
                    ))}
                  </div>
                </section>

                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">约束</p>
                      <h4>条件分支与约束</h4>
                    </div>
                  </div>
                  {renderConditionalEdges(workflow.conditionalEdges)}
                  <KeyValueList
                    items={[
                      {
                        label: "入口 / 出口",
                        value: `${workflow.entryNode || "-"} -> ${workflow.exitNode || "-"}`
                      },
                      {
                        label: "修复轮次",
                        value: String(
                          workflow.template?.constraints?.maxRepairLoops || 1
                        )
                      },
                      {
                        label: "跨阶段重排",
                        value: String(
                          workflow.template?.constraints?.allowCrossPhaseReorder || false
                        )
                      },
                      {
                        label: "并行组",
                        value:
                          workflow.template?.constraints?.parallelGroups
                            ?.map(
                              (group) => `${group.id}: ${group.members.join(", ")}`
                            )
                            .join(" | ") || "-"
                      }
                    ]}
                  />
                </section>
              </section>
            </>
	          ) : (
	            <section className="section-card">
	              <h4>未纳入平台编排</h4>
	              <p className="muted-text">当前场景没有可展示的 LangGraph 模板绑定。</p>
	            </section>
	          )}
        </>
      ) : null}

      {status === "loading" ? (
        <section className="section-card">
          <h4>正在加载</h4>
          <p className="muted-text">读取当前场景的流程详情中。</p>
        </section>
      ) : null}
    </PageFrame>
  );
}
