import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";
import { buildNodeShell, WorkflowIvrFlow } from "../workflows/WorkflowIvrFlow";

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function pickDefaultResource(items = []) {
  return (
    items.find((item) => item.kind === "skill")
    || items.find((item) => item.kind === "query")
    || items[0]
    || null
  );
}

function kindLabelText(kindLabel) {
  return {
    BusinessSkill: "业务技能",
    WorkflowTemplate: "流程模板",
    ToolDefinition: "工具定义",
    QueryProfile: "查询配置"
  }[kindLabel] || kindLabel;
}

function kindDescription(kind, sectionLabel) {
  return {
    skill: `${sectionLabel}集中展示场景绑定、输入输出契约和关联资源，便于沿着业务入口排查。`,
    template: `${sectionLabel}集中展示流程骨架、节点编排和模板约束，便于核对复用边界。`,
    query: `${sectionLabel}集中展示取数约束、入参契约、查询语句和返回形态，便于核对实际怎么查、怎么回。`,
    tool: `${sectionLabel}集中展示工具定义、驱动方式和执行职责，便于核对底层能力。`
  }[kind] || "浏览模板、业务技能、工具和查询配置，并查看同类资源差异以及字段开放边界。";
}

function formatStorageTarget(resource, fallback = "配置中心草稿") {
  if (resource?.storagePath) {
    return resource.storagePath;
  }

  if (resource?.storageDriver && resource?.storageTable && resource?.scene && resource?.assetType) {
    return `${resource.storageDriver}://${resource.storageTable}/${resource.scene}:${resource.assetType}`;
  }

  if (resource?.storageDriver && resource?.storageTable) {
    return `${resource.storageDriver}://${resource.storageTable}`;
  }

  return fallback;
}

function buildToolRemark(item) {
  const spec = item?.document?.spec || {};
  const toolRole = spec.toolRole || "";
  const toolRef = spec.ref || "";
  const driverType = spec.driver?.type || "";

  if (toolRole === "context_fetcher") {
    if (toolRef.includes("generic-query-runner")) {
      return "通用查询执行：按 QueryProfile 生成受控参数化查询，并按结果模式返回单条、多条或列值合集。";
    }

    if (toolRef.includes("directdb")) {
      return "查询服务取数：直连 DirectDbRunner 按业务主键拉取原始记录。";
    }

    return "查询服务取数：通过 ContextHelper 拉取场景所需的原始业务数据。";
  }

  if (toolRole === "knowledge_retriever") {
    return "知识检索：调用本地 RAG 向量库，返回与当前业务上下文相似的知识片段。";
  }

  if (toolRole === "advisory_llm") {
    return driverType === "agent-runtime"
      ? "建议生成：调用受控 Agent Runtime 生成结构化业务建议。"
      : "建议生成：调用受控大模型生成结构化业务建议。";
  }

  if (toolRole === "output_validator") {
    return "结果校验：按输出结构检查字段，并做轻量规范化修正。";
  }

  return "平台能力工具：承接当前流程节点绑定的执行职责。";
}

function buildResourceMetaItems(resource) {
  const isTool = resource?.kind === "tool";
  const sceneNote = resource?.scene
    ? "当前资源直接绑定的业务场景。"
    : isTool
      ? "工具一般不直接绑定单个场景；为空时通常看 allowedScenes 控制可用范围。"
      : "当前资源没有直接声明场景，通常通过关联关系被上层资源引用。";

  const summaryNote = isTool
    ? "工具的类别和流程角色简写，用来快速判断它负责取数、生成还是校验。"
    : "当前资源最核心的结构摘要，方便快速识别它的大致职责。";

  const secondaryNote = isTool
    ? "补充展示驱动方式、开放场景数等辅助信息。"
    : "对摘要的补充说明，通常会带出关联引用或附加约束。";

  return [
    {
      label: "类型",
      value: kindLabelText(resource?.kindLabel),
      note: "当前资源属于哪一类平台配置。"
    },
    {
      label: "场景",
      value: resource?.scene || "-",
      note: sceneNote
    },
    {
      label: "引用",
      value: resource?.ref || "-",
      note: "其他配置通过这个 ref 引用当前资源。"
    },
    {
      label: "摘要",
      value: resource?.summary?.primary || "-",
      note: summaryNote
    },
    {
      label: "补充",
      value: resource?.summary?.secondary || "-",
      note: secondaryNote
    },
    {
      label: "草稿存储",
      value: formatStorageTarget(resource),
      note: "控制台当前实际读写的配置中心草稿位置。"
    },
    {
      label: "来源文件",
      value: resource?.sourceFilePath || resource?.filePath || "-",
      note: "初始化导入时对应的源文件路径；保存草稿不会立即回写该文件。"
    }
  ];
}

function buildToolDraft(resource) {
  const limits = resource?.document?.spec?.limits || {};
  const allowedScenes = Array.isArray(resource?.document?.spec?.policy?.allowedScenes)
    ? resource.document.spec.policy.allowedScenes
    : [];

  return {
    limits: {
      timeoutMsDefault: String(limits.timeoutMsDefault ?? ""),
      timeoutMsMax: String(limits.timeoutMsMax ?? ""),
      retryMaxAttempts: String(limits.retryMaxAttempts ?? "")
    },
    allowedScenes: allowedScenes.slice()
  };
}

function formatSceneLabel(scene, sceneOptions = []) {
  const matched = sceneOptions.find((item) => item.scene === scene);
  if (!matched) {
    return scene;
  }

  return matched.title && matched.title !== scene
    ? `${matched.title} (${scene})`
    : scene;
}

function buildToolStructuredItems(resource, sceneOptions = []) {
  const limits = resource?.document?.spec?.limits || {};
  const allowedScenes = Array.isArray(resource?.document?.spec?.policy?.allowedScenes)
    ? resource.document.spec.policy.allowedScenes
    : [];

  return [
    {
      label: "默认超时",
      value: limits.timeoutMsDefault ? `${limits.timeoutMsDefault} ms` : "-",
      note: "工具默认请求超时时间。"
    },
    {
      label: "最大超时",
      value: limits.timeoutMsMax ? `${limits.timeoutMsMax} ms` : "-",
      note: "页面可配置时允许设置到的最大超时上限。"
    },
    {
      label: "最大重试次数",
      value: limits.retryMaxAttempts ?? "-",
      note: "单次调用失败后最多可自动重试的次数。"
    },
    {
      label: "场景白名单",
      value: allowedScenes.length > 0
        ? allowedScenes.map((scene) => formatSceneLabel(scene, sceneOptions)).join(" / ")
        : "-",
      note: "只有白名单里的系统场景允许绑定并使用这个工具。"
    }
  ];
}

function buildQueryDraft(resource) {
  const spec = resource?.document?.spec || {};
  const resultPolicy = spec.resultPolicy || {};

  return {
    primaryEntity: {
      table: spec.primaryEntity?.table || "",
      idField: spec.primaryEntity?.idField || ""
    },
    requiredInputsText: Array.isArray(spec.inputContract?.requiredInputs)
      ? spec.inputContract.requiredInputs.join("\n")
      : "",
    fieldsText: prettyJson(spec.inputContract?.fields || {}),
    cardinality: spec.selectionPolicy?.cardinality || "",
    whereText: prettyJson(spec.selectionPolicy?.where || []),
    statementType: spec.selectionPolicy?.statement?.type || "",
    resultMode: resultPolicy.mode || "single-row",
    resultFieldsText: Array.isArray(resultPolicy.fields)
      ? resultPolicy.fields.join("\n")
      : "",
    resultDistinct: resultPolicy.distinct === true,
    resultLimit: String(resultPolicy.limit ?? ""),
    limits: {
      timeoutMsDefault: String(spec.limits?.timeoutMsDefault ?? ""),
      timeoutMsMax: String(spec.limits?.timeoutMsMax ?? ""),
      retryMaxAttempts: String(spec.limits?.retryMaxAttempts ?? "")
    }
  };
}

function formatInputFieldSummary(fields = {}) {
  const entries = Object.entries(fields || {});
  if (entries.length === 0) {
    return "-";
  }

  return entries
    .map(([fieldName, fieldConfig]) => {
      const type = fieldConfig?.type || "-";
      const sourcePath = fieldConfig?.sourcePath || "-";
      return `${fieldName}: ${type} <- ${sourcePath}`;
    })
    .join(" / ");
}

function formatQueryWhereSummary(where = []) {
  if (!Array.isArray(where) || where.length === 0) {
    return "-";
  }

  return where
    .map((item) => `${item?.field || "-"} ${item?.operator || "-"} ${item?.param || "-"}`)
    .join(" / ");
}

