const fsp = require("fs/promises");
const { createAppError, normalizeError } = require("../../utils/errors");
const { getSceneConfigSourceState } = require("../../services/scene-config");
const { resolvePathReference } = require("../../utils/path-resolver");
const { mergeWorkflowState, recordNodeRun } = require("../runtime/state");

const NODE_ID = "load-assets";
const BLOCKED_PATH_WARNING_CODES = new Set(["legacy-project-path", "shared-openclaw-path"]);
const CATEGORY_DEFINITIONS = Object.freeze({
  prompts: {
    refKey: "promptRef",
    canonicalKey: "prompt",
    reader: "text"
  },
  schemas: {
    refKey: "schemaRef",
    canonicalKey: "output_schema",
    reader: "json"
  },
  dictionaries: {
    refKey: "dictionaryRef",
    canonicalKey: "dictionary",
    reader: "text"
  },
  rules: {
    refKey: "rulesRef",
    canonicalKey: "rules",
    reader: "text"
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

function getBlockedPathWarnings(warnings) {
  return Array.isArray(warnings)
    ? warnings.filter((warning) => BLOCKED_PATH_WARNING_CODES.has(warning?.code))
    : [];
}

function summarizeInput(state) {
  const references = Array.isArray(state?.scene_contract?.references)
    ? state.scene_contract.references.length
    : 0;

  return {
    scene: state?.request?.scene || null,
    hasWorkflowBinding: Boolean(state?.scene_contract?.workflow_binding),
    legacyReferenceCount: references
  };
}

function buildLegacyRef(scene, suffix) {
  return `${suffix}://${scene || "unknown-scene"}/legacy-${suffix}@legacy`;
}

function findLegacyReference(references, matchers) {
  return references.find((reference) => {
    const haystack = [
      reference?.id,
      reference?.type,
      reference?.purpose
    ]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();

    return matchers.some((matcher) => haystack.includes(matcher));
  }) || null;
}

function buildLegacyReferenceCatalog(state) {
  const scene = state?.request?.scene || null;
  const references = Array.isArray(state?.scene_contract?.references)
    ? state.scene_contract.references
    : [];
  const skillEntryFile = state?.scene_contract?.skill?.entryFile || null;

  const catalog = {
    prompts: {},
    schemas: {},
    dictionaries: {},
    rules: {}
  };

  if (skillEntryFile) {
    catalog.prompts.legacySkillEntry = {
      promptRef: buildLegacyRef(scene, "prompt"),
      source: {
        type: "legacy-skill-file",
        path: skillEntryFile
      }
    };
  }

  const dictionaryReference = findLegacyReference(references, ["dictionary", "字段"]);
  if (dictionaryReference?.path) {
    catalog.dictionaries.legacyDictionary = {
      dictionaryRef: buildLegacyRef(scene, "dictionary"),
      source: {
        type: "local-file",
        path: dictionaryReference.path
      }
    };
  }

  const rulesReference = findLegacyReference(references, ["rule", "规则"]);
  if (rulesReference?.path) {
    catalog.rules.legacyRules = {
      rulesRef: buildLegacyRef(scene, "rules"),
      source: {
        type: "local-file",
        path: rulesReference.path
      }
    };
  }

  const schemaReference = findLegacyReference(references, ["schema"]);
  if (schemaReference?.path) {
    catalog.schemas.legacyOutputSchema = {
      schemaRef: buildLegacyRef(scene, "schema"),
      source: {
        type: "local-file",
        path: schemaReference.path
      }
    };
  }

  return catalog;
}

function hasCatalogCategories(value) {
  if (!isObject(value)) {
    return false;
  }

  return Object.keys(CATEGORY_DEFINITIONS).some((categoryName) => {
    const categoryValue = value[categoryName];
    return isObject(categoryValue);
  });
}

function resolveWorkflowBinding(state) {
  return isObject(state?.scene_contract?.workflow_binding)
    ? state.scene_contract.workflow_binding
    : {};
}

function resolveCatalogSource(state, referenceBundle = null) {
  const workflowBinding = resolveWorkflowBinding(state);
  const explicitBundle = isObject(referenceBundle) ? referenceBundle : null;

  const candidates = [
    explicitBundle?.catalog,
    explicitBundle?.assetCatalog,
    workflowBinding.reference_bundle?.catalog,
    workflowBinding.referenceBundle?.catalog,
    workflowBinding.asset_catalog,
    workflowBinding.assetCatalog,
    workflowBinding.skill_spec?.assetRefs,
    workflowBinding.skillSpec?.assetRefs,
    explicitBundle
  ];

  for (const candidate of candidates) {
    if (hasCatalogCategories(candidate)) {
      return candidate;
    }
  }

  return buildLegacyReferenceCatalog(state);
}

function resolveSelectionSource(state, referenceBundle = null) {
  const workflowBinding = resolveWorkflowBinding(state);
  const explicitBundle = isObject(referenceBundle) ? referenceBundle : null;

  return (
    explicitBundle?.selection ||
    explicitBundle?.assetRefs ||
    workflowBinding.reference_bundle?.selection ||
    workflowBinding.reference_bundle?.assetRefs ||
    workflowBinding.referenceBundle?.selection ||
    workflowBinding.referenceBundle?.assetRefs ||
    workflowBinding.load_reference_bundle?.assetRefs ||
    workflowBinding.loadReferenceBundle?.assetRefs ||
    workflowBinding.node_overrides?.load_reference_bundle?.assetRefs ||
    workflowBinding.nodeOverrides?.load_reference_bundle?.assetRefs ||
    null
  );
}

function normalizeCatalogEntry(categoryName, assetKey, rawEntry) {
  if (!isObject(rawEntry)) {
    return null;
  }

  const categoryDefinition = CATEGORY_DEFINITIONS[categoryName];
  const ref = rawEntry[categoryDefinition.refKey] || rawEntry.ref || null;
  const source = isObject(rawEntry.source)
    ? rawEntry.source
    : rawEntry.path
      ? {
          type: "local-file",
          path: rawEntry.path
        }
      : null;

  if (!ref || !source?.path) {
    return null;
  }

  return {
    assetKey,
    ref,
    source
  };
}

function normalizeCatalog(catalogSource) {
  const normalized = {};

  for (const categoryName of Object.keys(CATEGORY_DEFINITIONS)) {
    const rawCategory = isObject(catalogSource) ? catalogSource[categoryName] : null;
    const entries = [];

    if (isObject(rawCategory)) {
      for (const [assetKey, rawEntry] of Object.entries(rawCategory)) {
        const entry = normalizeCatalogEntry(categoryName, assetKey, rawEntry);
        if (entry) {
          entries.push(entry);
        }
      }
    }

    normalized[categoryName] = entries;
  }

  return normalized;
}

function normalizeSelection(selectionSource, catalog) {
  const selection = {};

  for (const categoryName of Object.keys(CATEGORY_DEFINITIONS)) {
    const explicitSelection = isObject(selectionSource) ? selectionSource[categoryName] : null;
    if (Array.isArray(explicitSelection)) {
      selection[categoryName] = uniqueStrings(explicitSelection);
      continue;
    }

    selection[categoryName] = uniqueStrings(
      (catalog[categoryName] || []).map((entry) => entry.ref)
    );
  }

  return selection;
}

function ensureAssetSelection(catalog, selection) {
  const totalConfigured = Object.values(catalog).reduce((count, entries) => count + entries.length, 0);
  const totalSelected = Object.values(selection).reduce((count, refs) => count + refs.length, 0);

  if (totalConfigured === 0 || totalSelected === 0) {
    throw createAppError("INVALID_REQUEST", "load-assets requires at least one configured asset reference.", {
      stage: "load-assets"
    });
  }
}

function summarizeLoadedValue(categoryName, value) {
  if (categoryName === "schemas") {
    return {
      topLevelKeys: isObject(value) ? Object.keys(value).length : 0
    };
  }

  const content = typeof value === "string" ? value : "";
  return {
    lineCount: content ? content.split(/\r?\n/).length : 0,
    charCount: content.length
  };
}

async function readAssetFile(entry, categoryName) {
  const categoryDefinition = CATEGORY_DEFINITIONS[categoryName];
  const sourceType = entry.source?.type || "local-file";
  const filePath = entry.source?.path;

  if (!filePath) {
    throw createAppError("INVALID_REQUEST", `Asset ${entry.ref} is missing source.path.`, {
      stage: "load-assets",
      details: {
        assetRef: entry.ref,
        assetType: categoryName
      }
    });
  }

  if (!["local-file", "legacy-skill-file"].includes(sourceType)) {
    throw createAppError("INVALID_REQUEST", `Asset ${entry.ref} uses unsupported source type ${sourceType}.`, {
      stage: "load-assets",
      details: {
        assetRef: entry.ref,
        assetType: categoryName,
        sourceType
      }
    });
  }

  const pathState = getSceneConfigSourceState();
  let resolution;
  try {
    resolution = resolvePathReference(filePath, {
      projectRoot: pathState.projectRoot,
      runtimeRoot: pathState.runtimeRoot
    });
  } catch (error) {
    throw createAppError("INVALID_REQUEST", `Asset ${entry.ref} path resolution failed.`, {
      stage: "load-assets",
      details: {
        assetRef: entry.ref,
        assetType: categoryName,
        filePath,
        cause: error?.message || "resolve_failed"
      }
    });
  }

  const blockedWarnings = getBlockedPathWarnings(resolution.warnings);
  if (blockedWarnings.length > 0) {
    throw createAppError("INVALID_REQUEST", `Legacy runtime path is not allowed for asset ${entry.ref}.`, {
      stage: "load-assets",
      details: {
        assetRef: entry.ref,
        assetType: categoryName,
        filePath,
        blockedWarnings
      }
    });
  }

  let rawContent;
  try {
    rawContent = await fsp.readFile(resolution.resolvedPath, "utf8");
  } catch (error) {
    throw createAppError("ASSET_LOAD_FAILED", `Failed to read asset ${entry.ref}.`, {
      stage: "load-assets",
      details: {
        assetRef: entry.ref,
        assetType: categoryName,
        filePath: resolution.resolvedPath,
        filePathRef: resolution.original,
        cause: error?.message || "read_failed"
      }
    });
  }

  if (categoryDefinition.reader === "json") {
    try {
      return {
        value: JSON.parse(rawContent),
        resolvedPath: resolution.resolvedPath,
        pathRef: resolution.original,
        pathSourceType: resolution.sourceType
      };
    } catch (error) {
      throw createAppError("ASSET_LOAD_FAILED", `Asset ${entry.ref} does not contain valid JSON.`, {
        stage: "load-assets",
        details: {
          assetRef: entry.ref,
          assetType: categoryName,
          filePath: resolution.resolvedPath,
          filePathRef: resolution.original,
          cause: error?.message || "json_parse_failed"
        }
      });
    }
  }

  return {
    value: rawContent,
    resolvedPath: resolution.resolvedPath,
    pathRef: resolution.original,
    pathSourceType: resolution.sourceType
  };
}

async function loadCategoryEntries(categoryName, refs, catalogEntries) {
  const loadedEntries = [];

  for (const ref of refs) {
    const catalogEntry = catalogEntries.find((entry) => entry.ref === ref);
    if (!catalogEntry) {
      throw createAppError("INVALID_REQUEST", `Unknown ${categoryName} asset ref: ${ref}.`, {
        stage: "load-assets",
        details: {
          assetRef: ref,
          assetType: categoryName
        }
      });
    }

    const loadedAsset = await readAssetFile(catalogEntry, categoryName);
    loadedEntries.push({
      ref,
      asset_key: catalogEntry.assetKey,
      source_type: catalogEntry.source?.type || "local-file",
      path: loadedAsset.resolvedPath,
      path_ref: loadedAsset.pathRef,
      path_source_type: loadedAsset.pathSourceType,
      value: loadedAsset.value,
      summary: summarizeLoadedValue(categoryName, loadedAsset.value)
    });
  }

  return loadedEntries;
}

function buildArtifactsPatch(loadedEntriesByCategory) {
  const references = {};
  const referenceMeta = {};
  const outputSummary = {
    loaded: true,
    asset_count: 0,
    categories: {}
  };

  for (const [categoryName, entries] of Object.entries(loadedEntriesByCategory)) {
    const categoryDefinition = CATEGORY_DEFINITIONS[categoryName];
    const canonicalKey = categoryDefinition.canonicalKey;
    const firstEntry = entries[0] || null;

    if (firstEntry) {
      references[canonicalKey] = firstEntry.value;
      referenceMeta[canonicalKey] = {
        ref: firstEntry.ref,
        asset_key: firstEntry.asset_key,
        source_type: firstEntry.source_type,
        path: firstEntry.path,
        path_ref: firstEntry.path_ref,
        path_source_type: firstEntry.path_source_type,
        summary: firstEntry.summary
      };
      outputSummary.asset_count += entries.length;
    }

    outputSummary.categories[categoryName] = entries.map((entry) => ({
      ref: entry.ref,
      asset_key: entry.asset_key,
      source_type: entry.source_type,
      path: entry.path,
      path_ref: entry.path_ref,
      path_source_type: entry.path_source_type
    }));
  }

  return {
    references,
    referenceMeta,
    outputSummary
  };
}

async function runLoadAssetsNode({
  state,
  referenceBundle = null
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    if (!isObject(state)) {
      throw createAppError("INVALID_REQUEST", "load-assets requires workflow state.", {
        stage: "load-assets"
      });
    }

    const catalogSource = resolveCatalogSource(state, referenceBundle);
    const catalog = normalizeCatalog(catalogSource);
    const selectionSource = resolveSelectionSource(state, referenceBundle);
    const selection = normalizeSelection(selectionSource, catalog);

    ensureAssetSelection(catalog, selection);

    const loadedEntriesByCategory = {};
    for (const categoryName of Object.keys(CATEGORY_DEFINITIONS)) {
      loadedEntriesByCategory[categoryName] = await loadCategoryEntries(
        categoryName,
        selection[categoryName],
        catalog[categoryName]
      );
    }

    const { references, referenceMeta, outputSummary } = buildArtifactsPatch(loadedEntriesByCategory);
    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "success",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        references,
        reference_meta: referenceMeta,
        outputs: {
          load_assets: outputSummary
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
          load_assets: {
            loaded: false,
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
  runLoadAssetsNode
};
