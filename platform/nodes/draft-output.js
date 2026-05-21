const { normalizeError } = require("../../utils/errors");
const { mergeWorkflowState, recordNodeRun } = require("../runtime/state");
const { invokeProjectAdvisoryLlm } = require("../runtime/llm-client");
const {
  buildToolRequestPayload,
  isObject,
  loadRegistrySnapshot,
  resolveNodeOverride,
  resolveSkillSpec,
  resolveToolDocumentByRole
} = require("./tool-runtime");

const NODE_ID = "draft-output";
const OVERRIDE_NODE_ID = "draft_business_output";
const DEFAULT_TOOL_ROLE = "advisory_llm";
const DRAFT_MODE_ENV = "LANGGRAPH_DRAFT_MODE";
const PAYMENT_INFO_LOCAL_FAST_PATH_MODE = "local-rule";
const SUPPORTED_DRAFT_MODES = new Set([
  "compat",
  "mock",
  "project-llm"
]);
const PAYMENT_FIELD_LABELS = Object.freeze({
  payeeName: [
    "收款方",
    "收款人",
    "户名",
    "公司名称",
    "单位名称",
    "账户名称",
    "账号名称"
  ],
  payeeAccount: [
    "收款账号",
    "银行账号",
    "银行帐号",
    "收款账户",
    "银行账户",
    "账号",
    "帐号",
    "卡号"
  ],
  bankName: [
    "开户银行",
    "开户行",
    "开户支行",
    "开户网点",
    "银行名称",
    "银行",
    "支行",
    "分行",
    "营业部",
    "行"
  ]
});
const PAYMENT_LABEL_TO_FIELD = new Map(
  Object.entries(PAYMENT_FIELD_LABELS).flatMap(([fieldName, labels]) => (
    labels.map((label) => [label, fieldName])
  ))
);
const PAYMENT_LABEL_PATTERN = Array.from(PAYMENT_LABEL_TO_FIELD.keys())
  .sort((left, right) => right.length - left.length)
  .map(escapeRegex)
  .join("|");
const SMART_ENTRY_BASE_FIELDS = Object.freeze([
  "opportunityName",
  "tenderType",
  "ownerName",
  "customerName",
  "industry",
  "smartContacts",
  "productCategory",
  "amount",
  "discountRate",
  "predictCloseDate",
  "predictTenderDate"
]);
const SMART_ENTRY_SCENE_FIELDS = Object.freeze({
  tenderNoDesign: [
    "projectBudgetAndSchedule",
    "projectReasonAndStandard",
    "integratorCoverage",
    "integratorInfluence",
    "competitorSituation",
    "tenderFlowAndKeyPerson",
    "integratorKeyPerson",
    "tenderBlueprintDate",
    "tenderTime",
    "bidTime",
    "purchaseTime"
  ],
  tenderDesigned: [
    "integratorCoverage",
    "integratorInfluence",
    "competitorSituation",
    "integratorKeyPerson",
    "canControlBid",
    "productShare",
    "tenderTime",
    "bidTime",
    "purchaseTime"
  ],
  noTender: [
    "projectBudgetAndSchedule",
    "projectReasonAndStandard",
    "competitorSituation",
    "integratorKeyPerson",
    "purchaseTime"
  ],
  smallProject: [
    "projectBudgetAndSchedule",
    "projectReasonAndStandard",
    "competitorSituation",
    "integratorKeyPerson",
    "purchaseTime"
  ],
  designInstitute: []
});
const SMART_ENTRY_SCENE_ALIASES = Object.freeze({
  招标未设计: "tenderNoDesign",
  招标已设计: "tenderDesigned",
  不招标: "noTender",
  小项目: "smallProject",
  设计院: "designInstitute"
});
const SMART_ENTRY_FIELD_MAPPINGS = Object.freeze({
  推荐品牌可以替换: {
    field: "canControlBid",
    value: "是"
  },
  推荐品牌不可替换: {
    field: "canControlBid",
    value: "否"
  },
  核心参数满足: {
    field: "productShare",
    value: "是"
  },
  核心参数不满足: {
    field: "productShare",
    value: "否"
  },
  投标时间: "tenderTime",
  采购时间: "purchaseTime",
  招标时间: "bidTime",
  开标时间: "bidTime"
});
const SMART_ENTRY_STRING_ONLY_FIELDS = new Set([
  "opportunityName",
  "ownerName",
  "customerName",
  "industry",
  "smartContacts",
  "productCategory",
  "discountRate",
  "predictCloseDate",
  "predictTenderDate",
  "projectBudgetAndSchedule",
  "projectReasonAndStandard",
  "integratorCoverage",
  "integratorInfluence",
  "competitorSituation",
  "tenderFlowAndKeyPerson",
  "integratorKeyPerson",
  "tenderBlueprintDate",
  "tenderTime",
  "bidTime",
  "purchaseTime",
  "canControlBid",
  "productShare"
]);