function formatResultFieldSummary(fields = []) {
  return Array.isArray(fields) && fields.length > 0
    ? fields.join(" / ")
    : "*";
}

function AssetCard({ label, value, action = null, note = null, detail = null }) {
  return (
    <div className="meta-block">
      <div className="asset-card-header">
        <span className="meta-label">{label}</span>
        {action}
      </div>
      <span className="mono-text asset-card-value">{value}</span>
      {note ? <p className="detail-note">{note}</p> : null}
      {detail ? <p className="asset-card-detail">{detail}</p> : null}
    </div>
  );
}

function buildAssetSaveMessage(assetLabel, savedAsset) {
  const orderedNodeCount = savedAsset?.compilePreview?.orderedNodeCount;
  const path = formatStorageTarget(savedAsset);

  if (typeof orderedNodeCount === "number") {
    return `已保存${assetLabel}到 ${path}，校验通过，当前编译节点数 ${orderedNodeCount}。`;
  }

  return `已保存${assetLabel}到 ${path}。`;
}

function buildAssetCardDetail(assetMeta, assetLabel) {
  if (assetMeta?.editable === false) {
    return `当前${assetLabel}资产不是平台可编辑来源。`;
  }

  const details = [
    `草稿位置：${formatStorageTarget(assetMeta)}`,
    assetMeta?.path ? `来源文件：${assetMeta.path}` : null
  ].filter(Boolean);

  return details.length > 0 ? details.join(" | ") : null;
}

function readSkillAssetCatalogEntries(skillSpec, categoryName, refKey) {
  const rawCategory = skillSpec?.assetRefs?.[categoryName];
  if (!rawCategory || typeof rawCategory !== "object") {
    return [];
  }

  return Object.entries(rawCategory)
    .map(([assetKey, entry]) => {
      const ref = entry?.[refKey] || entry?.ref || null;
      const sourcePath = entry?.source?.path || entry?.path || null;

      if (!ref) {
        return null;
      }

      return {
        assetKey,
        ref,
        path: sourcePath
      };
    })
    .filter(Boolean);
}

function readSelectedSkillAssetRefs(skillSpec, categoryName) {
  const selectedRefs = skillSpec?.nodeOverrides?.load_reference_bundle?.assetRefs?.[categoryName];
  if (Array.isArray(selectedRefs) && selectedRefs.length > 0) {
    return selectedRefs.slice();
  }

  return [];
}

function selectSkillAssetRef(skillSpec, assetType) {
  switch (assetType) {
    case "prompt":
      return skillSpec?.nodeOverrides?.draft_business_output?.promptRef
        || readSelectedSkillAssetRefs(skillSpec, "prompts")[0]
        || readSkillAssetCatalogEntries(skillSpec, "prompts", "promptRef")[0]?.ref
        || null;
    case "schema":
      return skillSpec?.outputContract?.schemaRef
        || readSelectedSkillAssetRefs(skillSpec, "schemas")[0]
        || readSkillAssetCatalogEntries(skillSpec, "schemas", "schemaRef")[0]?.ref
        || null;
    case "dictionary":
      return readSelectedSkillAssetRefs(skillSpec, "dictionaries")[0]
        || readSkillAssetCatalogEntries(skillSpec, "dictionaries", "dictionaryRef")[0]?.ref
        || null;
    case "rules":
      return readSelectedSkillAssetRefs(skillSpec, "rules")[0]
        || readSkillAssetCatalogEntries(skillSpec, "rules", "rulesRef")[0]?.ref
        || null;
    default:
      return null;
  }
}

function formatChineseList(values = []) {
  const normalized = values.filter(Boolean);

  if (normalized.length <= 1) {
    return normalized[0] || "";
  }

  if (normalized.length === 2) {
    return normalized.join("和");
  }

  return `${normalized.slice(0, -1).join("、")}和${normalized.at(-1)}`;
}

function buildSkillAssetItems(resource) {
  const skillSpec = resource?.document?.spec || {};
  const definitions = [
    {
      type: "prompt",
      label: "提示词",
      categoryName: "prompts",
      refKey: "promptRef",
      note: "当前业务技能草拟输出时实际使用的提示词引用。"
    },
    {
      type: "schema",
      label: "结构定义",
      categoryName: "schemas",
      refKey: "schemaRef",
      note: "当前业务技能输出校验时实际使用的结构定义引用。"
    },
    {
      type: "dictionary",
      label: "数据字典",
      categoryName: "dictionaries",
      refKey: "dictionaryRef",
      optional: true,
      note: "当前业务技能清洗和映射事实时使用的数据字典。"
    },
    {
      type: "rules",
      label: "规则",
      categoryName: "rules",
      refKey: "rulesRef",
      optional: true,
      note: "当前业务技能生成业务建议时参考的业务规则。"
    }
  ];

  return definitions.map((definition) => {
    const entries = readSkillAssetCatalogEntries(skillSpec, definition.categoryName, definition.refKey);
    const selectedRef = selectSkillAssetRef(skillSpec, definition.type);
    const selectedEntry = entries.find((entry) => entry.ref === selectedRef) || entries[0] || null;

    if (definition.optional && !selectedRef && entries.length === 0) {
      return null;
    }

    return {
      type: definition.type,
      label: definition.label,
      note: definition.note,
      ref: selectedRef || "-",
      path: selectedEntry?.path || null,
      scene: resource?.scene || null,
      assetType: definition.type,
      storageDriver: "mysql",
      storageTable: "cfg_scene_assets"
    };
  }).filter(Boolean);
}

function buildQueryStructuredItems(resource) {
  const spec = resource?.document?.spec || {};
  const requiredInputs = Array.isArray(spec.inputContract?.requiredInputs)
    ? spec.inputContract.requiredInputs
    : [];
  const resultPolicy = spec.resultPolicy || {};

  return [
    {
      label: "主表",
      value: spec.primaryEntity?.table || "-",
      note: "查询配置面向的主业务表。"
    },
    {
      label: "主键字段",
      value: spec.primaryEntity?.idField || "-",
      note: "如果当前查询是按主键定位单条记录，这里会声明主标识字段；通用查询时可以留空。"
    },
    {
      label: "必填入参",
      value: requiredInputs.length > 0 ? requiredInputs.join(" / ") : "-",
      note: "执行查询前必须准备好的请求字段。"
    },
    {
      label: "输入字段映射",
      value: formatInputFieldSummary(spec.inputContract?.fields || {}),
      note: "定义每个查询入参从请求上下文的哪里取值。"
    },
    {
      label: "查询策略",
      value: [
        spec.selectionPolicy?.cardinality || null,
        spec.selectionPolicy?.statement?.type || null
      ].filter(Boolean).join(" / ") || "-",
      note: "控制查询返回条数和语句形态。"
    },
    {
      label: "查询条件",
      value: formatQueryWhereSummary(spec.selectionPolicy?.where || []),
      note: "真正执行过滤时使用的字段、操作符和参数。"
    },
    {
      label: "结果模式",
      value: [
        resultPolicy.mode || null,
        resultPolicy.distinct ? "distinct" : null,
        resultPolicy.limit ? `limit ${resultPolicy.limit}` : null
      ].filter(Boolean).join(" / ") || "-",
      note: "控制是返回单条、多条、列值合集还是聚合值。"
    },
    {
      label: "返回字段",
      value: formatResultFieldSummary(resultPolicy.fields || []),
      note: "定义查询结果最终保留哪些列；未配置时默认返回全部字段。"
    },
    {
      label: "运行限制",
      value: `${spec.limits?.timeoutMsDefault ?? "-"} / ${spec.limits?.timeoutMsMax ?? "-"} ms / retry ${spec.limits?.retryMaxAttempts ?? "-"}`,
      note: "查询服务默认超时、最大超时和最大重试次数。"
    }
  ];
}

function statusLabel(status) {
  return {
    draft: "草稿",
    active: "启用",
    deprecated: "弃用"
  }[status] || status || "-";
}

function shouldShowRawConfig(resource) {
  return resource?.kind !== "skill" && resource?.kind !== "template" && resource?.kind !== "query" && resource?.kind !== "tool";
}

function buildRelatedResourceExplanation(resource) {
  if (resource?.kind === "skill") {
    return "这里列出当前业务技能直接绑定或引用到的模板、工具、查询和资产线索，主要用来判断这条业务链路实际依赖了谁。";
  }

  if (resource?.kind === "template") {
    return "这里列出当前流程模板编排时会牵涉到的上下游配置，主要用来核对节点引用和复用边界。";
  }

  if (resource?.kind === "tool" || resource?.kind === "query") {
    return "这里列出正在引用当前配置的上游资源，或当前配置继续引用的下游资源，主要用来评估修改后的影响范围。";
  }

  return "这里列出和当前资源存在直接引用关系的上下游配置，主要用来判断一处改动会牵动哪些链路。";
}

