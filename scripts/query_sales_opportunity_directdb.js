#!/usr/bin/env node

require("../utils/load-env").loadProjectEnv();

const { getSalesOpportunityContext } = require("../ContextHelper/providers/sales-opportunity");
const { buildErrorResponse, buildSuccessResponse, createAppError, normalizeError } = require("../utils/errors");

async function main() {
  const requestId = process.argv[2] || null;
  const opportunityId = process.argv[3] || null;

  if (!requestId || !opportunityId) {
    const appError = createAppError(
      "INVALID_REQUEST",
      "requestId and opportunityId are required for direct DB context query.",
      {
        stage: "directdb-query"
      }
    );
    process.stdout.write(`${JSON.stringify(buildErrorResponse(appError, requestId))}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const data = await getSalesOpportunityContext({
      requestId,
      opportunityId
    });

    const compactData = {
      requestId: data.requestId,
      opportunityId: data.opportunityId,
      rawRow: data.rawRow
    };

    process.stdout.write(`${JSON.stringify(buildSuccessResponse(compactData, requestId))}\n`);
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    process.stdout.write(`${JSON.stringify(buildErrorResponse(appError, requestId))}\n`);
    process.exitCode = 1;
  }
}

main();