function toStateError(error) {
  return {
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus,
    stage: error.stage,
    retryable: error.retryable,
    details: error.details || null
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeInput(state) {
  return {
    scene: state?.request?.scene || null,
    requestId: state?.runtime_context?.request_id || null,
    factCount: Array.isArray(state?.artifacts?.facts?.items) ? state.artifacts.facts.items.length : 0,
    basisFieldCount: Array.isArray(state?.artifacts?.facts?.basis_fields)
      ? state.artifacts.facts.basis_fields.length
      : 0,
    knowledgeMatchCount: Array.isArray(state?.artifacts?.knowledge?.matches)
      ? state.artifacts.knowledge.matches.length
      : 0,
    hasPrompt: typeof state?.artifacts?.references?.prompt === "string",
    hasRules: typeof state?.artifacts?.references?.rules === "string"
  };
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function getFactValueText(itemsByField, fieldName) {
  return itemsByField.get(fieldName)?.value_text || null;
}

function isPresentValue(value) {
  return value !== undefined
    && value !== null
    && !(typeof value === "string" && value.trim().length === 0);
}

function normalizeDraftScalar(fieldName, value) {
  if (!isPresentValue(value)) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (SMART_ENTRY_STRING_ONLY_FIELDS.has(fieldName)) {
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function getFactRawValue(itemsByField, fieldName) {
  const item = itemsByField.get(fieldName);
  if (!item) {
    return undefined;
  }

  if (isPresentValue(item.raw_value)) {
    return item.raw_value;
  }

  return item.value_text;
}

function normalizeSmartEntryScene(rawScene) {
  if (!isPresentValue(rawScene)) {
    return "designInstitute";
  }

  const candidate = String(rawScene).trim();
  if (SMART_ENTRY_SCENE_FIELDS[candidate]) {
    return candidate;
  }

  return SMART_ENTRY_SCENE_ALIASES[candidate] || candidate;
}

function getSmartEntryAllowedFields(salesScene) {
  return uniqueStrings([
    ...SMART_ENTRY_BASE_FIELDS,
    ...(SMART_ENTRY_SCENE_FIELDS[salesScene] || [])
  ]);
}

function readSmartEntryFieldValue(fieldName, rawRow, itemsByField) {
  if (isPresentValue(rawRow?.[fieldName])) {
    return rawRow[fieldName];
  }

  return getFactRawValue(itemsByField, fieldName);
}

function clampText(value, maxLength = 2000) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength);
}

function mergeRawTextIntoSmartEntryField(data, fieldName, rawText) {
  const note = `本次智能录入：${rawText}`;
  const current = isPresentValue(data[fieldName]) ? String(data[fieldName]).trim() : "";
  data[fieldName] = clampText(current ? `${current}；${note}` : note);
}

function extractPaymentField(rawText, patterns) {
  const text = String(rawText || "");
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizePaymentFieldValue(match[1]);
    }
  }
  return "";
}

function normalizePaymentFieldValue(value) {
  return String(value || "")
    .replace(/^[\s:：]+/u, "")
    .replace(/[；;，,。.\s]+$/u, "")
    .trim();
}

function normalizePaymentAccountValue(value) {
  return normalizePaymentFieldValue(value).replace(/[\s-]+/g, "");
}

function findPaymentLabelMatches(rawText) {
  const text = String(rawText || "");
  if (!PAYMENT_LABEL_PATTERN) {
    return [];
  }

  const labelRegex = new RegExp(`(^|[\\s；;,，。.])(${PAYMENT_LABEL_PATTERN})\\s*[:：]\\s*`, "gu");
  const matches = [];
  let match;

  while ((match = labelRegex.exec(text)) !== null) {
    const prefix = match[1] || "";
    const label = match[2];
    const fieldName = PAYMENT_LABEL_TO_FIELD.get(label);
    if (!fieldName) {
      continue;
    }

    matches.push({
      fieldName,
      label,
      labelStart: match.index + prefix.length,
      valueStart: labelRegex.lastIndex
    });
  }

  return matches;
}

function parsePaymentLabeledFields(rawText) {
  const text = String(rawText || "");
  const labelMatches = findPaymentLabelMatches(text);
  const fields = {};

  for (let index = 0; index < labelMatches.length; index += 1) {
    const current = labelMatches[index];
    const next = labelMatches[index + 1];
    const valueEnd = next ? next.labelStart : text.length;
    const value = normalizePaymentFieldValue(text.slice(current.valueStart, valueEnd));
    if (value && !fields[current.fieldName]) {
      fields[current.fieldName] = value;
    }
  }

  return fields;
}

function containsPaymentLabelMarker(value) {
  const text = String(value || "");
  if (!text || !PAYMENT_LABEL_PATTERN) {
    return false;
  }

  const labelRegex = new RegExp(`(^|[\\s；;,，。.])(?:${PAYMENT_LABEL_PATTERN})\\s*[:：]`, "u");
  return labelRegex.test(text);
}

function hasCompletePaymentInfoPayload(payload) {
  return isObject(payload)
    && typeof payload.payeeName === "string"
    && payload.payeeName.trim().length > 0
    && typeof payload.payeeAccount === "string"
    && payload.payeeAccount.trim().length > 0
    && typeof payload.bankName === "string"
    && payload.bankName.trim().length > 0
    && !containsPaymentLabelMarker(payload.payeeName)
    && !containsPaymentLabelMarker(payload.payeeAccount)
    && !containsPaymentLabelMarker(payload.bankName);
}

function shouldUsePaymentInfoLocalFastPath({
  state,
  compatPayload,
  draftMode
} = {}) {
  return state?.request?.scene === "payment-info-split"
    && draftMode === "project-llm"
    && hasCompletePaymentInfoPayload(compatPayload);
}

function createPaymentInfoCompatDraftPayload(state) {
  const bizParams = state?.request?.normalized?.biz_params || state?.request?.biz_params || {};
  const rawText = String(bizParams.rawText || "");
  const labeledFields = parsePaymentLabeledFields(rawText);
  const payeeAccount = normalizePaymentAccountValue(labeledFields.payeeAccount)
    || normalizePaymentAccountValue(extractPaymentField(rawText, [
    /([0-9][0-9\s-]{8,80})/u
  ]));

  return {
    payeeName: normalizePaymentFieldValue(labeledFields.payeeName),
    payeeAccount,
    bankName: normalizePaymentFieldValue(labeledFields.bankName)
  };
}

function createContractRiskReviewCompatDraftPayload(state) {
  const documentText = String(state?.artifacts?.document?.text || "").trim();
  const riskPoints = [];

  if (/付款|回款|开票|尾款|预付款|结算/u.test(documentText)) {
    riskPoints.push("付款、回款或开票条款需要重点复核，避免付款触发条件不清导致回款延迟。");
  }

  if (/验收|交付|交货|交付周期|工期/u.test(documentText)) {
    riskPoints.push("交付或验收安排需要明确标准、期限和逾期处理机制，避免履约边界不清。");
  }

  if (/违约|赔偿|损失|责任|罚款/u.test(documentText)) {
    riskPoints.push("违约责任和赔偿范围需要确认是否设置合理上限，避免责任暴露过高。");
  }

  if (/解除|终止|争议|仲裁|诉讼|管辖/u.test(documentText)) {
    riskPoints.push("合同解除、终止或争议解决条款需要复核，确保审批后具备可执行的争议处理路径。");
  }

  const uniqueRiskPoints = uniqueStrings(riskPoints).slice(0, 8);
  if (uniqueRiskPoints.length === 0) {
    uniqueRiskPoints.push("当前合同解析文本未命中明确风险关键词，仍建议审批前由业务和法务复核关键商务条款。");
  }

  return {
    approvalAdvice: uniqueRiskPoints.length > 0
      ? "建议有条件通过审批：请在签署前复核并完善风险点所涉条款，确认付款、验收、交付和违约责任边界清晰。"
      : "建议通过审批：当前解析文本未发现明显合同风险，仍需保留常规法务复核。",
    riskPoints: uniqueRiskPoints
  };
}

function mergePaymentInfoProjectLlmPayload(payload, compatPayload) {
  if (!isObject(payload) || !isObject(compatPayload)) {
    return payload;
  }

  const llmPayeeName = containsPaymentLabelMarker(payload.payeeName)
    ? ""
    : normalizePaymentFieldValue(payload.payeeName);
  const llmPayeeAccount = containsPaymentLabelMarker(payload.payeeAccount)
    ? ""
    : normalizePaymentAccountValue(payload.payeeAccount);
  const llmBankName = containsPaymentLabelMarker(payload.bankName)
    ? ""
    : normalizePaymentFieldValue(payload.bankName);

  return {
    payeeName: normalizePaymentFieldValue(compatPayload.payeeName) || llmPayeeName,
    payeeAccount: normalizePaymentAccountValue(compatPayload.payeeAccount) || llmPayeeAccount,
    bankName: normalizePaymentFieldValue(compatPayload.bankName) || llmBankName
  };
}

function applySmartEntryRawTextUpdates(data, salesScene, rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return data;
  }

  const allowedFields = new Set(getSmartEntryAllowedFields(salesScene));
  const targetFields = [];

  if (/预算|进度|周期|实施|交付|风险|排期|计划|安排|本周|下周/u.test(text)) {
    targetFields.push("projectBudgetAndSchedule");
  }

  if (/原因|标准|技术评审|评审|需求|方案/u.test(text)) {
    targetFields.push("projectReasonAndStandard");
  }

  if (/竞争|竞品|对手/u.test(text)) {
    targetFields.push("competitorSituation");
  }

  if (/集成商|关键人|联系人|负责人/u.test(text)) {
    targetFields.push("integratorKeyPerson");
  }

  if (/招标|投标|开标|标书/u.test(text)) {
    targetFields.push("tenderFlowAndKeyPerson");
  }

  const selectedField = targetFields.find((fieldName) => allowedFields.has(fieldName))
    || [
      "projectBudgetAndSchedule",
      "projectReasonAndStandard",
      "competitorSituation",
      "integratorKeyPerson",
      "tenderFlowAndKeyPerson"
    ].find((fieldName) => allowedFields.has(fieldName));

  if (selectedField) {
    mergeRawTextIntoSmartEntryField(data, selectedField, text);
  }

  return data;
}