function describeToolRole(role) {
  return {
    context_fetcher: "取数 / 上下文获取",
    knowledge_retriever: "知识检索 / RAG",
    advisory_llm: "建议生成",
    output_validator: "结果校验"
  }[role] || role || "未命名职责";
}

function buildRelatedResourceItemNote(resource, relationItem) {
  const relation = relationItem?.relation || "";

  if (resource?.kind === "skill") {
    if (relation === "template") {
      return "当前业务技能复用的流程模板。模板节点骨架变更时，这条业务链路通常会一起受到影响。";
    }

    if (relation === "query-profile") {
      return "当前业务技能取数时实际绑定的查询配置。取数条件、入参和结果形态都从这里进来。";
    }

    if (relation.startsWith("tool:")) {
      const role = relation.slice("tool:".length);
      return `当前业务技能在“${describeToolRole(role)}”这个环节实际调用的工具。`;
    }
  }

  if (resource?.kind === "template" && relation === "bound-skill") {
    return "这个业务技能当前绑定了该流程模板。改模板时，至少要一起核对这条技能链路。";
  }

  if (resource?.kind === "query" && relation === "tool") {
    return "当前查询配置通过这个工具执行。工具驱动方式或执行边界变化，会直接影响这条查询链路。";
  }

  if (resource?.kind === "tool") {
    if (relation === "query-profile") {
      return "这个查询配置会调用当前工具。改工具执行能力时，建议连同这条查询配置一起检查。";
    }

    if (relation.startsWith("skill:")) {
      const role = relation.slice("skill:".length);
      return `这个业务技能在“${describeToolRole(role)}”这个环节绑定了当前工具。`;
    }
  }

  return "当前资源和这一项存在直接引用关系，改动时建议一起核对。";
}

