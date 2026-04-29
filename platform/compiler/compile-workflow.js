const fs = require("fs");
const path = require("path");
const { getSceneConfigSourceState } = require("../../services/scene-config");
const { loadPlatformResources, resolvePlatformBaseDir } = require("./validate");
const { createAppError } = require("../../utils/errors");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeSkillVersion(version) {
  return typeof version === "string" && version.trim() ? version.trim() : "v1";
}

function buildSkillKey(name, version = "v1") {
  return `${String(name || "").trim()}@${normalizeSkillVersion(version)}`;
}

function resolveSceneConfiguredSkillRef(scene) {
  const { sceneConfigDir } = getSceneConfigSourceState();
  const filePath = path.join(sceneConfigDir, `${scene}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let document;
  try {
    document = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw createAppError("INVALID_REQUEST", `Scene config ${scene} is not valid JSON.`, {
      stage: "graph-compile",
      details: {
        scene,
        filePath,
        cause: error?.message || "json_parse_failed"
      }
    });
  }

  const name = typeof document?.skill?.id === "string" ? document.skill.id.trim() : "";
  if (!name) {
    return null;
  }

  return {
    name,
    version: normalizeSkillVersion(document?.skill?.version)
  };
}

function buildResourceIndex(resources) {
  const templatesByKey = new Map();
  const skillsByKey = new Map();
  const skillsByScene = new Map();
  const queriesByRef = new Map();
  const toolsByRef = new Map();

  for (const record of resources.templates) {
    const metadata = record?.document?.metadata || {};
    const key = `${metadata.name || ""}@${metadata.version || ""}`;
    if (metadata.name && metadata.version) {
      templatesByKey.set(key, record.document);
    }
  }

  for (const record of resources.skills) {
    const metadata = record?.document?.metadata || {};
    const scene = record?.document?.spec?.scene;
    const key = buildSkillKey(metadata.name, metadata.version);
    if (metadata.name) {
      skillsByKey.set(key, record.document);
    }
    if (scene && !skillsByScene.has(scene)) {
      skillsByScene.set(scene, record.document);
    }
  }

  for (const record of resources.queries) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      queriesByRef.set(ref, record.document);
    }
  }

  for (const record of resources.tools) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      toolsByRef.set(ref, record.document);
    }
  }

  return {
    templatesByKey,
    skillsByKey,
    skillsByScene,
    queriesByRef,
    toolsByRef
  };
}

function resolveSceneRecords(scene, _resources, resourceIndex, skillRef = null) {
  const requestedSkillRef = skillRef || resolveSceneConfiguredSkillRef(scene);
  const skillDocument = requestedSkillRef?.name
    ? resourceIndex.skillsByKey.get(buildSkillKey(requestedSkillRef.name, requestedSkillRef.version))
    : resourceIndex.skillsByScene.get(scene);
  if (!skillDocument?.spec) {
    const message = requestedSkillRef?.name
      ? `No BusinessSkill found for skillRef ${buildSkillKey(requestedSkillRef.name, requestedSkillRef.version)}.`
      : `No BusinessSkill found for scene ${scene || "unknown"}.`;
    throw createAppError("INVALID_REQUEST", message, {
      stage: "graph-compile",
      details: {
        scene,
        skillRef: requestedSkillRef || null
      }
    });
  }

  const templateRef = skillDocument.spec.templateRef || {};
  const templateKey = `${templateRef.name || ""}@${templateRef.version || ""}`;
  const templateDocument = resourceIndex.templatesByKey.get(templateKey);
  if (!templateDocument?.spec) {
    throw createAppError("INVALID_REQUEST", `No WorkflowTemplate found for templateRef ${templateKey}.`, {
      stage: "graph-compile"
    });
  }

  return {
    skillDocument,
    templateDocument
  };
}

function mergeNodeConfig(templateNode, override = {}) {
  const merged = {
    ...cloneJson(templateNode),
    enabled: override.enabled !== undefined ? Boolean(override.enabled) : templateNode.defaultEnabled !== false
  };

  for (const key of ["timeoutMs", "retry", "toolRole", "promptRef", "assetRefs", "maxBasisFields"]) {
    if (override[key] !== undefined) {
      merged[key] = cloneJson(override[key]);
    }
  }

  return merged;
}

function reorderPhaseNodes(nodes, overrideOrder = []) {
  if (!Array.isArray(overrideOrder) || overrideOrder.length === 0) {
    return nodes.slice();
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ordered = [];

  for (const nodeId of overrideOrder) {
    const node = nodeById.get(nodeId);
    if (node) {
      ordered.push(node);
      nodeById.delete(nodeId);
    }
  }

  for (const node of nodes) {
    if (nodeById.has(node.id)) {
      ordered.push(node);
      nodeById.delete(node.id);
    }
  }

  return ordered;
}

function buildOrderedNodes(templateSpec, skillSpec) {
  const phaseOrder = Array.isArray(templateSpec?.phases)
    ? templateSpec.phases.map((phase) => phase.id)
    : [];
  const nodeOverrides = isObject(skillSpec?.nodeOverrides) ? skillSpec.nodeOverrides : {};
  const nodeOrderOverrides = isObject(skillSpec?.nodeOrderOverrides) ? skillSpec.nodeOrderOverrides : {};
  const nodes = Array.isArray(templateSpec?.nodes) ? templateSpec.nodes : [];
  const nodesByPhase = new Map();

  for (const templateNode of nodes) {
    const override = isObject(nodeOverrides[templateNode.id]) ? nodeOverrides[templateNode.id] : {};
    const mergedNode = mergeNodeConfig(templateNode, override);
    if (!mergedNode.enabled && mergedNode.required !== true) {
      continue;
    }

    const phase = mergedNode.phase || "default";
    if (!nodesByPhase.has(phase)) {
      nodesByPhase.set(phase, []);
    }
    nodesByPhase.get(phase).push(mergedNode);
  }

  const ordered = [];
  for (const phaseId of phaseOrder) {
    const phaseNodes = nodesByPhase.get(phaseId) || [];
    const reordered = reorderPhaseNodes(phaseNodes, nodeOrderOverrides[phaseId] || []);
    ordered.push(...reordered);
  }

  for (const [phaseId, phaseNodes] of nodesByPhase.entries()) {
    if (!phaseOrder.includes(phaseId)) {
      ordered.push(...phaseNodes);
    }
  }

  return ordered;
}

function buildWorkflowBinding(scene, skillDocument, templateDocument, resourceIndex) {
  const skillSpec = cloneJson(skillDocument.spec);
  const templateSpec = cloneJson(templateDocument.spec);
  const queryProfileRef = skillSpec?.dataBindings?.queryProfileRef || null;
  const queryDocument = queryProfileRef ? resourceIndex.queriesByRef.get(queryProfileRef) : null;

  return {
    runtime_mode: "langgraph",
    template_ref: {
      name: templateDocument?.metadata?.name || null,
      version: templateDocument?.metadata?.version || null
    },
    skill_ref: {
      name: skillDocument?.metadata?.name || null,
      version: skillDocument?.metadata?.version || null
    },
    skillSpec,
    templateSpec,
    reference_bundle: {
      catalog: cloneJson(skillSpec?.assetRefs || {}),
      selection: cloneJson(skillSpec?.nodeOverrides?.load_reference_bundle?.assetRefs || null)
    },
    policy_profile: {
      scope: scene,
      requiredPermissions: [],
      allowedFields: ["*"]
    },
    data_profile: {
      queryProfileRef,
      queryProfile: cloneJson(queryDocument?.spec || null),
      inputMapping: cloneJson(skillSpec?.dataBindings?.inputMapping || null),
      expectedResultPath: skillSpec?.dataBindings?.expectedResultPath || null
    },
    output_contract: cloneJson(skillSpec?.outputContract || null),
    runtime_contract: cloneJson(skillSpec?.runtimeContract || null),
    input_contract: cloneJson(skillSpec?.inputContract || null),
    node_overrides: cloneJson(skillSpec?.nodeOverrides || {}),
    node_order_overrides: cloneJson(skillSpec?.nodeOrderOverrides || {})
  };
}

function buildTransitions(orderedNodes) {
  const defaultNextByNodeId = {};
  for (let index = 0; index < orderedNodes.length; index += 1) {
    defaultNextByNodeId[orderedNodes[index].id] = orderedNodes[index + 1]?.id || null;
  }
  return defaultNextByNodeId;
}

function compileWorkflowGraphForScene({
  scene,
  baseDir = null,
  resources = null,
  skillRef = null
} = {}) {
  if (!scene || typeof scene !== "string") {
    throw createAppError("INVALID_REQUEST", "compileWorkflowGraphForScene requires scene.", {
      stage: "graph-compile"
    });
  }

  const effectiveBaseDir = resolvePlatformBaseDir(baseDir);
  const effectiveResources = resources || loadPlatformResources(effectiveBaseDir);
  const resourceIndex = buildResourceIndex(effectiveResources);
  const { skillDocument, templateDocument } = resolveSceneRecords(
    scene,
    effectiveResources,
    resourceIndex,
    skillRef
  );
  const orderedNodes = buildOrderedNodes(templateDocument.spec, skillDocument.spec);
  const workflowBinding = buildWorkflowBinding(scene, skillDocument, templateDocument, resourceIndex);
  const templateNodes = Array.isArray(templateDocument?.spec?.nodes)
    ? templateDocument.spec.nodes
    : [];
  const nodeOverrides = isObject(skillDocument?.spec?.nodeOverrides)
    ? skillDocument.spec.nodeOverrides
    : {};
  const disabledNodeIds = [];
  const overrideNodeIds = [];
  const replaceableNodeIds = [];

  for (const templateNode of templateNodes) {
    const override = isObject(nodeOverrides[templateNode.id]) ? nodeOverrides[templateNode.id] : {};
    if (Object.keys(override).some((key) => override[key] !== undefined)) {
      overrideNodeIds.push(templateNode.id);
    }

    const mergedNode = mergeNodeConfig(templateNode, override);
    if (!mergedNode.enabled && mergedNode.required !== true) {
      disabledNodeIds.push(templateNode.id);
    }

    if (templateNode.replaceable) {
      replaceableNodeIds.push(templateNode.id);
    }
  }

  return {
    scene,
    template: {
      name: templateDocument?.metadata?.name || null,
      version: templateDocument?.metadata?.version || null,
      title: templateDocument?.metadata?.title || null
    },
    skill: {
      name: skillDocument?.metadata?.name || null,
      version: skillDocument?.metadata?.version || null,
      title: skillDocument?.metadata?.title || null
    },
    entryNode: templateDocument?.spec?.constraints?.entryNode || orderedNodes[0]?.id || null,
    exitNode: templateDocument?.spec?.constraints?.exitNode || orderedNodes[orderedNodes.length - 1]?.id || null,
    maxRepairLoops: Number(templateDocument?.spec?.constraints?.maxRepairLoops || 1),
    conditionalEdges: cloneJson(templateDocument?.spec?.conditionalEdges || []),
    defaultNextByNodeId: buildTransitions(orderedNodes),
    templateNodeIds: templateNodes.map((node) => node.id),
    disabledNodeIds,
    overrideNodeIds,
    replaceableNodeIds,
    orderedNodeIds: orderedNodes.map((node) => node.id),
    nodesById: Object.fromEntries(orderedNodes.map((node) => [node.id, node])),
    workflowBinding
  };
}

module.exports = {
  compileWorkflowGraphForScene
};