function createSmartEntryCompatDraftPayload({
  state,
  itemsByField
} = {}) {
  const rawRow = isObject(state?.artifacts?.context?.raw?.rawRow)
    ? state.artifacts.context.raw.rawRow
    : {};
  const bizParams = state?.request?.normalized?.biz_params || state?.request?.biz_params || {};
  const opportunityId = bizParams.opportunityId || rawRow.opportunityId || getFactRawValue(itemsByField, "opportunityId") || null;
  const salesScene = normalizeSmartEntryScene(
    rawRow.salesScene || getFactRawValue(itemsByField, "salesScene") || getFactValueText(itemsByField, "salesScene")
  );
  const allowedFields = getSmartEntryAllowedFields(salesScene);
  const data = {};

  for (const fieldName of allowedFields) {
    const value = normalizeDraftScalar(fieldName, readSmartEntryFieldValue(fieldName, rawRow, itemsByField));
    if (isPresentValue(value)) {
      data[fieldName] = value;
    }
  }

  applySmartEntryRawTextUpdates(data, salesScene, bizParams.rawText);

  return {
    opportunityId,
    salesScene,
    data
  };
}

function buildSummary(payloadContext) {
  const {
    itemsByField,
    opportunityId
  } = payloadContext;
  const opportunityName = getFactValueText(itemsByField, "opportunityName");
  const customerName = getFactValueText(itemsByField, "customerName");
  const salesStage = getFactValueText(itemsByField, "salesStage");
  const opportunityStatus = getFactValueText(itemsByField, "opportunityStatus");
  const amount = getFactValueText(itemsByField, "amount");
  const predictTenderDate = getFactValueText(itemsByField, "predictTenderDate");
  const winRate = getFactValueText(itemsByField, "winRate");
  const budgetConfirmed = getFactValueText(itemsByField, "budgetConfirmed");

  const parts = [];
  if (opportunityName && salesStage) {
    parts.push(`${opportunityName}处于${salesStage}阶段`);
  } else if (customerName && salesStage) {
    parts.push(`${customerName}机会处于${salesStage}阶段`);
  } else if (salesStage) {
    parts.push(`${salesStage}阶段机会`);
  } else if (opportunityStatus) {
    parts.push(`当前机会状态为${opportunityStatus}`);
  }

  if (predictTenderDate) {
    parts.push(`预计投标日期${predictTenderDate}`);
  }

  if (amount) {
    parts.push(`金额${amount}`);
  }

  if (winRate) {
    parts.push(`赢率${winRate}`);
  }

  if (budgetConfirmed === "否") {
    parts.push("预算尚未确认");
  } else if (budgetConfirmed === "是") {
    parts.push("预算已落实");
  }

  if (parts.length === 0 && opportunityId) {
    return `机会${opportunityId}需基于当前事实补充推进建议。`;
  }

  return `${parts.join("，")}。`;
}

