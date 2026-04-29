const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { execFileSync } = require("child_process");
const { SCENE_CONFIG_DIR, getSceneConfigs } = require("../scene-config");
const { loadPlatformResources } = require("../../platform/compiler/validate");
const { createAppError } = require("../../utils/errors");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const PLATFORM_BASE_DIR = path.join(PROJECT_ROOT, "platform");

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createUnsupportedError(methodName) {
  return createAppError("INVALID_REQUEST", `${methodName} is not supported by file-store.`, {
    stage: "config-store"
  });
}

function dumpYamlDocument(document) {
  const rubyScript = [
    "require 'json'",
    "require 'yaml'",
    "data = JSON.parse(STDIN.read)",
    "text = YAML.dump(data)",
    "text = text.sub(/\\A---\\s*\\n/, '')",
    "print text"
  ].join(";");

  return execFileSync("ruby", ["-e", rubyScript], {
    input: JSON.stringify(document),
    encoding: "utf8"
  });
}

function mapDocumentKind(documentKind) {
  switch (documentKind) {
    case "WorkflowTemplate":
      return "template";
    case "BusinessSkill":
      return "skill";
    case "ToolDefinition":
      return "tool";
    case "QueryProfile":
      return "query";
    default:
      return "unknown";
  }
}

function getPlatformResourceDirectories() {
  return {
    template: path.join(PLATFORM_BASE_DIR, "templates"),
    skill: path.join(PLATFORM_BASE_DIR, "skills"),
    tool: path.join(PLATFORM_BASE_DIR, "tools"),
    query: path.join(PLATFORM_BASE_DIR, "tools")
  };
}

function buildPlatformResourceFilePath(resource) {
  if (resource.filePath) {
    return resource.filePath;
  }

  const directories = getPlatformResourceDirectories();
  const baseDirectory = directories[resource.kind];
  if (!baseDirectory) {
    throw createAppError("INVALID_REQUEST", `Unsupported platform resource kind: ${resource.kind}.`, {
      stage: "config-store"
    });
  }

  const baseName = `${resource.name}.${resource.version}`;
  switch (resource.kind) {
    case "tool":
      return path.join(baseDirectory, `${resource.name}.tool.yaml`);
    case "query":
      return path.join(baseDirectory, `${resource.name}.query.yaml`);
    default:
      return path.join(baseDirectory, `${baseName}.yaml`);
  }
}

class FileConfigStore {
  async close() {}

  async listSceneConfigs() {
    const sceneConfigs = getSceneConfigs();
    return Object.keys(sceneConfigs)
      .sort()
      .map((scene) => {
        const filePath = path.join(SCENE_CONFIG_DIR, `${scene}.json`);
        const sourceText = fs.readFileSync(filePath, "utf8");
        const document = cloneJson(sceneConfigs[scene]);

        return {
          scene,
          title: document.title || scene,
          enabled: document.enabled === true,
          executionMode: document?.execution?.mode || "agent-runtime",
          status: document.status || "draft",
          document,
          sourceText,
          filePath
        };
      });
  }

  async getSceneConfig(scene) {
    const items = await this.listSceneConfigs();
    return items.find((item) => item.scene === scene) || null;
  }

  async saveSceneConfigDraft(input) {
    const scene = String(input.scene || input.document?.scene || "").trim();
    if (!scene) {
      throw createAppError("INVALID_REQUEST", "scene is required for file-store scene config writes.", {
        stage: "config-store"
      });
    }

    const filePath = path.join(SCENE_CONFIG_DIR, `${scene}.json`);
    const document = cloneJson(input.document);
    if (!document || typeof document !== "object") {
      throw createAppError("INVALID_REQUEST", "document is required for file-store scene config writes.", {
        stage: "config-store"
      });
    }

    const sourceText = input.sourceText || `${JSON.stringify(document, null, 2)}\n`;
    await fsp.writeFile(filePath, sourceText, "utf8");
    return this.getSceneConfig(scene);
  }

  async deleteSceneConfig(scene) {
    const filePath = path.join(SCENE_CONFIG_DIR, `${scene}.json`);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    await fsp.unlink(filePath);
    return true;
  }

