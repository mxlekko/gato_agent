const RAW_TEXT_VISIBLE_SCENES = new Set([
  "sales-opportunity-smart-entry",
  "payment-info-split"
]);

function shouldIncludeRawText(scene) {
  return RAW_TEXT_VISIBLE_SCENES.has(String(scene || "").trim());
}

function summarizeBizParams(bizParams = {}, scene = null) {
  const summary = {
    opportunityId: bizParams.opportunityId || null,
    rawTextLength: typeof bizParams.rawText === "string" ? bizParams.rawText.length : null
  };

  if (shouldIncludeRawText(scene) && typeof bizParams.rawText === "string") {
    summary.rawText = bizParams.rawText;
  }

  return summary;
}

function buildTraceContext({
  requestId,
  traceId,
  scene = null,
  routePlan = null,
  bizParams = null,
  requestSource = "api",
  tenantId = null,
  userId = null,
  permissionScope = null
} = {}) {
  const safeBizParams = bizParams && typeof bizParams === "object" ? bizParams : {};

  return {
    requestId: requestId || null,
    traceId: traceId || null,
    requestSource,
    scene,
	    requestedMode: routePlan?.requestedMode || null,
	    effectiveMode: routePlan?.effectiveMode || null,
	    executionMode: routePlan?.executionMode || null,
	    routeReason: routePlan?.reason || null,
    bizParamKeys: Object.keys(safeBizParams),
    bizParamSummary: summarizeBizParams(safeBizParams, scene),
    tenantId,
    userId,
    permissionScope
  };
}

module.exports = {
  buildTraceContext,
  shouldIncludeRawText,
  summarizeBizParams
};
