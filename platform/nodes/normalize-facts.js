const { createAppError, normalizeError } = require("../../utils/errors");
const { mergeWorkflowState, recordNodeRun } = require("../runtime/state");

const NODE_ID = "normalize-facts";
const PROFILE_FIELD_ORDER = Object.freeze([
  "opportunityName",
  "customerName",
  "salesStage",
  "opportunityStatus",
  "businessType",
  "amount",
  "budgetConfirmed",
  "predictTenderDate"
]);
const BASIS_FIELD_ORDER = Object.freeze([
  "salesStage",
  "opportunityStatus",
  "businessType",
  "amount",
  "budgetConfirmed",
  "predictTenderDate",
  "winRate",
  "tenderType",
  "tenderStatus",
  "canControlBid",
  "competitor",
  "customerPainPoint",
  "customerConcern",
  "latestFollowTime",
  "customerName",
  "opportunityName"
]);
const PROFILE_MISSING_VALUE = "未提供";
const PROFILE_COMPAT_FIELD_OVERRIDES = Object.freeze({
  budgetConfirmed: {
    label: "预算是否确认",
    type: "enum",
    priority: 94,
    enumMappings: {
      "0": "否",
      "1": "是",
      false: "否",
      true: "是",
      no: "否",
      yes: "是",
      "否": "否",
      "是": "是"
    }
  }
});
const PROFILE_DERIVED_FIELDS = Object.freeze({
  businessType: {
    sourceField: "salesScene",
    label: "业务类型",
    priority: 96
  }
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function summarizeInput(state) {
  return {
    scene: state?.request?.scene || null,
    hasRawContext: isObject(state?.artifacts?.context?.raw?.rawRow),
    hasDictionary: typeof state?.artifacts?.references?.dictionary === "string"
  };
}

function requireNormalizeFactsState(state) {
  if (!isObject(state)) {
    throw createAppError("INVALID_REQUEST", "normalize-facts requires workflow state.", {
      stage: "normalize-facts"
    });
  }

  if (!isObject(state?.artifacts?.context?.raw?.rawRow)) {
    throw createAppError("INVALID_REQUEST", "normalize-facts requires artifacts.context.raw.rawRow.", {
      stage: "normalize-facts"
    });
  }

  if (typeof state?.artifacts?.references?.dictionary !== "string") {
    throw createAppError("INVALID_REQUEST", "normalize-facts requires loaded dictionary asset.", {
      stage: "normalize-facts"
    });
  }

  return state;
}

function parseDetailValue(description, key) {
  const pattern = new RegExp(`${key}：([^；]+)`);
  const match = String(description || "").match(pattern);
  return match ? match[1].trim() : null;
}

function parseEnumMappings(description) {
  const raw = parseDetailValue(description, "枚举");
  if (!raw) {
    return null;
  }

  const mappings = {};
  for (const segment of raw.split("|")) {
    const [rawKey, rawValue] = segment.split("=");
    if (!rawKey || rawValue === undefined) {
      continue;
    }
    mappings[String(rawKey).trim()] = String(rawValue).trim();
  }

  return Object.keys(mappings).length > 0 ? mappings : null;
}

function parsePriority(description) {
  const raw = parseDetailValue(description, "优先级");
  if (!raw) {
    return 0;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDictionary(tsvText) {
  const lines = String(tsvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw createAppError("FIELD_MAPPING_FAILED", "Dictionary TSV is empty.", {
      stage: "normalize-facts"
    });
  }

  const entriesByField = new Map();
  for (const line of lines.slice(1)) {
    const [fieldName, description = ""] = line.split("\t");
    if (!fieldName) {
      continue;
    }

    const label = String(description).split("；")[0]?.trim() || fieldName;
    entriesByField.set(fieldName.trim(), {
      field: fieldName.trim(),
      label,
      description,
      ignore: String(description).includes("处理：忽略"),
      type: parseDetailValue(description, "类型") || "text",
      enumMappings: parseEnumMappings(description),
      priority: parsePriority(description)
    });
  }

  return entriesByField;
}

function isBlankString(value) {
  return typeof value === "string" && value.trim().length === 0;
}

function resolveAllowedFields(state) {
  const allowedFields = state?.artifacts?.outputs?.authorize_scope?.allowed_fields;
  if (!Array.isArray(allowedFields) || allowedFields.length === 0) {
    return ["*"];
  }

  return allowedFields;
}

function isFieldAllowed(fieldName, allowedFields) {
  return allowedFields.includes("*") || allowedFields.includes(fieldName);
}

function formatMoney(rawValue) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(rawValue)}元`;
  }

  if (typeof rawValue === "string") {
    const normalized = rawValue.trim();
    if (!normalized) {
      return normalized;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(parsed)}元`;
    }
    return normalized;
  }

  return String(rawValue);
}

