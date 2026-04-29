require("../utils/load-env").loadProjectEnv();

const { rollbackConsoleRelease } = require("../services/console-releases");

async function main() {
  const releaseId = process.argv[2];
  const updatedBy = process.argv[3] || "rollback-release-script";

  if (!releaseId) {
    throw new Error("Usage: node scripts/rollback_release.js <releaseId> [updatedBy]");
  }

  const result = await rollbackConsoleRelease({
    releaseId,
    updatedBy
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