function buildAdviceText(payloadContext) {
  const { itemsByField } = payloadContext;
  const salesStage = getFactValueText(itemsByField, "salesStage");
  const opportunityStatus = getFactValueText(itemsByField, "opportunityStatus");
  const budgetConfirmed = getFactValueText(itemsByField, "budgetConfirmed");
  const predictTenderDate = getFactValueText(itemsByField, "predictTenderDate");
  const competitor = getFactValueText(itemsByField, "competitor");
  const customerPainPoint = getFactValueText(itemsByField, "customerPainPoint");
  const customerConcern = getFactValueText(itemsByField, "customerConcern");

  const parts = [];
  if (opportunityStatus === "赢单") {
    parts.push("当前机会已赢单，建议把重心转向合同推进、回款节奏和交付风险控制。");
  } else if (opportunityStatus === "输单") {
    parts.push("当前机会已输单，建议转向复盘竞争过程、定位流失原因并修复客户关系。");
  } else if (salesStage === "招标与投标") {
    parts.push("当前处于招标与投标关键阶段，建议立即倒排投标准备节奏并锁定关键节点。");
  } else if (salesStage === "未判定" || salesStage === "已立项") {
    parts.push("当前首要任务是完成项目判断、需求澄清和决策链确认。");
  } else if (salesStage) {
    parts.push(`当前已进入${salesStage}阶段，建议围绕关键人、方案确认和商务推进集中发力。`);
  } else {
    parts.push("当前建议先围绕已知事实收敛关键风险与推进节奏。");
  }

  if (predictTenderDate) {
    parts.push(`预计投标日期为${predictTenderDate}，需要按日期倒排准备任务。`);
  }

  if (budgetConfirmed === "否") {
    parts.push("预算尚未落实，需尽快确认客户预算审批状态，避免后续推进被动。");
  }

  if (competitor) {
    parts.push(`已出现竞争对手${competitor}，需提前准备差异化竞争策略。`);
  }

  if (customerPainPoint) {
    parts.push(`建议直接回应客户当前痛点：${customerPainPoint}。`);
  } else if (customerConcern) {
    parts.push(`建议优先消除客户当前顾虑：${customerConcern}。`);
  }

  return parts.join("");
}

