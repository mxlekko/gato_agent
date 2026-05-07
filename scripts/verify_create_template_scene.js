#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const { createBundleRenderer } = require("../services/bundle-renderer");
const { createReleaseValidator } = require("../services/release-validator");
const {
  createTemplateSceneDraft,
  validateTemplateSceneDraftInput
} = require("../services/scene-draft-generator");
const { getSceneTemplateSummaries } = require("../services/scene-template-catalog");
const { loadPlatformResources } = require("../platform/compiler/validate");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PLATFORM_BASE_DIR = path.join(PROJECT_ROOT, "platform");
const SCENE_CONFIG_DIR = path.join(PROJECT_ROOT, "scene-configs");
const VERIFY_ROOT = path.join(PROJECT_ROOT, ".tmp", `template-scene-verify-${Date.now()}`);
const RELEASE_ID = "rel_template_scene_verify";
const ENVIRONMENT = "local";

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function shortHash(value) {
  return sha256(value).slice(0, 12);
}

function sanitizeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "entry";
}

function buildEntryRelativePath(entryType, entryKey) {
  return path.join("entries", entryType, `${sanitizeSegment(entryKey)}-${shortHash(entryKey)}.json`);
}

function countEntriesByType(entries) {
  return entries.reduce((result, entry) => {
    result[entry.entryType] = (result[entry.entryType] || 0) + 1;
    return result;
  }, {});
}

function buildManifest(entries, bundlePath) {
  const items = entries.map((entry) => ({
    entry_type: entry.entryType,
    entry_key: entry.entryKey,
    target_id: entry.targetId,
    revision_id: entry.revisionId,
    checksum: entry.checksum,
    path: entry.relativePath
  }));
  const aggregateSource = items.map((item) => ({
    entry_type: item.entry_type,
    entry_key: item.entry_key,
    revision_id: item.revision_id,
    checksum: item.checksum
  }));

  return {
    release_id: RELEASE_ID,
    environment: ENVIRONMENT,
    scope_type: "all",
    scope_value: "*",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "verify_create_template_scene",
    publish_note: "verify template scene creation",
    renderer_version: "bundle-renderer/v1",
    entries: {
      total: items.length,
      by_type: countEntriesByType(entries),
      items
    },
    checksums: {
      aggregate: shortHash(JSON.stringify(aggregateSource)),
      entries: Object.fromEntries(entries.map((entry) => [`${entry.entryType}:${entry.entryKey}`, entry.checksum]))
    },
    collection_strategy: {
      scene_configs: "all",
      scene_assets: "all",
      helper_scripts: "all",
      platform_resources: "all"
    },
    bundle_path: bundlePath
  };
}

function getPlatformKind(document) {
  switch (document?.kind) {
    case "WorkflowTemplate":
      return "template";
    case "BusinessSkill":
      return "skill";
    case "ToolDefinition":
      return "tool";
    case "QueryProfile":
      return "query";
    default:
      throw new Error(`Unsupported platform resource kind: ${document?.kind || "unknown"}`);
  }
}

function formatJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function makeEntryFactory() {
  let targetId = 1;
  let revisionId = 1001;

  return function makeEntry(entryType, entryKey, snapshotJson, snapshotText) {
    const checksum = sha256(snapshotText);
    const entry = {
      entryType,
      entryKey,
      targetId: targetId++,
      revisionId: revisionId++,
      snapshotText,
      snapshotJson,
      checksum
    };
    entry.relativePath = buildEntryRelativePath(entry.entryType, entry.entryKey);
    return entry;
  };
}

function buildPlatformRecord(document, sourceText = null, scene = null) {
  const metadata = document.metadata || {};
  const spec = document.spec || {};
  const kind = getPlatformKind(document);
  return {
    kind,
    name: metadata.name,
    version: metadata.version || "v1",
    ref: spec.ref || null,
    scene: scene || spec.scene || null,
    status: metadata.status || "draft",
    document: cloneJson(document),
    sourceText: sourceText || ""
  };
}