  async listPlatformResources(filters = {}) {
    const resources = loadPlatformResources(PLATFORM_BASE_DIR);
    const allRecords = [...resources.templates, ...resources.skills, ...resources.tools, ...resources.queries];

    return allRecords
      .map((record) => {
        const sourceText = fs.readFileSync(record.filePath, "utf8");
        const document = cloneJson(record.document);
        const metadata = document.metadata || {};
        const spec = document.spec || {};

        return {
          kind: mapDocumentKind(document.kind),
          name: metadata.name || null,
          version: metadata.version || null,
          ref: spec.ref || null,
          scene: spec.scene || null,
          status: metadata.status || "draft",
          document,
          sourceText,
          filePath: record.filePath
        };
      })
      .filter((record) => {
        if (filters.kind && record.kind !== filters.kind) {
          return false;
        }
        if (filters.scene && record.scene !== filters.scene) {
          return false;
        }
        if (filters.ref && record.ref !== filters.ref) {
          return false;
        }

        return true;
      })
      .sort((left, right) => `${left.kind}:${left.name}:${left.version}`.localeCompare(`${right.kind}:${right.name}:${right.version}`));
  }

  async getPlatformResource(identity) {
    const resources = await this.listPlatformResources();
    if (identity?.ref) {
      return resources.find((record) => record.ref === identity.ref) || null;
    }

    return resources.find(
      (record) =>
        record.kind === identity.kind &&
        record.name === identity.name &&
        record.version === identity.version
    ) || null;
  }

  async savePlatformResourceDraft(input) {
    const document = cloneJson(input.document);
    if (!document || typeof document !== "object") {
      throw createAppError("INVALID_REQUEST", "document is required for file-store platform resource writes.", {
        stage: "config-store"
      });
    }

    const metadata = document.metadata || {};
    const resource = {
      kind: input.kind || mapDocumentKind(document.kind),
      name: input.name || metadata.name,
      version: input.version || metadata.version,
      filePath: input.filePath
    };

    const filePath = buildPlatformResourceFilePath(resource);
    const sourceText = input.sourceText || dumpYamlDocument(document);
    await fsp.writeFile(filePath, sourceText, "utf8");

    return this.getPlatformResource({
      kind: resource.kind,
      name: resource.name,
      version: resource.version
    });
  }

  async deletePlatformResource(identity) {
    const existing = await this.getPlatformResource(identity);
    if (!existing?.filePath || !fs.existsSync(existing.filePath)) {
      return false;
    }

    await fsp.unlink(existing.filePath);
    return true;
  }

  async listSceneAssets() {
    throw createUnsupportedError("listSceneAssets");
  }

  async getSceneAsset() {
    throw createUnsupportedError("getSceneAsset");
  }

  async saveSceneAssetDraft() {
    throw createUnsupportedError("saveSceneAssetDraft");
  }

  async deleteSceneAsset() {
    throw createUnsupportedError("deleteSceneAsset");
  }

  async listHelperScripts() {
    throw createUnsupportedError("listHelperScripts");
  }

  async getHelperScript() {
    throw createUnsupportedError("getHelperScript");
  }

  async saveHelperScriptDraft() {
    throw createUnsupportedError("saveHelperScriptDraft");
  }

  async deleteHelperScript() {
    throw createUnsupportedError("deleteHelperScript");
  }

  async listRevisions() {
    throw createUnsupportedError("listRevisions");
  }

  async getRevisionById() {
    throw createUnsupportedError("getRevisionById");
  }

  async saveRelease() {
    throw createUnsupportedError("saveRelease");
  }

  async listReleases() {
    throw createUnsupportedError("listReleases");
  }

  async getRelease() {
    throw createUnsupportedError("getRelease");
  }

  async setReleaseEntries() {
    throw createUnsupportedError("setReleaseEntries");
  }

  async listReleaseEntries() {
    throw createUnsupportedError("listReleaseEntries");
  }

  async deleteRelease() {
    throw createUnsupportedError("deleteRelease");
  }

  async setReleasePointer() {
    throw createUnsupportedError("setReleasePointer");
  }

  async getReleasePointer() {
    throw createUnsupportedError("getReleasePointer");
  }

  async deleteReleasePointer() {
    throw createUnsupportedError("deleteReleasePointer");
  }
}

function createFileStore() {
  return new FileConfigStore();
}

module.exports = {
  FileConfigStore,
  createFileStore
};