function buildNextActions(payloadContext) {
  const { itemsByField } = payloadContext;
  const salesStage = getFactValueText(itemsByField, "salesStage");
  const predictTenderDate = getFactValueText(itemsByField, "predictTenderDate");
  const budgetConfirmed = getFactValueText(itemsByField, "budgetConfirmed");
  const competitor = getFactValueText(itemsByField, "competitor");
  const customerPainPoint = getFactValueText(itemsByField, "customerPainPoint");
  const customerConcern = getFactValueText(itemsByField, "customerConcern");

  const actions = [];
  if (predictTenderDate) {
    actions.push(`围绕${predictTenderDate}倒排推进计划，明确标书、审批和汇报节点责任人`);
  }

  if (budgetConfirmed === "否") {
    actions.push("联系客户确认预算审批状态，推动形成明确的预算落实结论");
  }

  if (salesStage === "招标与投标") {
    actions.push("组织投标准备会，核对技术参数、商务条款和投标文件完整性");
  } else if (salesStage === "未判定" || salesStage === "已立项") {
    actions.push("安排客户访谈，补齐需求、预算、决策链和采购方式信息");
  } else {
    actions.push("梳理当前阶段关键人和关键节点，明确本周推进目标与输出物");
  }

  if (competitor) {
    actions.push(`梳理${competitor}的竞争策略和短板，准备差异化方案与应对口径`);
  }

  if (customerPainPoint) {
    actions.push(`结合客户痛点“${customerPainPoint}”完善方案亮点和沟通材料`);
  } else if (customerConcern) {
    actions.push(`针对客户顾虑“${customerConcern}”准备专项说明和风险应对方案`);
  }

  actions.push("复核事实依据与 basisFields，确保后续建议和回包字段保持一致");

  return uniqueStrings(actions).slice(0, 5);
}