async function readRepositorySceneConfigs() {
  const fileNames = (await fs.readdir(SCENE_CONFIG_DIR))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
  const records = [];

  for (const fileName of fileNames) {
    const filePath = path.join(SCENE_CONFIG_DIR, fileName);
    const sourceText = await fs.readFile(filePath, "utf8");
    const document = JSON.parse(sourceText);
    records.push({
      scene: document.scene,
      title: document.title || document.scene,
      enabled: document.enabled === true,
      executionMode: document.execution?.mode || "agent-runtime",
      status: document.status || "draft",
      document,
      sourceText
    });
  }

  return records;
}

function addEntry(entryMap, entry) {
  entryMap.set(`${entry.entryType}:${entry.entryKey}`, entry);
}

async function buildReleaseEntries(drafts) {
  const makeEntry = makeEntryFactory();
  const entriesByKey = new Map();
  const repositoryResources = loadPlatformResources(PLATFORM_BASE_DIR);
  const repositorySceneConfigs = await readRepositorySceneConfigs();

  for (const record of repositorySceneConfigs) {
    addEntry(entriesByKey, makeEntry("scene-config", record.scene, {
      scene: record.scene,
      title: record.title,
      enabled: record.enabled,
      executionMode: record.executionMode,
      status: record.status,
      document: cloneJson(record.document)
    }, record.sourceText));
  }

  for (const record of [
    ...repositoryResources.templates,
    ...repositoryResources.tools,
    ...repositoryResources.queries,
    ...repositoryResources.skills
  ]) {
    const platformRecord = buildPlatformRecord(record.document);
    addEntry(entriesByKey, makeEntry("platform-resource", `${platformRecord.kind}:${platformRecord.name}@${platformRecord.version}`, {
      kind: platformRecord.kind,
      name: platformRecord.name,
      version: platformRecord.version,
      ref: platformRecord.ref,
      scene: platformRecord.scene,
      status: platformRecord.status,
      document: cloneJson(platformRecord.document)
    }, platformRecord.sourceText));
  }

  for (const draft of drafts) {
    const sceneConfig = draft.draftPackage.sceneConfig;
    addEntry(entriesByKey, makeEntry("scene-config", sceneConfig.scene, {
      scene: sceneConfig.scene,
      title: sceneConfig.title,
      enabled: sceneConfig.enabled,
      executionMode: sceneConfig.executionMode,
      status: sceneConfig.status,
      document: cloneJson(sceneConfig.document)
    }, sceneConfig.sourceText));

    for (const resource of draft.draftPackage.platformResources) {
      addEntry(entriesByKey, makeEntry("platform-resource", `${resource.kind}:${resource.name}@${resource.version}`, {
        kind: resource.kind,
        name: resource.name,
        version: resource.version,
        ref: resource.document?.spec?.ref || null,
        scene: resource.scene || resource.document?.spec?.scene || null,
        status: resource.status,
        document: cloneJson(resource.document)
      }, resource.sourceText));
    }

    for (const asset of draft.draftPackage.sceneAssets) {
      addEntry(entriesByKey, makeEntry("scene-asset", `${asset.scene}:${asset.assetType}`, {
        scene: asset.scene,
        assetType: asset.assetType,
        ref: asset.ref,
        contentFormat: asset.contentFormat,
        status: asset.status,
        document: cloneJson(asset.document)
      }, asset.contentText));
    }
  }

  return Array.from(entriesByKey.values()).sort((left, right) => {
    const typeDelta = left.entryType.localeCompare(right.entryType);
    return typeDelta || left.entryKey.localeCompare(right.entryKey);
  });
}

function buildPureTextDraftInput() {
  return {
    scene: "verify-template-text-scene",
    title: "Verify Template Text Scene",
    description: "Verify prompt structured extraction scene creation.",
    templateRef: {
      name: "payment-info-split",
      version: "v1"
    },
    inputContract: {
      required: ["rawText"],
      fields: {
        rawText: {
          type: "string",
          sourcePath: "request.bizParams.rawText"
        }
      }
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: {
        summary: {
          type: "string"
        }
      }
    }
  };
}