function formatPercent(rawValue) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return `${rawValue}%`;
  }

  if (typeof rawValue === "string") {
    const normalized = rawValue.trim();
    if (!normalized) {
      return normalized;
    }
    if (normalized.endsWith("%")) {
      return normalized;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return `${parsed}%`;
    }
    return normalized;
  }

  return String(rawValue);
}

function formatFactValue(rawValue, dictionaryEntry = null) {
  if (!dictionaryEntry) {
    return String(rawValue);
  }

  if (dictionaryEntry.enumMappings) {
    const mapped = dictionaryEntry.enumMappings[String(rawValue)];
    if (mapped) {
      return mapped;
    }
  }

  switch (dictionaryEntry.type) {
    case "money":
      return formatMoney(rawValue);
    case "percent":
      return formatPercent(rawValue);
    default:
      return String(rawValue);
  }
}

function buildFactItem(fieldName, rawValue, dictionaryEntry = null) {
  const label = dictionaryEntry?.label || fieldName;
  const valueText = formatFactValue(rawValue, dictionaryEntry);

  return {
    field: fieldName,
    label,
    raw_value: rawValue,
    value_text: valueText,
    fact_text: `${label}：${valueText}`,
    type: dictionaryEntry?.type || "text",
    priority: Number(dictionaryEntry?.priority || 0)
  };
}

function normalizeDictionaryEntryForField(fieldName, dictionaryEntry = null) {
  const override = PROFILE_COMPAT_FIELD_OVERRIDES[fieldName];
  if (!override) {
    return dictionaryEntry;
  }

  return {
    ...(dictionaryEntry || {}),
    field: fieldName,
    label: override.label || dictionaryEntry?.label || fieldName,
    description: dictionaryEntry?.description || "",
    ignore: false,
    type: override.type || dictionaryEntry?.type || "text",
    enumMappings: {
      ...(dictionaryEntry?.enumMappings || {}),
      ...(override.enumMappings || {})
    },
    priority: Number(override.priority ?? dictionaryEntry?.priority ?? 0)
  };
}

function hasFactItem(items, fieldName) {
  return items.some((item) => item.field === fieldName);
}

function addDerivedProfileFacts({
  items,
  rawRow,
  dictionaryEntries,
  allowedFields,
  ignoredFields
}) {
  for (const [targetField, definition] of Object.entries(PROFILE_DERIVED_FIELDS)) {
    if (hasFactItem(items, targetField)) {
      continue;
    }

    const sourceField = definition.sourceField;
    const sourceRawValue = rawRow[sourceField];
    if (sourceRawValue === null || sourceRawValue === undefined || isBlankString(sourceRawValue)) {
      ignoredFields.push({
        field: targetField,
        reason: "derived_source_empty",
        sourceField
      });
      continue;
    }

    if (!isFieldAllowed(targetField, allowedFields) && !isFieldAllowed(sourceField, allowedFields)) {
      ignoredFields.push({
        field: targetField,
        reason: "derived_not_allowed",
        sourceField
      });
      continue;
    }

    const sourceEntry = normalizeDictionaryEntryForField(
      sourceField,
      dictionaryEntries.get(sourceField) || null
    );
    const derivedEntry = {
      field: targetField,
      label: definition.label || targetField,
      description: `Derived from ${sourceField}.`,
      ignore: false,
      type: sourceEntry?.type || "text",
      enumMappings: sourceEntry?.enumMappings || null,
      priority: Number(definition.priority ?? sourceEntry?.priority ?? 0)
    };

    items.push(buildFactItem(targetField, sourceRawValue, derivedEntry));
  }
}

function resolveMaxBasisFields(state, maxBasisFields = null) {
  const workflowBinding = isObject(state?.scene_contract?.workflow_binding)
    ? state.scene_contract.workflow_binding
    : {};
  const overrideValue = workflowBinding?.nodeOverrides?.select_basis_fields?.maxBasisFields
    ?? workflowBinding?.node_overrides?.select_basis_fields?.maxBasisFields
    ?? null;
  const resolved = Number(maxBasisFields ?? overrideValue ?? 8);

  if (!Number.isFinite(resolved) || resolved <= 0) {
    return 8;
  }

  return Math.min(Math.floor(resolved), 8);
}