function createCompatDraftPayload({
  state,
  requestPayload
} = {}) {
  if (state?.request?.scene === "special-custom-product-solution") {
    const bizParams = state?.request?.normalized?.biz_params || state?.request?.biz_params || {};
    const knowledgeMatches = Array.isArray(state?.artifacts?.knowledge?.matches)
      ? state.artifacts.knowledge.matches
      : [];
    const evidence = knowledgeMatches
      .slice(0, 3)
      .map((match, index) => `${index + 1}. ${String(match?.text || "").slice(0, 500)}`)
      .filter((text) => text.trim().length > 3)
      .join("\n");

    return {
      productSolution: [
        `特殊定制单号：${bizParams.specialCustomOrderNo || ""}`,
        `定制要求：${bizParams.customRequirement || ""}`,
        evidence ? `参考相似片段：\n${evidence}` : "参考相似片段：未检索到可用片段。",
        "请在正式模型生成模式下基于以上内容输出产品部方案。"
      ].join("\n\n")
    };
  }

  if (state?.request?.scene === "payment-info-split") {
    return createPaymentInfoCompatDraftPayload(state);
  }

  if (state?.request?.scene === "non-standard-contract-risk-review") {
    return createContractRiskReviewCompatDraftPayload(state);
  }

  const factItems = Array.isArray(state?.artifacts?.facts?.items)
    ? state.artifacts.facts.items
    : [];
  const itemsByField = new Map(factItems.map((item) => [item.field, item]));
  const basisFields = Array.isArray(state?.artifacts?.facts?.basis_fields)
    ? state.artifacts.facts.basis_fields
    : [];
  const knowledgeMatches = Array.isArray(state?.artifacts?.knowledge?.matches)
    ? state.artifacts.knowledge.matches
    : [];
  const opportunityId = state?.request?.normalized?.biz_params?.opportunityId
    || state?.request?.biz_params?.opportunityId
    || null;
  const payloadContext = {
    itemsByField,
    basisFields,
    opportunityId,
    profile: state?.artifacts?.facts?.profile || {},
    requestPayload
  };

  if (state?.request?.scene === "sales-opportunity-smart-entry") {
    return createSmartEntryCompatDraftPayload({
      state,
      itemsByField
    });
  }

  return {
    opportunityId,
    summary: buildSummary(payloadContext),
    adviceText: buildAdviceText(payloadContext),
    nextActions: buildNextActions(payloadContext).slice(0, 5),
    basisFields: basisFields.slice(0, 8),
    knowledgeMatches: knowledgeMatches.slice(0, 5).map((match) => ({
      text: typeof match?.text === "string" ? match.text.slice(0, 1200) : "",
      score: typeof match?.score === "number" ? match.score : null,
      distance: typeof match?.distance === "number" ? match.distance : null,
      metadata: isObject(match?.metadata) ? match.metadata : {}
    }))
  };
}