function buildQueryDraftInput() {
  return {
    scene: "verify-template-query-scene",
    title: "Verify Template Query Scene",
    description: "Verify query enhanced template scene creation.",
    templateRef: {
      name: "sales-opportunity-advisor",
      version: "v1"
    },
    inputContract: {
      required: ["customerId"],
      fields: {
        customerId: {
          type: "string",
          sourcePath: "request.bizParams.customerId"
        }
      }
    },
    outputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        summary: {
          type: "string"
        }
      }
    },
    queryProfile: {
      enabled: true,
      name: "verify-template-query-by-customer-id",
      title: "Verify Template Query By Customer ID",
      primaryEntity: {
        table: "t_customer_order",
        idField: "customerId"
      },
      where: [
        {
          field: "customerId",
          operator: "equals",
          param: "customerId"
        }
      ],
      resultPolicy: {
        mode: "multi-rows",
        fields: ["*"],
        limit: 20
      }
    }
  };
}

function buildRagDraftInput() {
  return {
    scene: "verify-template-rag-scene",
    title: "Verify Template RAG Scene",
    description: "Verify RAG scene template creation.",
    templateRef: {
      name: "special-custom-product-solution",
      version: "v1"
    },
    inputContract: {
      required: ["specialCustomOrderNo", "customRequirement"],
      fields: {
        specialCustomOrderNo: {
          type: "string",
          sourcePath: "request.bizParams.specialCustomOrderNo"
        },
        customRequirement: {
          type: "string",
          sourcePath: "request.bizParams.customRequirement"
        }
      }
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["productSolution"],
      properties: {
        productSolution: {
          type: "string"
        }
      }
    },
    ragConfig: {
      topK: 3,
      query: "customRequirement",
      failOnError: true
    }
  };
}

async function expectFailure(label, callback, expectedPattern) {
  try {
    await callback();
  } catch (error) {
    if (!expectedPattern || expectedPattern.test(error.message || "")) {
      return {
        label,
        message: error.message
      };
    }

    throw new Error(`${label} failed with unexpected message: ${error.message}`);
  }

  throw new Error(`${label} did not fail as expected.`);
}

async function verifyErrorHandling() {
  const fakeStore = {
    listSceneConfigs: async () => [{ scene: "verify-template-text-scene" }],
    listPlatformResources: async () => [],
    close: async () => {}
  };
  const queryInput = buildQueryDraftInput();

  const failures = [];
  failures.push(await expectFailure(
    "duplicate sceneId",
    () => validateTemplateSceneDraftInput(buildPureTextDraftInput(), { store: fakeStore }),
    /已存在/u
  ));
  failures.push(await expectFailure(
    "template missing",
    () => createTemplateSceneDraft({
      ...buildPureTextDraftInput(),
      scene: "verify-template-missing-template",
      templateRef: { name: "missing-template", version: "v1" }
    }, { skipUniqueness: true }),
    /不存在/u
  ));
  failures.push(await expectFailure(
    "query missing limit",
    () => createTemplateSceneDraft({
      ...queryInput,
      scene: "verify-template-query-missing-limit",
      queryProfile: {
        ...queryInput.queryProfile,
        name: "verify-template-query-missing-limit",
        resultPolicy: {
          mode: "multi-rows",
          fields: ["*"]
        }
      }
    }, { skipUniqueness: true }),
    /必须填写 Limit/u
  ));
  failures.push(await expectFailure(
    "query illegal where",
    () => createTemplateSceneDraft({
      ...queryInput,
      scene: "verify-template-query-illegal-where",
      queryProfile: {
        ...queryInput.queryProfile,
        name: "verify-template-query-illegal-where",
        where: [
          {
            field: "customerId",
            operator: "equals",
            param: "customerId",
            rawSql: "1=1"
          }
        ]
      }
    }, { skipUniqueness: true }),
    /禁止字段/u
  ));

  return failures;
}

function resetModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

