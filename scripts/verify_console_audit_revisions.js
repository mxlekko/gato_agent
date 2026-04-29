require("../utils/load-env").loadProjectEnv();

const { createConfigStore } = require("../services/config-store");
const { getConsoleRevisionDetail, listConsoleRevisions } = require("../services/console-audit");
const { getConsoleRevisionDetailRoute, listConsoleRevisionsRoute } = require("../routes/console-audit");

async function main() {
  const store = createConfigStore({ driver: "mysql" });

  try {
    const promptAsset = await store.getSceneAsset("sales-opportunity-advisor", "prompt");
    if (!promptAsset) {
      throw new Error("Expected scene asset sales-opportunity-advisor:prompt is missing.");
    }

    const promptRevisions = await store.listRevisions({
      targetType: "scene-asset",
      targetId: promptAsset.id,
      limit: 5
    });
    if (promptRevisions.length === 0) {
      throw new Error("Expected scene asset revisions are missing.");
    }

    const latestRevision = promptRevisions[0];
    const listData = await listConsoleRevisions({
      targetType: "scene-asset",
      scene: "sales-opportunity-advisor",
      assetType: "prompt",
      limit: 5
    });

    if (listData.total === 0 || listData.items.length === 0) {
      throw new Error("listConsoleRevisions returned no items for the prompt asset.");
    }
    if (listData.filters.targetType !== "scene-asset" || listData.filters.assetType !== "prompt") {
      throw new Error(`Unexpected revision filter echo: ${JSON.stringify(listData.filters)}`);
    }

    const listedLatest = listData.items.find((item) => Number(item.id) === Number(latestRevision.id));
    if (!listedLatest) {
      throw new Error(`Expected latest revision ${latestRevision.id} was not returned by listConsoleRevisions.`);
    }
    if (listedLatest.target.label !== "sales-opportunity-advisor:prompt") {
      throw new Error(`Unexpected target label: ${listedLatest.target.label || "missing"}.`);
    }
    if (Number(listedLatest.target.targetId) !== Number(promptAsset.id)) {
      throw new Error(`Unexpected targetId: ${listedLatest.target.targetId || "missing"}.`);
    }

    const unfiltered = await listConsoleRevisions({ limit: 10 });
    if (unfiltered.total === 0 || Object.keys(unfiltered.countsByTargetType || {}).length === 0) {
      throw new Error("Unfiltered audit revision feed returned no target type counts.");
    }

    const routeListResult = await listConsoleRevisionsRoute(
      new URL(
        "http://localhost/api/console/audit/revisions?targetType=scene-asset&scene=sales-opportunity-advisor&assetType=prompt&limit=5"
      )
    );
    if (routeListResult.statusCode !== 200 || routeListResult.payload?.success !== true) {
      throw new Error(`Unexpected route list result: ${JSON.stringify(routeListResult)}`);
    }

    const detailData = await getConsoleRevisionDetail({
      revisionId: latestRevision.id
    });
    if (Number(detailData.revision.id) !== Number(latestRevision.id)) {
      throw new Error(`Unexpected detail revision id: ${detailData.revision.id || "missing"}.`);
    }
    if (detailData.revision.target.label !== "sales-opportunity-advisor:prompt") {
      throw new Error(`Unexpected detail target label: ${detailData.revision.target.label || "missing"}.`);
    }
    if (typeof detailData.revision.sourceText !== "string") {
      throw new Error("Revision detail sourceText is missing.");
    }
    if (detailData.revision.isCurrentRevision !== (Number(promptAsset.currentRevisionId) === Number(latestRevision.id))) {
      throw new Error("Revision detail current revision flag does not match the target currentRevisionId.");
    }

    const routeDetailResult = await getConsoleRevisionDetailRoute(String(latestRevision.id));
    if (routeDetailResult.statusCode !== 200 || routeDetailResult.payload?.success !== true) {
      throw new Error(`Unexpected route detail result: ${JSON.stringify(routeDetailResult)}`);
    }

    console.log(
      JSON.stringify(
        {
          target: {
            scene: "sales-opportunity-advisor",
            assetType: "prompt",
            targetId: promptAsset.id,
            currentRevisionId: promptAsset.currentRevisionId
          },
          revisionList: {
            total: listData.total,
            countsByTargetType: listData.countsByTargetType,
            latestRevisionId: listedLatest.id
          },
          revisionDetail: {
            revisionId: detailData.revision.id,
            revisionNo: detailData.revision.revisionNo,
            operator: detailData.revision.operator,
            isCurrentRevision: detailData.revision.isCurrentRevision
          },
          unfilteredCountsByTargetType: unfiltered.countsByTargetType
        },
        null,
        2
      )
    );
  } finally {
    await store.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