function normalizeDraftMode(rawMode) {
  const normalized = String(rawMode || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "llm") {
    return "project-llm";
  }

  if (SUPPORTED_DRAFT_MODES.has(normalized)) {
    return normalized;
  }

  return null;
}

function resolveDraftMode(env = process.env) {
  const envMode = normalizeDraftMode(env?.[DRAFT_MODE_ENV]);
  return envMode || "compat";
}

function buildEnrichedRequestPayload({
  requestPayload,
  promptRef,
  compatPayload = null,
  scene = null
} = {}) {
  const promptText = requestPayload?.prompt
    || requestPayload?.promptText
    || requestPayload?.promptRef
    || "";
  const enrichedPayload = {
    ...requestPayload,
    prompt: promptText,
    promptRef: promptRef || requestPayload?.promptRef || null
  };

  const requestScene = scene || requestPayload?.request?.scene || null;
  if (requestScene === "sales-opportunity-smart-entry" && isObject(compatPayload)) {
    const bizParams = requestPayload?.request?.biz_params || requestPayload?.request?.bizParams || {};
    enrichedPayload.compact = {
      kind: "sales-opportunity-smart-entry",
      currentPayload: compatPayload,
      rawText: typeof bizParams.rawText === "string" ? bizParams.rawText : "",
      allowedFields: {
        base: Array.from(SMART_ENTRY_BASE_FIELDS),
        ...Object.fromEntries(
          Object.entries(SMART_ENTRY_SCENE_FIELDS).map(([sceneName, fieldNames]) => [
            sceneName,
            Array.from(fieldNames)
          ])
        )
      },
      sceneAliases: SMART_ENTRY_SCENE_ALIASES,
      fieldMappings: SMART_ENTRY_FIELD_MAPPINGS
    };
  }

  return enrichedPayload;
}

function mergeSmartEntryProjectLlmPayload(payload, compatPayload) {
  if (!isObject(payload) || !isObject(compatPayload)) {
    return payload;
  }

  const salesScene = normalizeSmartEntryScene(payload.salesScene || compatPayload.salesScene);
  const allowedFields = getSmartEntryAllowedFields(salesScene);
  const llmData = isObject(payload.data) ? payload.data : {};
  const compatData = isObject(compatPayload.data) ? compatPayload.data : {};
  const data = {};

  for (const fieldName of allowedFields) {
    const llmValue = normalizeDraftScalar(fieldName, llmData[fieldName]);
    const compatValue = normalizeDraftScalar(fieldName, compatData[fieldName]);
    if (isPresentValue(llmValue)) {
      data[fieldName] = llmValue;
    } else if (isPresentValue(compatValue)) {
      data[fieldName] = compatValue;
    }
  }

  return {
    opportunityId: payload.opportunityId || compatPayload.opportunityId || null,
    salesScene,
    data
  };
}

async function executeDraftTool({
  state,
  toolDocument,
  requestPayload,
  promptRef,
  compatPayload,
  invokeTool = null,
  invokeProjectLlm = invokeProjectAdvisoryLlm
} = {}) {
  const enrichedRequestPayload = buildEnrichedRequestPayload({
    requestPayload,
    promptRef,
    compatPayload,
    scene: state?.request?.scene || null
  });

  if (invokeTool) {
    return invokeTool({
      toolDocument,
      requestPayload: enrichedRequestPayload,
      compatPayload
    });
  }

  const draftMode = resolveDraftMode();
  if (shouldUsePaymentInfoLocalFastPath({
    state,
    compatPayload,
    draftMode
  })) {
    return {
      payload: compatPayload,
      mode: PAYMENT_INFO_LOCAL_FAST_PATH_MODE
    };
  }

  if (draftMode === "mock") {
    return {
      payload: compatPayload,
      mode: "mock"
    };
  }

  if (draftMode === "project-llm") {
    return invokeProjectLlm({
      toolDocument,
      requestPayload: enrichedRequestPayload,
      promptRef,
      scene: state?.request?.scene || null,
      modelConfig: state?.scene_contract?.model || null
    });
  }

  return {
    payload: compatPayload,
    mode: "compat"
  };
}