async function verifyUnpublishedWorkflow(draft) {
  const repositoryResources = loadPlatformResources(PLATFORM_BASE_DIR);
  const platformRecords = [
    ...repositoryResources.templates,
    ...repositoryResources.tools,
    ...repositoryResources.queries,
    ...repositoryResources.skills
  ].map((record) => buildPlatformRecord(record.document));

  for (const resource of draft.draftPackage.platformResources) {
    platformRecords.push(buildPlatformRecord(resource.document, resource.sourceText, resource.scene));
  }

  const fakeStore = {
    getSceneConfig: async (scene) => {
      if (scene !== draft.scene) {
        return null;
      }

      return {
        id: 9001,
        scene: draft.scene,
        title: draft.title,
        enabled: 1,
        executionMode: "agent-runtime",
        status: "draft",
        document: cloneJson(draft.draftPackage.sceneConfig.document),
        sourceText: draft.draftPackage.sceneConfig.sourceText,
        currentRevisionId: 9002,
        updatedBy: "verify",
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      };
    },
    listPlatformResources: async () => platformRecords.map((record, index) => ({
      id: 9100 + index,
      kind: record.kind,
      name: record.name,
      version: record.version,
      ref: record.ref,
      scene: record.scene,
      status: record.status,
      document: cloneJson(record.document),
      sourceText: record.sourceText,
      currentRevisionId: 9200 + index,
      updatedBy: "verify",
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    })),
    close: async () => {}
  };

  const configStorePath = require.resolve("../services/config-store");
  const consoleScenesPath = require.resolve("../services/console-scenes");
  const originalConfigStore = require.cache[configStorePath];

  require.cache[configStorePath] = {
    id: configStorePath,
    filename: configStorePath,
    loaded: true,
    exports: {
      createConfigStore: () => fakeStore
    }
  };
  delete require.cache[consoleScenesPath];

  try {
    const { getConsoleSceneWorkflow } = require("../services/console-scenes");
    const workflow = await getConsoleSceneWorkflow(draft.scene);
    if (workflow?.configState?.publishState !== "unpublished") {
      throw new Error("Unpublished workflow did not report publishState=unpublished.");
    }
    if (workflow?.configState?.published !== null) {
      throw new Error("Unpublished workflow should not expose a published snapshot.");
    }
    return {
      scene: workflow.scene,
      publishState: workflow.configState.publishState,
      hasPublishedSnapshot: workflow.configState.hasPublishedSnapshot
    };
  } finally {
    if (originalConfigStore) {
      require.cache[configStorePath] = originalConfigStore;
    } else {
      delete require.cache[configStorePath];
    }
    delete require.cache[consoleScenesPath];
  }
}