function KeyValueList({ items }) {
  return (
    <div className="kv-grid">
      {items.map((item) => (
        <div className="meta-block" key={item.label}>
          <span className="meta-label">{item.label}</span>
          <span className="meta-value">{item.value}</span>
          {item.note ? <p className="detail-note">{item.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

function buildSkillOnlyWorkflowPreview(preview) {
  if (!preview?.orderedNodeIds || !preview?.nodesById) {
    return null;
  }

  const orderedNodeIds = preview.orderedNodeIds.filter((nodeId) => (
    buildNodeShell(preview.nodesById[nodeId]).key === "business-skill"
  ));
  const nodeSet = new Set(orderedNodeIds);

  return {
    orderedNodeIds,
    nodesById: Object.fromEntries(
      orderedNodeIds.map((nodeId) => [nodeId, preview.nodesById[nodeId]])
    ),
    defaultNextByNodeId: Object.fromEntries(
      orderedNodeIds.map((nodeId, index) => [nodeId, orderedNodeIds[index + 1] || null])
    ),
    conditionalEdges: (preview.conditionalEdges || []).filter((edge) => (
      nodeSet.has(edge.from) && nodeSet.has(edge.to)
    ))
  };
}

function buildQueryWorkflowPreview(resource) {
  const spec = resource?.document?.spec || {};
  const requiredInputs = Array.isArray(spec.inputContract?.requiredInputs)
    ? spec.inputContract.requiredInputs
    : [];
  const where = Array.isArray(spec.selectionPolicy?.where)
    ? spec.selectionPolicy.where
    : [];
  const resultFields = Array.isArray(spec.resultPolicy?.fields)
    ? spec.resultPolicy.fields
    : [];
  const constraintEntries = Object.entries(spec.generationConstraints || {});
  const orderedNodeIds = [
    "load_query_profile",
    "resolve_query_inputs",
    "enforce_query_constraints",
    "build_query_statement",
    "execute_query",
    "shape_query_result"
  ];
  const commonNodeFields = {
    category: "tool",
    toolRole: "context_fetcher",
    required: true,
    enabled: true
  };
  const nodesById = {
    load_query_profile: {
      ...commonNodeFields,
      id: "load_query_profile",
      phase: "profile",
      description: `读取 ${spec.ref || resource?.ref || "当前 QueryProfile"}，确定执行工具、主表和结果策略。`,
      outputs: ["query.profile", "query.spec"]
    },
    resolve_query_inputs: {
      ...commonNodeFields,
      id: "resolve_query_inputs",
      phase: "input",
      description: requiredInputs.length > 0
        ? `从请求上下文解析必填入参：${requiredInputs.join(", ")}。`
        : "从请求上下文解析查询入参。",
      inputs: Object.values(spec.inputContract?.fields || {}).map((field) => field.sourcePath).filter(Boolean),
      outputs: requiredInputs.map((inputName) => `params.${inputName}`)
    },
    enforce_query_constraints: {
      ...commonNodeFields,
      id: "enforce_query_constraints",
      phase: "guard",
      description: constraintEntries.length > 0
        ? `执行安全边界检查：${constraintEntries.map(([key, value]) => `${key}=${value}`).join(", ")}。`
        : "执行查询安全边界检查，禁止越权查询形态。",
      inputs: ["query.spec", "params"],
      outputs: ["query.guardResult"]
    },
    build_query_statement: {
      ...commonNodeFields,
      id: "build_query_statement",
      phase: "statement",
      description: `按 ${spec.selectionPolicy?.statement?.type || "select"} 生成受控查询语句，过滤条件 ${where.length} 条。`,
      inputs: ["query.selectionPolicy", "params"],
      outputs: ["query.sqlText"]
    },
    execute_query: {
      ...commonNodeFields,
      id: "execute_query",
      phase: "execution",
      description: `调用 ${spec.toolRef || "查询执行工具"} 访问 ${spec.primaryEntity?.table || "目标表"}。`,
      inputs: ["query.sqlText", "params"],
      outputs: ["query.rows"]
    },
    shape_query_result: {
      ...commonNodeFields,
      id: "shape_query_result",
      phase: "output",
      description: `按 ${spec.resultPolicy?.mode || "result"} 整形结果，返回字段 ${resultFields.length > 0 ? resultFields.join(", ") : "*"}。`,
      inputs: ["query.rows", "query.resultPolicy"],
      outputs: [spec.outputPolicy?.resultPath || "data.result"]
    }
  };

  return {
    orderedNodeIds,
    nodesById,
    defaultNextByNodeId: Object.fromEntries(
      orderedNodeIds.map((nodeId, index) => [nodeId, orderedNodeIds[index + 1] || null])
    ),
    conditionalEdges: []
  };
}

function resolveToolShellKey(toolRole, category) {
  if (toolRole === "knowledge_retriever" || category === "knowledge") {
    return "knowledge-tool";
  }

  if (toolRole === "context_fetcher" || category === "data") {
    return "query-tool";
  }

  if (toolRole === "output_validator" || category === "validation") {
    return "validation-tool";
  }

  if (toolRole === "advisory_llm" || category === "llm") {
    return "business-skill";
  }

  return "platform-runtime";
}

function buildToolWorkflowPreview(resource) {
  const spec = resource?.document?.spec || {};
  const toolRole = spec.toolRole || "";
  const category = spec.category || "";
  const shellKey = resolveToolShellKey(toolRole, category);
  const requiredFields = Array.isArray(spec.requestContract?.requiredFields)
    ? spec.requestContract.requiredFields
    : [];
  const denyEntries = Object.entries(spec.policy?.deny || {});
  const driver = spec.driver || {};
  const orderedNodeIds = [
    "receive_tool_request",
    "validate_tool_contract",
    "enforce_tool_policy",
    "prepare_driver_call",
    "invoke_tool_driver",
    "normalize_tool_response"
  ];
  const commonNodeFields = {
    category: category || "tool",
    toolRole,
    required: true,
    enabled: true
  };
  const nodesById = {
    receive_tool_request: {
      ...commonNodeFields,
      id: "receive_tool_request",
      phase: "request",
      description: `接收 ${spec.ref || resource?.ref || "当前工具"} 的调用请求。`,
      inputs: Object.values(spec.requestContract?.inputSources || {}),
      outputs: ["tool.request"]
    },
    validate_tool_contract: {
      ...commonNodeFields,
      id: "validate_tool_contract",
      phase: "contract",
      description: requiredFields.length > 0
        ? `校验必填字段：${requiredFields.join(", ")}。`
        : "校验工具请求契约。",
      inputs: ["tool.request"],
      outputs: ["tool.normalizedRequest"]
    },
    enforce_tool_policy: {
      ...commonNodeFields,
      id: "enforce_tool_policy",
      phase: "policy",
      description: denyEntries.length > 0
        ? `执行工具策略限制：${denyEntries.map(([key, value]) => `${key}=${value}`).join(", ")}。`
        : "执行工具策略限制和场景白名单检查。",
      inputs: ["tool.normalizedRequest"],
      outputs: ["tool.policyResult"]
    },
    prepare_driver_call: {
      ...commonNodeFields,
      id: "prepare_driver_call",
      phase: "driver",
      description: driver.type === "agent-runtime"
        ? `准备 Agent Runtime 调用：${driver.runtimeRef || "runtime"}。`
        : `准备 ${driver.type || "driver"} 调用：${driver.endpoint || driver.runtimeRef || "受控驱动"}。`,
      inputs: ["tool.normalizedRequest", "tool.policyResult"],
      outputs: ["tool.driverRequest"]
    },
    invoke_tool_driver: {
      ...commonNodeFields,
      id: "invoke_tool_driver",
      phase: "execution",
      description: `按默认超时 ${spec.limits?.timeoutMsDefault ?? "-"} ms 调用底层能力，最多重试 ${spec.limits?.retryMaxAttempts ?? "-"} 次。`,
      inputs: ["tool.driverRequest"],
      outputs: ["tool.rawResponse"]
    },
    normalize_tool_response: {
      ...commonNodeFields,
      id: "normalize_tool_response",
      phase: "response",
      description: `按响应契约读取结果 ${spec.responseContract?.resultPath || "-"}，错误路径 ${spec.responseContract?.errorPath || "-"}。`,
      inputs: ["tool.rawResponse"],
      outputs: [spec.responseContract?.resultPath || "tool.result"]
    }
  };

  return {
    orderedNodeIds,
    nodesById,
    defaultNextByNodeId: Object.fromEntries(
      orderedNodeIds.map((nodeId, index) => [nodeId, orderedNodeIds[index + 1] || null])
    ),
    conditionalEdges: [],
    shellKey
  };
}

export function ConfigCatalogPage({ kind = null, sectionLabel = "配置目录" }) {
  const useWaterfallLayout = kind === "skill";
  const [searchParams, setSearchParams] = useSearchParams();
  const [catalog, setCatalog] = useState(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [toolEditorOpen, setToolEditorOpen] = useState(false);
  const [toolEditorStatus, setToolEditorStatus] = useState("idle");
  const [toolEditorMessage, setToolEditorMessage] = useState("");
  const [toolDraft, setToolDraft] = useState(null);
  const [toolSceneOptions, setToolSceneOptions] = useState([]);
  const [queryEditorOpen, setQueryEditorOpen] = useState(false);
  const [queryEditorStatus, setQueryEditorStatus] = useState("idle");
  const [queryEditorMessage, setQueryEditorMessage] = useState("");
  const [queryDraft, setQueryDraft] = useState(null);
  const [skillAssetEditorOpen, setSkillAssetEditorOpen] = useState(false);
  const [skillAssetEditorType, setSkillAssetEditorType] = useState("");
  const [skillAssetEditorStatus, setSkillAssetEditorStatus] = useState("idle");
  const [skillAssetEditorMessage, setSkillAssetEditorMessage] = useState("");
  const [skillAssetContent, setSkillAssetContent] = useState("");
  const [skillAssetMeta, setSkillAssetMeta] = useState(null);
  const [skillWorkflowPreview, setSkillWorkflowPreview] = useState(null);
  const [skillWorkflowStatus, setSkillWorkflowStatus] = useState("idle");
  const [skillWorkflowMessage, setSkillWorkflowMessage] = useState("");
  const selectedResourceId = searchParams.get("resource") || "";

  useEffect(() => {
    let active = true;

    async function loadCatalog() {
      setStatus("loading");
      setErrorMessage("");

      try {
        const response = await apiClient.getConfigCatalog();
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setCatalog(null);
          setStatus("error");
          setErrorMessage(
            response?.payload?.error?.message || "配置目录读取失败。"
          );
          return;
        }

        setCatalog(response?.payload?.data || { items: [] });
        setStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setCatalog(null);
        setStatus("error");
        setErrorMessage(error.message || "配置目录读取失败。");
      }
    }

    loadCatalog();

    return () => {
      active = false;
    };
  }, []);

  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const groupedItems = useMemo(() => ({
    skill: items.filter((item) => item.kind === "skill"),
    template: items.filter((item) => item.kind === "template"),
    query: items.filter((item) => item.kind === "query"),
    tool: items.filter((item) => item.kind === "tool")
  }), [items]);

  const visibleItems = useMemo(() => (
    kind ? groupedItems[kind] || [] : items
  ), [groupedItems, items, kind]);

  const selectedResource = useMemo(() => (
    visibleItems.find((item) => item.resourceId === selectedResourceId) || pickDefaultResource(visibleItems)
  ), [selectedResourceId, visibleItems]);

  useEffect(() => {
    if (status !== "ready") {
      return;
    }

    if (visibleItems.length === 0) {
      if (selectedResourceId) {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.delete("resource");
        setSearchParams(nextSearchParams, { replace: true });
      }
      return;
    }

    const selectedStillValid = visibleItems.some((item) => item.resourceId === selectedResourceId);
    if (!selectedStillValid) {
      const defaultResource = pickDefaultResource(visibleItems);
      if (!defaultResource) {
        return;
      }

      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set("resource", defaultResource.resourceId);
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [searchParams, selectedResourceId, setSearchParams, status, visibleItems]);

  const scopeDescription = kindDescription(kind, sectionLabel);
  const toolStructuredItems = useMemo(() => (
    selectedResource?.kind === "tool"
      ? buildToolStructuredItems(selectedResource, toolSceneOptions)
      : []
  ), [selectedResource, toolSceneOptions]);
  const queryStructuredItems = useMemo(() => (
    selectedResource?.kind === "query"
      ? buildQueryStructuredItems(selectedResource)
      : []
  ), [selectedResource]);
  const skillAssetItems = useMemo(() => (
    selectedResource?.kind === "skill"
      ? buildSkillAssetItems(selectedResource)
      : []
  ), [selectedResource]);
  const skillAssetLabelSummary = useMemo(() => (
    formatChineseList(skillAssetItems.map((item) => item.label))
  ), [skillAssetItems]);
  const activeSkillAssetConfig = useMemo(() => (
    skillAssetEditorType ? getSkillAssetEditorConfig(skillAssetEditorType) : null
  ), [skillAssetEditorType]);
  const skillOnlyWorkflowPreview = useMemo(() => (
    buildSkillOnlyWorkflowPreview(skillWorkflowPreview)
  ), [skillWorkflowPreview]);
  const queryWorkflowPreview = useMemo(() => (
    selectedResource?.kind === "query" ? buildQueryWorkflowPreview(selectedResource) : null
  ), [selectedResource]);
  const toolWorkflowPreview = useMemo(() => (
    selectedResource?.kind === "tool" ? buildToolWorkflowPreview(selectedResource) : null
  ), [selectedResource]);

  useEffect(() => {
    if (selectedResource?.kind === "tool") {
      setToolDraft(buildToolDraft(selectedResource));
    } else {
      setToolDraft(null);
    }
    if (selectedResource?.kind === "query") {
      setQueryDraft(buildQueryDraft(selectedResource));
    } else {
      setQueryDraft(null);
    }
    setToolEditorOpen(false);
    setToolEditorStatus("idle");
    setToolEditorMessage("");
    setQueryEditorOpen(false);
    setQueryEditorStatus("idle");
    setQueryEditorMessage("");
    setSkillAssetEditorOpen(false);
    setSkillAssetEditorType("");
    setSkillAssetEditorStatus("idle");
    setSkillAssetEditorMessage("");
    setSkillAssetContent("");
    setSkillAssetMeta(null);
  }, [selectedResource?.resourceId, selectedResource?.kind]);

  useEffect(() => {
    let active = true;

    async function loadSkillWorkflowPreview() {
      if (selectedResource?.kind !== "skill" || !selectedResource?.scene) {
        setSkillWorkflowPreview(null);
        setSkillWorkflowStatus("idle");
        setSkillWorkflowMessage("");
        return;
      }

      setSkillWorkflowPreview(null);
      setSkillWorkflowStatus("loading");
      setSkillWorkflowMessage("");

      try {
        const response = await apiClient.compilePreview({
          scene: selectedResource.scene
        });

        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setSkillWorkflowPreview(null);
          setSkillWorkflowStatus("error");
          setSkillWorkflowMessage(
            response?.payload?.error?.message || "业务技能流程预览读取失败。"
          );
          return;
        }

        setSkillWorkflowPreview(response?.payload?.data || null);
        setSkillWorkflowStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setSkillWorkflowPreview(null);
        setSkillWorkflowStatus("error");
        setSkillWorkflowMessage(error.message || "业务技能流程预览读取失败。");
      }
    }

    loadSkillWorkflowPreview();

    return () => {
      active = false;
    };
  }, [selectedResource?.resourceId, selectedResource?.kind, selectedResource?.scene]);

  function handleSelectResource(resourceId) {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("resource", resourceId);
    setSearchParams(nextSearchParams);
  }

  async function handleOpenToolEditor() {
    if (selectedResource?.kind !== "tool") {
      return;
    }

    setToolEditorOpen(true);
    setToolEditorMessage("");
    setToolDraft(buildToolDraft(selectedResource));

    if (toolSceneOptions.length > 0) {
      setToolEditorStatus("ready");
      return;
    }

    setToolEditorStatus("loading");

    try {
      const response = await apiClient.listScenes();
      if (!response?.ok || response?.payload?.success === false) {
        setToolEditorStatus("error");
        setToolEditorMessage(
          response?.payload?.error?.message || "系统场景列表读取失败。"
        );
        return;
      }

      const nextSceneOptions = (response?.payload?.data?.items || [])
        .map((item) => ({
          scene: item.scene,
          title: item.title || item.scene
        }))
        .sort((left, right) => left.scene.localeCompare(right.scene));

      setToolSceneOptions(nextSceneOptions);
      setToolEditorStatus("ready");
    } catch (error) {
      setToolEditorStatus("error");
      setToolEditorMessage(error.message || "系统场景列表读取失败。");
    }
  }

  function handleCancelToolEdit() {
    setToolEditorOpen(false);
    setToolEditorStatus("idle");
    setToolEditorMessage("");
    setToolDraft(selectedResource?.kind === "tool" ? buildToolDraft(selectedResource) : null);
  }

  function handleToolLimitChange(fieldName, value) {
    setToolDraft((currentDraft) => (
      currentDraft
        ? {
            ...currentDraft,
            limits: {
              ...currentDraft.limits,
              [fieldName]: value
            }
          }
        : currentDraft
    ));
  }

  function handleToolSceneToggle(scene, checked) {
    setToolDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      const currentAllowedScenes = new Set(currentDraft.allowedScenes);
      if (checked) {
        currentAllowedScenes.add(scene);
      } else {
        currentAllowedScenes.delete(scene);
      }

      return {
        ...currentDraft,
        allowedScenes: Array.from(currentAllowedScenes)
      };
    });
  }

  async function handleSaveToolConfig(event) {
    event.preventDefault();
    if (selectedResource?.kind !== "tool" || !toolDraft) {
      return;
    }

    setToolEditorStatus("saving");
    setToolEditorMessage("");

    try {
      const response = await apiClient.updateToolStructuredConfig(selectedResource.resourceId, {
        limits: {
          timeoutMsDefault: Number(toolDraft.limits.timeoutMsDefault),
          timeoutMsMax: Number(toolDraft.limits.timeoutMsMax),
          retryMaxAttempts: Number(toolDraft.limits.retryMaxAttempts)
        },
        allowedScenes: toolDraft.allowedScenes
      });

      if (!response?.ok || response?.payload?.success === false) {
        setToolEditorStatus("error");
        setToolEditorMessage(
          response?.payload?.error?.message || "工具配置保存失败。"
        );
        return;
      }

      const catalogResponse = await apiClient.getConfigCatalog();
      if (!catalogResponse?.ok || catalogResponse?.payload?.success === false) {
        setToolEditorStatus("error");
        setToolEditorMessage("工具配置已保存，但目录刷新失败。");
        return;
      }

      setCatalog(catalogResponse?.payload?.data || { items: [] });
      setToolEditorStatus("ready");
      setToolEditorMessage(
        `已保存工具配置到 ${formatStorageTarget(response?.payload?.data)}，平台校验通过。`
      );
    } catch (error) {
      setToolEditorStatus("error");
      setToolEditorMessage(error.message || "工具配置保存失败。");
    }
  }

  function handleOpenQueryEditor() {
    if (selectedResource?.kind !== "query") {
      return;
    }

    setQueryEditorOpen(true);
    setQueryEditorStatus("ready");
    setQueryEditorMessage("");
    setQueryDraft(buildQueryDraft(selectedResource));
  }

  function handleCancelQueryEdit() {
    setQueryEditorOpen(false);
    setQueryEditorStatus("idle");
    setQueryEditorMessage("");
    setQueryDraft(selectedResource?.kind === "query" ? buildQueryDraft(selectedResource) : null);
  }

  function handleQueryPrimaryEntityChange(fieldName, value) {
    setQueryDraft((currentDraft) => (
      currentDraft
        ? {
            ...currentDraft,
            primaryEntity: {
              ...currentDraft.primaryEntity,
              [fieldName]: value
            }
          }
        : currentDraft
    ));
  }

  function handleQueryLimitChange(fieldName, value) {
    setQueryDraft((currentDraft) => (
      currentDraft
        ? {
            ...currentDraft,
            limits: {
              ...currentDraft.limits,
              [fieldName]: value
            }
          }
        : currentDraft
    ));
  }

  function handleQueryDraftChange(fieldName, value) {
    setQueryDraft((currentDraft) => (
      currentDraft
        ? {
            ...currentDraft,
            [fieldName]: value
          }
        : currentDraft
    ));
  }

  async function handleSaveQueryConfig(event) {
    event.preventDefault();
    if (selectedResource?.kind !== "query" || !queryDraft) {
      return;
    }

    setQueryEditorStatus("saving");
    setQueryEditorMessage("");

    let fields;
    let where;

    try {
      fields = JSON.parse(queryDraft.fieldsText || "{}");
    } catch {
      setQueryEditorStatus("error");
      setQueryEditorMessage("输入字段映射必须是合法 JSON 对象。");
      return;
    }

    try {
      where = JSON.parse(queryDraft.whereText || "[]");
    } catch {
      setQueryEditorStatus("error");
      setQueryEditorMessage("查询条件必须是合法 JSON 数组。");
      return;
    }

    const requiredInputs = Array.from(new Set(
      (queryDraft.requiredInputsText || "")
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
    ));
    const resultFields = Array.from(new Set(
      (queryDraft.resultFieldsText || "")
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
    ));

    try {
      const response = await apiClient.updateQueryStructuredConfig(selectedResource.resourceId, {
        primaryEntity: {
          table: queryDraft.primaryEntity.table,
          idField: queryDraft.primaryEntity.idField
        },
        inputContract: {
          requiredInputs,
          fields
        },
        selectionPolicy: {
          cardinality: queryDraft.cardinality,
          where,
          statement: {
            type: queryDraft.statementType
          }
        },
        resultPolicy: {
          mode: queryDraft.resultMode,
          fields: resultFields,
          distinct: Boolean(queryDraft.resultDistinct),
          limit: queryDraft.resultLimit ? Number(queryDraft.resultLimit) : null
        },
        limits: {
          timeoutMsDefault: Number(queryDraft.limits.timeoutMsDefault),
          timeoutMsMax: Number(queryDraft.limits.timeoutMsMax),
          retryMaxAttempts: Number(queryDraft.limits.retryMaxAttempts)
        }
      });

      if (!response?.ok || response?.payload?.success === false) {
        setQueryEditorStatus("error");
        setQueryEditorMessage(
          response?.payload?.error?.message || "查询配置保存失败。"
        );
        return;
      }

      const catalogResponse = await apiClient.getConfigCatalog();
      if (!catalogResponse?.ok || catalogResponse?.payload?.success === false) {
        setQueryEditorStatus("error");
        setQueryEditorMessage("查询配置已保存，但目录刷新失败。");
        return;
      }

      setCatalog(catalogResponse?.payload?.data || { items: [] });
      setQueryEditorStatus("ready");
      setQueryEditorMessage(
        `已保存查询配置到 ${formatStorageTarget(response?.payload?.data)}，平台校验通过。`
      );
    } catch (error) {
      setQueryEditorStatus("error");
      setQueryEditorMessage(error.message || "查询配置保存失败。");
    }
  }

  function getSkillAssetEditorConfig(assetType) {
    return {
      prompt: {
        label: "提示词",
        load: apiClient.getScenePromptAsset,
        save: apiClient.updateScenePromptAsset,
        loadText: "正在读取提示词内容...",
        introText: "保存后会写入配置中心 MySQL 草稿，不会立即改动本地 prompt 文件，并执行平台校验和当前场景编译预览。"
      },
      schema: {
        label: "结构定义",
        load: apiClient.getSceneSchemaAsset,
        save: apiClient.updateSceneSchemaAsset,
        loadText: "正在读取结构定义内容...",
        introText: "保存后会写入配置中心 MySQL 草稿，不会立即改动本地 schema 文件，并执行 JSON 校验、平台校验和当前场景编译预览。"
      },
      dictionary: {
        label: "数据字典",
        load: apiClient.getSceneDictionaryAsset,
        save: apiClient.updateSceneDictionaryAsset,
        loadText: "正在读取数据字典内容...",
        introText: "保存后会写入配置中心 MySQL 草稿，不会立即改动本地 TSV 字典文件，并执行表头校验、平台校验和当前场景编译预览。"
      },
      rules: {
        label: "规则",
        load: apiClient.getSceneRulesAsset,
        save: apiClient.updateSceneRulesAsset,
        loadText: "正在读取规则内容...",
        introText: "保存后会写入配置中心 MySQL 草稿，不会立即改动本地规则文件，并执行平台校验和当前场景编译预览。"
      }
    }[assetType] || null;
  }

  async function handleOpenSkillAssetEditor(assetType) {
    if (selectedResource?.kind !== "skill" || !selectedResource?.scene) {
      return;
    }

    const assetConfig = getSkillAssetEditorConfig(assetType);
    if (!assetConfig) {
      return;
    }

    setSkillAssetEditorOpen(true);
    setSkillAssetEditorType(assetType);
    setSkillAssetEditorMessage("");

    if (
      skillAssetMeta?.scene === selectedResource.scene
      && skillAssetEditorType === assetType
      && typeof skillAssetMeta?.content === "string"
    ) {
      setSkillAssetContent(skillAssetMeta.content);
      setSkillAssetEditorStatus("ready");
      return;
    }

    setSkillAssetEditorStatus("loading");

    try {
      const response = await assetConfig.load(selectedResource.scene);
      if (!response?.ok || response?.payload?.success === false) {
        setSkillAssetEditorStatus("error");
        setSkillAssetEditorMessage(
          response?.payload?.error?.message || `${assetConfig.label}内容读取失败。`
        );
        return;
      }

      const nextAssetMeta = response?.payload?.data || null;
      setSkillAssetMeta(nextAssetMeta);
      setSkillAssetContent(nextAssetMeta?.content || "");
      setSkillAssetEditorStatus("ready");
    } catch (error) {
      setSkillAssetEditorStatus("error");
      setSkillAssetEditorMessage(error.message || `${assetConfig.label}内容读取失败。`);
    }
  }

  function handleCancelSkillAssetEdit() {
    setSkillAssetEditorOpen(false);
    setSkillAssetEditorType("");
    setSkillAssetEditorStatus("idle");
    setSkillAssetEditorMessage("");
    setSkillAssetContent(skillAssetMeta?.content || "");
  }

  async function handleSaveSkillAsset(event) {
    event.preventDefault();
    if (selectedResource?.kind !== "skill" || !selectedResource?.scene || !skillAssetEditorType) {
      return;
    }

    const assetConfig = getSkillAssetEditorConfig(skillAssetEditorType);
    if (!assetConfig) {
      return;
    }

    setSkillAssetEditorStatus("saving");
    setSkillAssetEditorMessage("");

    try {
      const response = await assetConfig.save(selectedResource.scene, {
        content: skillAssetContent
      });

      if (!response?.ok || response?.payload?.success === false) {
        setSkillAssetEditorStatus("error");
        setSkillAssetEditorMessage(
          response?.payload?.error?.message || `${assetConfig.label}保存失败。`
        );
        return;
      }

      const savedAsset = response?.payload?.data || null;
      setSkillAssetMeta(savedAsset);
      setSkillAssetContent(savedAsset?.content || skillAssetContent);
      setSkillAssetEditorStatus("ready");
      setSkillAssetEditorMessage(buildAssetSaveMessage(assetConfig.label, savedAsset));
    } catch (error) {
      setSkillAssetEditorStatus("error");
      setSkillAssetEditorMessage(error.message || `${assetConfig.label}保存失败。`);
    }
  }

  return (
    <PageFrame
      eyebrow="配置"
      title={`配置目录 / ${sectionLabel}`}
      description={scopeDescription}
      actions={(
        <div className="header-badges">
          <span className="pill">当前目录：{sectionLabel}</span>
          <span className="pill">真实接口：GET /api/console/configs/catalog</span>
        </div>
      )}
    >
      {status === "error" ? (
        <section className="section-card">
          <h4>读取失败</h4>
          <p className="muted-text">{errorMessage}</p>
        </section>
      ) : null}

      {catalog ? (
        <>
          <div className={`config-shell${useWaterfallLayout ? " config-shell-flow" : ""}`}>
            <section className={`section-card config-sidebar${kind === "tool" || useWaterfallLayout ? " config-sidebar-static" : ""}`}>
              <div className="section-header">
                <div>
                  <p className="eyebrow">目录</p>
                  <h4>{sectionLabel}目录</h4>
                </div>
                <span className="tag tag-neutral">{visibleItems.length}</span>
              </div>

              {visibleItems.length > 0 ? (
                <div className="config-kind-group">
                  <p className="muted-text">
                    当前只展示{sectionLabel}，要切换类别可以直接使用左侧二级菜单。
                  </p>
                  <div className="config-resource-list">
                    {visibleItems.map((item) => (
                      <button
                        className={`config-resource-button${selectedResource?.resourceId === item.resourceId ? " config-resource-button-active" : ""}`}
                        key={item.resourceId}
                        onClick={() => handleSelectResource(item.resourceId)}
                        type="button"
                      >
                        <strong>{item.title}</strong>
                        <p>{item.name}@{item.version}</p>
                        <span className="mono-text">{item.summary?.primary || "-"}</span>
                        {item.summary?.secondary ? (
                          <p className="detail-note">{item.summary.secondary}</p>
                        ) : null}
                        {kind === "tool" ? (
                          <p className="detail-note">{buildToolRemark(item)}</p>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="muted-text">当前目录下还没有可浏览的配置资源。</p>
              )}
            </section>

            {selectedResource ? (
              <div className={`config-main${useWaterfallLayout ? " config-main-flow" : ""}`}>
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">{kindLabelText(selectedResource.kindLabel)}</p>
                      <h4>{selectedResource.title}</h4>
                    </div>
                    <div className="tag-list">
                      <span className="tag">{selectedResource.name}@{selectedResource.version}</span>
                      <span className="tag tag-soft">{statusLabel(selectedResource.status)}</span>
                    </div>
                  </div>

                  <KeyValueList
                    items={buildResourceMetaItems(selectedResource)}
                  />
                </section>

                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">关联</p>
                      <h4>关联资源</h4>
                    </div>
                  </div>
                  <p className="section-text">
                    {buildRelatedResourceExplanation(selectedResource)}
                  </p>
                  {selectedResource.relatedResources?.length > 0 ? (
                    <div className="simple-list">
                      {selectedResource.relatedResources.map((relation) => {
                        return (
                          <div className="simple-list-row" key={`${selectedResource.resourceId}-${relation.resourceId}-${relation.relation}`}>
                            <div>
                              <strong>{relation.relation}</strong>
                              <p>{relation.label}</p>
                              <p className="detail-note">
                                {buildRelatedResourceItemNote(selectedResource, relation)}
                              </p>
                            </div>
                            <span className="muted-text">{relation.resourceId}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="muted-text">当前资源没有可展示的关联资源。</p>
                  )}
                </section>

                {selectedResource.kind === "skill" ? (
                  <>
                    {skillWorkflowStatus === "error" ? (
                      <section className="section-card">
                        <div className="section-header">
                          <div>
                            <p className="eyebrow">IVR</p>
                            <h4>业务技能流程视图</h4>
                          </div>
                        </div>
                        <div className="callout callout-error">
                          <strong>读取失败</strong>
                          <p>{skillWorkflowMessage}</p>
                        </div>
                      </section>
                    ) : null}
                    {skillWorkflowStatus === "loading" ? (
                      <section className="section-card">
                        <div className="section-header">
                          <div>
                            <p className="eyebrow">IVR</p>
                            <h4>业务技能流程视图</h4>
                          </div>
                          <span className="pill">加载中</span>
                        </div>
                        <p className="section-text">
                          这里只展示当前业务技能自身负责的流程节点，不包含平台运行壳、查询 Tool 和校验 Tool。
                        </p>
                        <p className="muted-text">正在编译当前业务技能流程...</p>
                      </section>
                    ) : null}
                    {skillOnlyWorkflowPreview ? (
                      <WorkflowIvrFlow
                        conditionalEdges={skillOnlyWorkflowPreview.conditionalEdges || []}
                        defaultNextByNodeId={skillOnlyWorkflowPreview.defaultNextByNodeId || {}}
                        description="这里只展示当前业务技能自身负责的流程节点，不包含平台运行壳、查询 Tool 和校验 Tool。"
                        eyebrow="IVR"
                        orderedNodeIds={skillOnlyWorkflowPreview.orderedNodeIds || []}
                        nodesById={skillOnlyWorkflowPreview.nodesById || {}}
                        title="业务技能内部流程视图"
                        visibleShellKeys={["business-skill"]}
                      />
                    ) : null}
                  </>
                ) : null}

                {selectedResource.kind === "skill" ? (
                  <section className="section-card">
                    <div className="section-header">
                      <div>
                        <p className="eyebrow">资产</p>
                        <h4>业务技能资产</h4>
                      </div>
                    </div>
                    <p className="section-text">
                      这里直接编辑当前业务技能绑定的{skillAssetLabelSummary || "资产"}内容，保存后会写入配置中心草稿，不会立即回写对应文件。
                    </p>
                    <div className="asset-grid">
                      {skillAssetItems.map((item) => {
                        const editorVisible = skillAssetEditorOpen && skillAssetEditorType === item.type && activeSkillAssetConfig;

                        return (
                          <div className="asset-stack" key={`${selectedResource.resourceId}-${item.type}`}>
                            <AssetCard
                              action={(
                                <button
                                  className="button-secondary button-inline"
                                  disabled={!selectedResource.scene}
                                  onClick={() => handleOpenSkillAssetEditor(item.type)}
                                  type="button"
                                >
                                  编辑
                                </button>
                              )}
                              detail={buildAssetCardDetail(item, item.label)}
                              label={item.label}
                              note={item.note}
                              value={item.ref}
                            />

                            {editorVisible ? (
                              <form className="asset-editor" onSubmit={handleSaveSkillAsset}>
                                <div className="section-header">
                                  <div>
                                    <p className="eyebrow">{activeSkillAssetConfig.label}</p>
                                    <h4>编辑{activeSkillAssetConfig.label}</h4>
                                  </div>
                                  <span className="pill">
                                    {skillAssetEditorStatus === "loading"
                                      ? "读取中"
                                      : skillAssetEditorStatus === "saving"
                                        ? "保存中"
                                        : "写入草稿"}
                                  </span>
                                </div>
                                <p className="section-text">
                                  {activeSkillAssetConfig.introText}
                                </p>
                                {skillAssetEditorMessage ? (
                                  <div
                                    className={`callout ${
                                      skillAssetEditorStatus === "error"
                                        ? "callout-error"
                                        : "callout-success"
                                    }`}
                                  >
                                    <strong>
                                      {skillAssetEditorStatus === "error" ? "保存失败" : "已完成"}
                                    </strong>
                                    <p>{skillAssetEditorMessage}</p>
                                  </div>
                                ) : null}
                                {skillAssetEditorStatus === "loading" ? (
                                  <p className="muted-text">{activeSkillAssetConfig.loadText}</p>
                                ) : (
                                  <>
                                    <textarea
                                      className="field-input field-textarea"
                                      onChange={(event) => setSkillAssetContent(event.target.value)}
                                      value={skillAssetContent}
                                    />
                                    <div className="button-row">
                                      <button
                                        className="button-primary"
                                        disabled={skillAssetEditorStatus === "saving"}
                                        type="submit"
                                      >
                                        {skillAssetEditorStatus === "saving" ? "保存中..." : "保存到草稿"}
                                      </button>
                                      <button
                                        className="button-secondary"
                                        onClick={handleCancelSkillAssetEdit}
                                        type="button"
                                      >
                                        取消
                                      </button>
                                    </div>
                                  </>
                                )}
                              </form>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {selectedResource.kind === "query" ? (
                  <WorkflowIvrFlow
                    conditionalEdges={queryWorkflowPreview?.conditionalEdges || []}
                    defaultNextByNodeId={queryWorkflowPreview?.defaultNextByNodeId || {}}
                    description="这里展示当前 QueryProfile 在查询服务内部的执行流程，从读取配置、解析入参、安全约束、生成查询语句，到执行查询和结果整形。"
                    eyebrow="IVR"
                    orderedNodeIds={queryWorkflowPreview?.orderedNodeIds || []}
                    nodesById={queryWorkflowPreview?.nodesById || {}}
                    title="查询服务流程视图"
                    visibleShellKeys={["query-tool"]}
                  />
                ) : null}

                {selectedResource.kind === "query" ? (
                  <section className="section-card">
                    <div className="section-header">
                      <div>
                        <p className="eyebrow">结构化</p>
                        <h4>查询服务结构化信息</h4>
                      </div>
                      <button
                        className="button-secondary"
                        onClick={handleOpenQueryEditor}
                        type="button"
                      >
                        编辑
                      </button>
                    </div>

                    <KeyValueList items={queryStructuredItems} />

                    {queryEditorOpen ? (
                      <form className="asset-editor" onSubmit={handleSaveQueryConfig}>
                        <div className="section-header">
                          <div>
                            <p className="eyebrow">编辑</p>
                            <h4>修改查询配置</h4>
                          </div>
                          <span className="pill">
                            {queryEditorStatus === "saving" ? "保存中" : "写入草稿"}
                          </span>
                        </div>
                        <p className="section-text">
                          这里开放的是查询服务的方法配置，聚焦主表、入参映射、过滤条件、查询语句和返回形态。
                        </p>
                        {queryEditorMessage ? (
                          <div
                            className={`callout ${
                              queryEditorStatus === "error"
                                ? "callout-error"
                                : "callout-success"
                            }`}
                          >
                            <strong>
                              {queryEditorStatus === "error" ? "保存失败" : "已完成"}
                            </strong>
                            <p>{queryEditorMessage}</p>
                          </div>
                        ) : null}

                        <div className="form-grid-two">
                          <div className="field-group">
                            <label htmlFor="query-primary-table">主表</label>
                            <input
                              className="field-input"
                              id="query-primary-table"
                              onChange={(event) => handleQueryPrimaryEntityChange("table", event.target.value)}
                              type="text"
                              value={queryDraft?.primaryEntity?.table || ""}
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor="query-primary-id-field">主键字段（可选）</label>
                            <input
                              className="field-input"
                              id="query-primary-id-field"
                              onChange={(event) => handleQueryPrimaryEntityChange("idField", event.target.value)}
                              type="text"
                              value={queryDraft?.primaryEntity?.idField || ""}
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor="query-cardinality">查询返回策略</label>
                            <select
                              className="field-input"
                              id="query-cardinality"
                              onChange={(event) => handleQueryDraftChange("cardinality", event.target.value)}
                              value={queryDraft?.cardinality || ""}
                            >
                              <option value="single-record">single-record</option>
                              <option value="multi-record">multi-record</option>
                            </select>
                          </div>
                          <div className="field-group">
                            <label htmlFor="query-statement-type">查询语句类型</label>
                            <select
                              className="field-input"
                              id="query-statement-type"
                              onChange={(event) => handleQueryDraftChange("statementType", event.target.value)}
                              value={queryDraft?.statementType || ""}
                            >
                              <option value="select-top-1">select-top-1</option>
                              <option value="select-rows">select-rows</option>
                              <option value="select-column-values">select-column-values</option>
                              <option value="select-count">select-count</option>
                            </select>
                          </div>
                          <div className="field-group">
                            <label htmlFor="query-result-mode">结果模式</label>
                            <select
                              className="field-input"
                              id="query-result-mode"
                              onChange={(event) => handleQueryDraftChange("resultMode", event.target.value)}
                              value={queryDraft?.resultMode || "single-row"}
                            >
                              <option value="single-row">single-row</option>
                              <option value="multi-rows">multi-rows</option>
                              <option value="column-values">column-values</option>
                              <option value="aggregate-value">aggregate-value</option>
                            </select>
                          </div>
                          <div className="field-group">
                            <label htmlFor="query-result-limit">最大返回条数</label>
                            <input
                              className="field-input"
                              id="query-result-limit"
                              min="1"
                              onChange={(event) => handleQueryDraftChange("resultLimit", event.target.value)}
                              step="1"
                              type="number"
                              value={queryDraft?.resultLimit || ""}
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor="query-timeout-default">默认超时 (ms)</label>
                            <input
                              className="field-input"
                              id="query-timeout-default"
                              min="1"
                              onChange={(event) => handleQueryLimitChange("timeoutMsDefault", event.target.value)}
                              step="1"
                              type="number"
                              value={queryDraft?.limits?.timeoutMsDefault || ""}
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor="query-timeout-max">最大超时 (ms)</label>
                            <input
                              className="field-input"
                              id="query-timeout-max"
                              min="1"
                              onChange={(event) => handleQueryLimitChange("timeoutMsMax", event.target.value)}
                              step="1"
                              type="number"
                              value={queryDraft?.limits?.timeoutMsMax || ""}
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor="query-retry-max">最大重试次数</label>
                            <input
                              className="field-input"
                              id="query-retry-max"
                              min="0"
                              onChange={(event) => handleQueryLimitChange("retryMaxAttempts", event.target.value)}
                              step="1"
                              type="number"
                              value={queryDraft?.limits?.retryMaxAttempts || ""}
                            />
                          </div>
                        </div>

                        <div className="field-group">
                          <label htmlFor="query-required-inputs">必填入参</label>
                          <p className="field-help">每行一个，保存时会自动去重。</p>
                          <textarea
                            className="field-input field-textarea"
                            id="query-required-inputs"
                            onChange={(event) => handleQueryDraftChange("requiredInputsText", event.target.value)}
                            rows="4"
                            value={queryDraft?.requiredInputsText || ""}
                          />
                        </div>

                        <div className="field-group">
                          <label htmlFor="query-input-fields">输入字段映射 JSON</label>
                          <p className="field-help">对象格式，例如 opportunityId 对应 type 和 sourcePath。</p>
                          <textarea
                            className="field-input field-textarea"
                            id="query-input-fields"
                            onChange={(event) => handleQueryDraftChange("fieldsText", event.target.value)}
                            rows="10"
                            value={queryDraft?.fieldsText || ""}
                          />
                        </div>

                        <div className="field-group">
                          <label htmlFor="query-where">查询条件 JSON</label>
                          <p className="field-help">数组格式，每项包含 field、operator、param。</p>
                          <textarea
                            className="field-input field-textarea"
                            id="query-where"
                            onChange={(event) => handleQueryDraftChange("whereText", event.target.value)}
                            rows="8"
                            value={queryDraft?.whereText || ""}
                          />
                        </div>

                        <div className="field-group">
                          <label htmlFor="query-result-fields">返回字段</label>
                          <p className="field-help">每行一个字段；留空或写 * 表示返回全部字段。列值合集模式必须只保留 1 个字段。</p>
                          <textarea
                            className="field-input field-textarea"
                            id="query-result-fields"
                            onChange={(event) => handleQueryDraftChange("resultFieldsText", event.target.value)}
                            rows="4"
                            value={queryDraft?.resultFieldsText || ""}
                          />
                        </div>

                        <div className="field-group">
                          <label className="checkbox-option">
                            <input
                              checked={Boolean(queryDraft?.resultDistinct)}
                              onChange={(event) => handleQueryDraftChange("resultDistinct", event.target.checked)}
                              type="checkbox"
                            />
                            <span>结果去重</span>
                          </label>
                        </div>

                        <div className="button-row">
                          <button
                            className="button-primary"
                            disabled={queryEditorStatus === "saving"}
                            type="submit"
                          >
                            {queryEditorStatus === "saving" ? "保存中..." : "保存到草稿"}
                          </button>
                          <button
                            className="button-secondary"
                            onClick={handleCancelQueryEdit}
                            type="button"
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </section>
                ) : null}

                {selectedResource.kind === "tool" ? (
                  <WorkflowIvrFlow
                    conditionalEdges={toolWorkflowPreview?.conditionalEdges || []}
                    defaultNextByNodeId={toolWorkflowPreview?.defaultNextByNodeId || {}}
                    description="这里展示当前 ToolDefinition 的内部调用流程，从接收请求、校验契约、执行策略限制，到准备驱动调用、调用底层能力和归一化响应。"
                    eyebrow="IVR"
                    orderedNodeIds={toolWorkflowPreview?.orderedNodeIds || []}
                    nodesById={toolWorkflowPreview?.nodesById || {}}
                    title="工具执行流程视图"
                    visibleShellKeys={toolWorkflowPreview?.shellKey ? [toolWorkflowPreview.shellKey] : ["query-tool"]}
                  />
                ) : null}

                {selectedResource.kind === "tool" ? (
                  <section className="section-card">
                    <div className="section-header">
                      <div>
                        <p className="eyebrow">结构化</p>
                        <h4>工具结构化信息</h4>
                      </div>
                      <button
                        className="button-secondary"
                        onClick={handleOpenToolEditor}
                        type="button"
                      >
                        编辑
                      </button>
                    </div>

                    <KeyValueList items={toolStructuredItems} />

                    {toolEditorOpen ? (
                      <form className="asset-editor" onSubmit={handleSaveToolConfig}>
                        <div className="section-header">
                          <div>
                            <p className="eyebrow">编辑</p>
                            <h4>修改工具配置</h4>
                          </div>
                          <span className="pill">
                            {toolEditorStatus === "loading"
                              ? "读取中"
                              : toolEditorStatus === "saving"
                                ? "保存中"
                                : "写入草稿"}
                          </span>
                        </div>
                        <p className="section-text">
                          当前只开放运行限制和场景白名单。场景白名单只能从系统已注册场景中勾选，不能手动输入。
                        </p>
                        {toolEditorMessage ? (
                          <div
                            className={`callout ${
                              toolEditorStatus === "error"
                                ? "callout-error"
                                : "callout-success"
                            }`}
                          >
                            <strong>
                              {toolEditorStatus === "error" ? "保存失败" : "已完成"}
                            </strong>
                            <p>{toolEditorMessage}</p>
                          </div>
                        ) : null}
                        {toolEditorStatus === "loading" ? (
                          <p className="muted-text">正在读取系统场景列表...</p>
                        ) : (
                          <>
                            <div className="form-grid-two">
                              <div className="field-group">
                                <label htmlFor="tool-timeout-default">默认超时 (ms)</label>
                                <input
                                  className="field-input"
                                  id="tool-timeout-default"
                                  min="1"
                                  onChange={(event) => handleToolLimitChange("timeoutMsDefault", event.target.value)}
                                  step="1"
                                  type="number"
                                  value={toolDraft?.limits?.timeoutMsDefault || ""}
                                />
                              </div>
                              <div className="field-group">
                                <label htmlFor="tool-timeout-max">最大超时 (ms)</label>
                                <input
                                  className="field-input"
                                  id="tool-timeout-max"
                                  min="1"
                                  onChange={(event) => handleToolLimitChange("timeoutMsMax", event.target.value)}
                                  step="1"
                                  type="number"
                                  value={toolDraft?.limits?.timeoutMsMax || ""}
                                />
                              </div>
                              <div className="field-group">
                                <label htmlFor="tool-retry-max">最大重试次数</label>
                                <input
                                  className="field-input"
                                  id="tool-retry-max"
                                  min="0"
                                  onChange={(event) => handleToolLimitChange("retryMaxAttempts", event.target.value)}
                                  step="1"
                                  type="number"
                                  value={toolDraft?.limits?.retryMaxAttempts || ""}
                                />
                              </div>
                            </div>

                            <div className="field-group">
                              <label>场景白名单</label>
                              <p className="field-help">只能从系统已有场景中勾选。</p>
                              <div className="checkbox-list">
                                {toolSceneOptions.map((item) => (
                                  <label className="checkbox-option" key={item.scene}>
                                    <input
                                      checked={Boolean(toolDraft?.allowedScenes?.includes(item.scene))}
                                      onChange={(event) => handleToolSceneToggle(item.scene, event.target.checked)}
                                      type="checkbox"
                                    />
                                    <span>{formatSceneLabel(item.scene, toolSceneOptions)}</span>
                                  </label>
                                ))}
                              </div>
                            </div>

                            <div className="button-row">
                              <button
                                className="button-primary"
                                disabled={toolEditorStatus === "saving"}
                                type="submit"
                              >
                                {toolEditorStatus === "saving" ? "保存中..." : "保存到草稿"}
                              </button>
                              <button
                                className="button-secondary"
                                onClick={handleCancelToolEdit}
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
                ) : null}

                {shouldShowRawConfig(selectedResource) ? (
                  <section className="section-card">
                    <div className="section-header">
                      <div>
                        <p className="eyebrow">原始配置</p>
                        <h4>配置详情</h4>
                      </div>
                    </div>
                    <div className="code-panel">
                      <pre>{prettyJson(selectedResource.document)}</pre>
                    </div>
                  </section>
                ) : null}
              </div>
            ) : (
              <section className="section-card">
                <h4>暂无配置资源</h4>
                <p className="muted-text">当前目录下还没有可浏览的配置资源。</p>
              </section>
            )}
          </div>
        </>
      ) : status === "loading" ? (
        <section className="section-card">
          <h4>加载中</h4>
          <p className="muted-text">正在读取配置目录...</p>
        </section>
      ) : null}
    </PageFrame>
  );
}