function summarizeOutput(payload, toolRef, mode, execution = null) {
  return {
    toolRef,
    mode,
    provider: execution?.provider || null,
    model: execution?.model || null,
    apiKeySource: execution?.apiKeySource || null,
    summaryLength: typeof payload?.summary === "string" ? payload.summary.length : 0,
    adviceLength: typeof payload?.adviceText === "string" ? payload.adviceText.length : 0,
    nextActionCount: Array.isArray(payload?.nextActions) ? payload.nextActions.length : 0,
    basisFieldCount: Array.isArray(payload?.basisFields) ? payload.basisFields.length : 0,
    knowledgeMatchCount: Array.isArray(payload?.knowledgeMatches) ? payload.knowledgeMatches.length : 0
  };
}

async function runDraftOutputNode({
  state,
  skillSpec = null,
  invokeTool = null,
  invokeProjectLlm = invokeProjectAdvisoryLlm
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    const registrySnapshot = loadRegistrySnapshot();
    const resolvedSkillSpec = resolveSkillSpec(state, registrySnapshot, skillSpec);
    const nodeOverride = resolveNodeOverride({
      state,
      skillSpec: resolvedSkillSpec,
      nodeId: OVERRIDE_NODE_ID,
      fallbackNodeId: NODE_ID
    });
    const toolRole = nodeOverride.toolRole || DEFAULT_TOOL_ROLE;
    const { toolDocument, toolRef } = resolveToolDocumentByRole({
      registrySnapshot,
      skillSpec: resolvedSkillSpec,
      toolRole
    });
    const requestPayload = buildToolRequestPayload(state, toolDocument);
    const promptRef = nodeOverride.promptRef || state?.artifacts?.reference_meta?.prompt?.ref || null;
    const compatPayload = createCompatDraftPayload({
      state,
      requestPayload
    });
    const execution = await executeDraftTool({
      state,
      toolDocument,
      requestPayload,
      promptRef,
      compatPayload,
      invokeTool,
      invokeProjectLlm
    });
    let payload = isObject(execution?.payload) ? execution.payload : compatPayload;
    const mode = execution?.mode || "compat";
    if (state?.request?.scene === "payment-info-split" && mode === "project-llm") {
      payload = mergePaymentInfoProjectLlmPayload(payload, compatPayload);
    }
    if (state?.request?.scene === "sales-opportunity-smart-entry" && mode === "project-llm") {
      payload = mergeSmartEntryProjectLlmPayload(payload, compatPayload);
    }
    const existingRepairAttempts = Array.isArray(state?.artifacts?.draft?.repair_attempts)
      ? state.artifacts.draft.repair_attempts
      : [];

    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "success",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary: summarizeOutput(payload, toolRef, mode, execution)
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        draft: {
          payload,
          tool_ref: toolRef,
          tool_role: toolRole,
          mode,
          provider: execution?.provider || null,
          model: execution?.model || null,
          api_key_source: execution?.apiKeySource || null,
          prompt_ref: promptRef,
          repair_attempts: existingRepairAttempts
        },
        outputs: {
          draft_output: {
            drafted: true,
            tool_ref: toolRef,
            tool_role: toolRole,
            mode,
            provider: execution?.provider || null,
            model: execution?.model || null,
            api_key_source: execution?.apiKeySource || null,
            prompt_ref: promptRef
          }
        }
      },
      error: null
    });

    return nextState;
  } catch (error) {
    const normalized = normalizeError(error);
    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "error",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      error: {
        code: normalized.code,
        message: normalized.message,
        httpStatus: normalized.httpStatus,
        stage: normalized.stage,
        details: normalized.details || null
      }
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        outputs: {
          draft_output: {
            drafted: false,
            error_code: normalized.code,
            mode: normalized.stage === "project-llm" ? "project-llm" : null,
            provider: normalized.details?.provider || null,
            model: normalized.details?.model || null
          }
        }
      },
      result: null,
      error: toStateError(normalized)
    });

    return nextState;
  }
}

module.exports = {
  NODE_ID,
  buildEnrichedRequestPayload,
  createCompatDraftPayload,
  executeDraftTool,
  mergeSmartEntryProjectLlmPayload,
  resolveDraftMode,
  runDraftOutputNode
};