async function main() {
  await fs.rm(VERIFY_ROOT, { recursive: true, force: true });
  await fs.mkdir(VERIFY_ROOT, { recursive: true });

  const sceneTemplates = getSceneTemplateSummaries();
  const sceneTemplateNames = sceneTemplates.map((template) => template.name).sort();
  for (const requiredTemplate of [
    "payment-info-split",
    "sales-opportunity-advisor",
    "sales-opportunity-advisor-directdb",
    "sales-opportunity-smart-entry",
    "special-custom-product-solution"
  ]) {
    if (!sceneTemplateNames.includes(requiredTemplate)) {
      throw new Error(`Scene template catalog is missing ${requiredTemplate}.`);
    }
  }

  const pureDraft = await createTemplateSceneDraft(buildPureTextDraftInput(), { skipUniqueness: true });
  const queryDraft = await createTemplateSceneDraft(buildQueryDraftInput(), { skipUniqueness: true });
  const ragDraft = await createTemplateSceneDraft(buildRagDraftInput(), { skipUniqueness: true });
  const queryAssetTypes = queryDraft.draftPackage.sceneAssets.map((asset) => asset.assetType).sort();
  const ragRetrieveOverride = ragDraft.draftPackage.platformResources[0]?.document?.spec?.nodeOverrides?.retrieve_knowledge_context;
  for (const expectedAssetType of ["dictionary", "prompt", "rules", "schema"]) {
    if (!queryAssetTypes.includes(expectedAssetType)) {
      throw new Error(`Query scene draft is missing ${expectedAssetType} asset.`);
    }
  }
  if (ragRetrieveOverride?.topK !== 3 || ragRetrieveOverride?.query !== "customRequirement") {
    throw new Error("RAG scene draft did not keep configured RAG strategy.");
  }
  const unpublishedWorkflow = await verifyUnpublishedWorkflow(pureDraft);
  const unpublishedQueryWorkflow = await verifyUnpublishedWorkflow(queryDraft);
  const errorHandling = await verifyErrorHandling();
  const entries = await buildReleaseEntries([pureDraft, queryDraft, ragDraft]);
  const bundlePath = path.join(VERIFY_ROOT, ENVIRONMENT, RELEASE_ID);
  const release = {
    releaseId: RELEASE_ID,
    environment: ENVIRONMENT,
    scopeType: "all",
    scopeValue: "*",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "verify_create_template_scene",
    publishNote: "verify template scene creation",
    bundlePath
  };
  release.manifest = buildManifest(entries, bundlePath);

  const renderer = createBundleRenderer({ projectRoot: PROJECT_ROOT });
  await renderer.renderBundle({ release, entries });
  await renderer.validateBundle({ release, entries });

  const validator = createReleaseValidator({ projectRoot: PROJECT_ROOT });
  const validation = await validator.assertValid({ release, entries });

  const currentPath = path.join(VERIFY_ROOT, ENVIRONMENT, "current");
  await fs.rm(currentPath, { recursive: true, force: true });
  await fs.symlink(RELEASE_ID, currentPath, "dir");

  process.env.CONFIG_BUNDLE_ROOT = VERIFY_ROOT;
  process.env.CONFIG_ACTIVE_ENV = ENVIRONMENT;
  process.env.CONFIG_CURRENT_BUNDLE = currentPath;
  process.env.CONFIG_SCENE_CONFIG_DIR = path.join(currentPath, "scene-configs");
  process.env.CONFIG_PLATFORM_DIR = path.join(currentPath, "platform");

  const sceneConfig = resetModule("../services/scene-config");
  const supportedScenes = sceneConfig.getSupportedScenes();
  for (const expectedScene of [pureDraft.scene, queryDraft.scene, ragDraft.scene]) {
    if (!supportedScenes.includes(expectedScene)) {
      throw new Error(`Active bundle does not include scene ${expectedScene}.`);
    }
  }

  const agentRoutes = resetModule("../routes/agent");
  agentRoutes.validateAgentRunRequest({
    scene: pureDraft.scene,
    bizParams: {
      rawText: "payment account text"
    }
  });
  agentRoutes.validateAgentRunRequest({
    scene: queryDraft.scene,
    bizParams: {
      customerId: "C001"
    }
  });
  agentRoutes.validateAgentRunRequest({
    scene: ragDraft.scene,
    bizParams: {
      specialCustomOrderNo: "SC001",
      customRequirement: "custom requirement"
    }
  });

  resetModule("../platform/compiler/validate");
  const queryRunner = resetModule("../services/generic-query-runner");
  const queryProfileRef = queryDraft.queryProfile.ref;
  const queryProfileDocument = queryRunner.loadQueryProfile(queryProfileRef);
  if (queryProfileDocument.spec.toolRef !== "tool://data/generic-query-runner@v1") {
    throw new Error(`Generated QueryProfile uses unexpected toolRef ${queryProfileDocument.spec.toolRef}.`);
  }

  process.stdout.write(`${JSON.stringify({
    verificationRoot: VERIFY_ROOT,
    releaseId: RELEASE_ID,
    sceneTemplates: sceneTemplateNames,
    scenes: [pureDraft.scene, queryDraft.scene, ragDraft.scene],
    draftAssets: {
      queryScene: queryAssetTypes,
      ragStrategy: {
        topK: ragRetrieveOverride.topK,
        query: ragRetrieveOverride.query,
        failOnError: ragRetrieveOverride.failOnError
      }
    },
    unpublishedWorkflow,
    unpublishedQueryWorkflow,
    releaseValidation: {
      valid: validation.valid,
      sceneConfigs: validation.sceneConfigs,
      platformResources: validation.platformResources,
      compilePreview: validation.compilePreview
    },
    activeRuntime: {
      supportedScenes: [pureDraft.scene, queryDraft.scene, ragDraft.scene],
      agentRequestValidation: "passed",
      queryProfileRef
    },
    errorHandling
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