function buildProfile(items, requestOpportunityId) {
  const itemsByField = new Map(items.map((item) => [item.field, item]));
  const profile = {
    opportunityId: requestOpportunityId || null
  };

  for (const fieldName of PROFILE_FIELD_ORDER) {
    const item = itemsByField.get(fieldName);
    if (item) {
      profile[fieldName] = item.value_text;
    } else {
      profile[fieldName] = PROFILE_MISSING_VALUE;
    }
  }

  profile.highlights = items
    .slice(0, 8)
    .map((item) => item.fact_text);
  profile.available_fields = items.map((item) => item.field);
  profile.field_values = Object.fromEntries(
    items.map((item) => [item.field, item.value_text])
  );
  profile.field_labels = Object.fromEntries(
    items.map((item) => [item.field, item.label])
  );
  profile.field_details = items.map((item) => ({
    field: item.field,
    label: item.label,
    value: item.value_text,
    raw_value: item.raw_value,
    type: item.type
  }));

  for (const item of items) {
    if (profile[item.field] === undefined) {
      profile[item.field] = item.value_text;
    }
  }

  return profile;
}

function selectBasisFields(items, maxBasisFields) {
  const itemsByField = new Map(items.map((item) => [item.field, item]));
  const selected = [];

  for (const fieldName of BASIS_FIELD_ORDER) {
    if (selected.length >= maxBasisFields) {
      break;
    }

    if (itemsByField.has(fieldName)) {
      selected.push(fieldName);
    }
  }

  if (selected.length < maxBasisFields) {
    const remaining = items
      .filter((item) => !selected.includes(item.field))
      .sort((left, right) => {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        return left.field.localeCompare(right.field);
      });

    for (const item of remaining) {
      if (selected.length >= maxBasisFields) {
        break;
      }
      selected.push(item.field);
    }
  }

  return selected;
}

function summarizeOutput(items, basisFields, ignoredFields) {
  return {
    factCount: items.length,
    basisFieldCount: basisFields.length,
    ignoredFieldCount: ignoredFields.length,
    basisFields
  };
}

async function runNormalizeFactsNode({
  state,
  maxBasisFields = null
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    requireNormalizeFactsState(state);
    const dictionaryEntries = parseDictionary(state.artifacts.references.dictionary);
    const rawRow = state.artifacts.context.raw.rawRow;
    const allowedFields = resolveAllowedFields(state);
    const items = [];
    const ignoredFields = [];

    for (const [fieldName, rawValue] of Object.entries(rawRow)) {
      if (rawValue === null || rawValue === undefined || isBlankString(rawValue)) {
        ignoredFields.push({
          field: fieldName,
          reason: "empty"
        });
        continue;
      }

      if (!isFieldAllowed(fieldName, allowedFields)) {
        ignoredFields.push({
          field: fieldName,
          reason: "not_allowed"
        });
        continue;
      }

      const dictionaryEntry = normalizeDictionaryEntryForField(
        fieldName,
        dictionaryEntries.get(fieldName) || null
      );
      if (dictionaryEntry?.ignore) {
        ignoredFields.push({
          field: fieldName,
          reason: "dictionary_ignore"
        });
        continue;
      }

      items.push(buildFactItem(fieldName, rawValue, dictionaryEntry));
    }

    addDerivedProfileFacts({
      items,
      rawRow,
      dictionaryEntries,
      allowedFields,
      ignoredFields
    });

    items.sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }
      return left.field.localeCompare(right.field);
    });

    if (items.length === 0) {
      throw createAppError("FIELD_MAPPING_FAILED", "No usable facts available after normalization.", {
        stage: "normalize-facts",
        details: {
          allowedFields
        }
      });
    }

    const requestOpportunityId = state?.request?.normalized?.biz_params?.opportunityId
      || state?.request?.biz_params?.opportunityId
      || null;
    const resolvedMaxBasisFields = resolveMaxBasisFields(state, maxBasisFields);
    const basisFields = selectBasisFields(items, resolvedMaxBasisFields);
    const profile = buildProfile(items, requestOpportunityId);
    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "success",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary: summarizeOutput(items, basisFields, ignoredFields)
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        facts: {
          items,
          profile,
          basis_fields: basisFields,
          ignored_fields: ignoredFields
        },
        outputs: {
          normalize_facts: {
            normalized: true,
            fact_count: items.length,
            basis_fields: basisFields,
            ignored_field_count: ignoredFields.length
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
        stage: normalized.stage
      }
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        outputs: {
          normalize_facts: {
            normalized: false,
            error_code: normalized.code
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
  runNormalizeFactsNode
};
