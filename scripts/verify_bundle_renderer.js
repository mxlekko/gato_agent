require("../utils/load-env").loadProjectEnv();

const fs = require("fs/promises");
const path = require("path");

const { loadPlatformResources } = require("../platform/compiler/validate");
const { createConfigStore } = require("../services/config-store");
const { createReleaseManager } = require("../services/release-manager");
const { PROJECT_ROOT } = require("../utils/path-resolver");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function ensureFile(filePath) {
  if (!(await exists(filePath))) {
    throw new Error(`Expected bundle file is missing: ${filePath}`);
  }
}

function summarizePlatformResourceRecords(records) {
  return {
    templates: records.filter((item) => item.kind === "template").length,
    skills: records.filter((item) => item.kind === "skill").length,
    tools: records.filter((item) => item.kind === "tool").length,
    queries: records.filter((item) => item.kind === "query").length
  };
}

async function main() {
  const verificationRoot = path.join(PROJECT_ROOT, ".tmp", `bundle-renderer-verify-${Date.now()}`);
  const manager = createReleaseManager({
    bundleRoot: verificationRoot,
    activeEnv: "local"
  });
  const store = createConfigStore({ driver: "mysql" });
  let createdReleaseId = null;

  try {
    const created = await manager.createRelease({
      environment: "local",
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t3-02",
      publishNote: "bundle renderer verification"
    });
    const bundleDir = created.release.bundlePath;
    createdReleaseId = created.release.releaseId;

    const requiredFiles = [
      "manifest.json",
      path.join("scene-configs", "sales-opportunity-advisor.json"),
      path.join("scene-configs", "payment-info-split.json"),
	      path.join("platform", "skills", "sales-opportunity-advisor.v1.yaml"),
	      path.join("platform", "skills", "payment-info-split.v1.yaml"),
	      path.join("platform", "tools", "sales-opportunity-by-opportunity-id.query.yaml"),
      path.join("platform", "assets", "prompts", "sales-opportunity-advisor.draft-business-output.v1.md"),
      path.join("references", "sales-opportunity-advisor", "skill_contract.md"),
      path.join("references", "sales-opportunity-advisor", "output_schema.json"),
      path.join("references", "sales-opportunity-advisor", "decision_rules.md"),
      path.join("runtime-assets", "project-runtime", "workspace", "skills", "sales-opportunity-advisor", "SKILL.md"),
      path.join("runtime-assets", "project-runtime", "workspace", "skills", "sales-opportunity-advisor", "references", "decision_rules.md"),
      path.join("runtime-assets", "model-profiles", "payment-fast-agent", "models.json"),
      path.join("ContextHelper", "generated-queries", "sales-opportunity-advisor.generated.js"),
	      path.join("metadata", "sales_opportunity_dictionary.tsv"),
	      path.join("references", "payment-info-split", "prompt.md"),
	      path.join("references", "payment-info-split", "output_schema.json"),
	      path.join("DirectDbRunner", "sql-cache", "sales-opportunity-advisor-directdb.sql.json")
    ];

    for (const relativePath of requiredFiles) {
      await ensureFile(path.join(bundleDir, relativePath));
    }

    const sceneConfig = JSON.parse(
      await fs.readFile(path.join(bundleDir, "scene-configs", "sales-opportunity-advisor.json"), "utf8")
    );
    if (sceneConfig.scene !== "sales-opportunity-advisor") {
      throw new Error(`Unexpected scene config payload: ${sceneConfig.scene || "missing"}`);
    }

	    const paymentInfoSceneConfig = JSON.parse(
	      await fs.readFile(path.join(bundleDir, "scene-configs", "payment-info-split.json"), "utf8")
	    );
	    if (paymentInfoSceneConfig.execution?.mode !== "agent-runtime") {
	      throw new Error(`Unexpected payment execution mode: ${paymentInfoSceneConfig.execution?.mode || "missing"}`);
	    }
	    if (paymentInfoSceneConfig.skill?.entryFile !== "project://references/payment-info-split/skill_contract.md") {
	      throw new Error(`Unexpected payment skill.entryFile: ${paymentInfoSceneConfig.skill?.entryFile || "missing"}`);
	    }

    const platformResources = loadPlatformResources(path.join(bundleDir, "platform"));
    const resourceSummary = {
      templates: platformResources.templates.length,
      skills: platformResources.skills.length,
      tools: platformResources.tools.length,
      queries: platformResources.queries.length
    };
    const expectedResourceSummary = summarizePlatformResourceRecords(
      await store.listPlatformResources({ status: "draft" })
    );

    if (JSON.stringify(resourceSummary) !== JSON.stringify(expectedResourceSummary)) {
      throw new Error(
        `Unexpected platform resource counts: ${JSON.stringify({
          actual: resourceSummary,
          expected: expectedResourceSummary
        })}`
      );
    }

	    const advisorSkill = platformResources.skills.find(
	      (item) => item?.document?.metadata?.name === "sales-opportunity-advisor"
	    )?.document;
	    if (!advisorSkill) {
	      throw new Error("Rendered bundle is missing BusinessSkill sales-opportunity-advisor.");
	    }
	    const paymentSkill = platformResources.skills.find(
	      (item) => item?.document?.metadata?.name === "payment-info-split"
	    )?.document;
	    if (!paymentSkill) {
	      throw new Error("Rendered bundle is missing BusinessSkill payment-info-split.");
	    }

    const advisorPromptPath = advisorSkill.spec?.assetRefs?.prompts?.draftBusinessOutput?.source?.path;
    const advisorSchemaPath = advisorSkill.spec?.assetRefs?.schemas?.output?.source?.path;
    const advisorDictionaryPath = advisorSkill.spec?.assetRefs?.dictionaries?.salesOpportunityFields?.source?.path;
    if (advisorPromptPath !== "project://platform/assets/prompts/sales-opportunity-advisor.draft-business-output.v1.md") {
      throw new Error(`Unexpected prompt source.path: ${advisorPromptPath || "missing"}`);
    }
    if (advisorSchemaPath !== "project://references/sales-opportunity-advisor/output_schema.json") {
      throw new Error(`Unexpected schema source.path: ${advisorSchemaPath || "missing"}`);
    }
	    if (advisorDictionaryPath !== "project://metadata/sales_opportunity_dictionary.tsv") {
	      throw new Error(`Unexpected dictionary source.path: ${advisorDictionaryPath || "missing"}`);
	    }
	    const paymentPromptPath = paymentSkill.spec?.assetRefs?.prompts?.draftBusinessOutput?.source?.path;
	    if (paymentPromptPath !== "project://references/payment-info-split/prompt.md") {
	      throw new Error(`Unexpected payment prompt source.path: ${paymentPromptPath || "missing"}`);
	    }

    const advisorQuery = platformResources.queries.find(
      (item) => item?.document?.metadata?.name === "sales-opportunity-by-opportunity-id"
    )?.document;
    if (!advisorQuery) {
      throw new Error("Rendered bundle is missing QueryProfile sales-opportunity-by-opportunity-id.");
    }

    const helperScriptPath = advisorQuery.spec?.migrationSource?.helperScriptPath;
    const helperManifestPath = advisorQuery.spec?.migrationSource?.helperManifestPath;
    const querySkillPath = advisorQuery.spec?.migrationSource?.skillPath;
    if (helperScriptPath !== "project://ContextHelper/generated-queries/sales-opportunity-advisor.generated.js") {
      throw new Error(`Unexpected helperScriptPath: ${helperScriptPath || "missing"}`);
    }
    if (helperManifestPath !== "project://ContextHelper/generated-queries/manifest.json") {
      throw new Error(`Unexpected helperManifestPath: ${helperManifestPath || "missing"}`);
    }
    if (querySkillPath !== "project://references/sales-opportunity-advisor/skill_contract.md") {
      throw new Error(`Unexpected migrationSource.skillPath: ${querySkillPath || "missing"}`);
    }

    const promptAsset = await store.getSceneAsset("sales-opportunity-advisor", "prompt");
    const rulesAsset = await store.getSceneAsset("sales-opportunity-advisor", "rules");
    const helperScript = await store.getHelperScript("sales-opportunity-advisor", "generated-query");
    const directDbCache = JSON.parse(
      await fs.readFile(path.join(bundleDir, "DirectDbRunner", "sql-cache", "sales-opportunity-advisor-directdb.sql.json"), "utf8")
    );

    const bundlePromptText = await fs.readFile(
      path.join(bundleDir, "platform", "assets", "prompts", "sales-opportunity-advisor.draft-business-output.v1.md"),
      "utf8"
    );
    const bundleRulesText = await fs.readFile(
      path.join(bundleDir, "references", "sales-opportunity-advisor", "decision_rules.md"),
      "utf8"
    );
    const bundleHelperScriptText = await fs.readFile(
      path.join(bundleDir, "ContextHelper", "generated-queries", "sales-opportunity-advisor.generated.js"),
      "utf8"
    );
    const helperManifest = JSON.parse(
      await fs.readFile(path.join(bundleDir, "ContextHelper", "generated-queries", "manifest.json"), "utf8")
    );

    if (bundlePromptText !== promptAsset.contentText) {
      throw new Error("Rendered prompt asset content does not match MySQL draft.");
    }
    if (bundleRulesText !== rulesAsset.contentText) {
      throw new Error("Rendered rules asset content does not match MySQL draft.");
    }
    if (bundleHelperScriptText !== helperScript.contentText) {
      throw new Error("Rendered helper script content does not match MySQL draft.");
    }
    if (directDbCache.scene !== "sales-opportunity-advisor-directdb") {
      throw new Error("DirectDbRunner sql-cache file was not copied into the bundle.");
    }

    const advisorManifestEntry = helperManifest["sales-opportunity-advisor"];
    const smartEntryManifestEntry = helperManifest["sales-opportunity-smart-entry"];
    if (!advisorManifestEntry || !smartEntryManifestEntry) {
      throw new Error("Rendered helper manifest is missing expected scene entries.");
    }
    if (advisorManifestEntry.filePath !== "project://ContextHelper/generated-queries/sales-opportunity-advisor.generated.js") {
      throw new Error(`Unexpected helper manifest filePath: ${advisorManifestEntry.filePath || "missing"}`);
    }
    if (advisorManifestEntry.declaredFilePath !== "project://ContextHelper/generated-queries/sales-opportunity-advisor.generated.js") {
      throw new Error(
        `Unexpected helper manifest declaredFilePath: ${advisorManifestEntry.declaredFilePath || "missing"}`
      );
    }
    if (advisorManifestEntry.skillPath !== "project://references/sales-opportunity-advisor/skill_contract.md") {
      throw new Error(`Unexpected helper manifest skillPath: ${advisorManifestEntry.skillPath || "missing"}`);
    }
    if (!advisorManifestEntry.definitionHash) {
      throw new Error("Rendered helper manifest entry is missing definitionHash.");
    }

    const manifest = JSON.parse(await fs.readFile(path.join(bundleDir, "manifest.json"), "utf8"));
    if (manifest.renderer_version !== "bundle-renderer/v1") {
      throw new Error(`Unexpected renderer version: ${manifest.renderer_version || "missing"}`);
    }

    console.log(
      JSON.stringify(
        {
          verificationRoot,
          releaseId: createdReleaseId,
          entryCount: created.entries.length,
          resourceSummary,
          expectedResourceSummary,
          requiredFileCount: requiredFiles.length,
          bundleDir
        },
        null,
        2
      )
    );
  } finally {
    if (createdReleaseId) {
      await store.deleteRelease(createdReleaseId).catch(() => null);
    }

    await manager.close().catch(() => null);
    await store.close().catch(() => null);
    await fs.rm(verificationRoot, { recursive: true, force: true }).catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
