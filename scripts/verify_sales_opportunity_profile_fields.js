#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { runNormalizeFactsNode } = require("../platform/nodes/normalize-facts");

const ROOT_DIR = path.resolve(__dirname, "..");
const DICTIONARY_FILE = path.join(ROOT_DIR, "metadata", "sales_opportunity_dictionary.tsv");
const LEGACY_AGENT_PROFILE_FIELDS = Object.freeze([
  "opportunityId",
  "opportunityName",
  "customerName",
  "salesStage",
  "opportunityStatus",
  "businessType",
  "amount",
  "budgetConfirmed",
  "predictTenderDate",
  "winRate"
]);

function createState(rawRow, opportunityId = "verify-profile-opportunity") {
  return {
    request: {
      scene: "sales-opportunity-advisor",
      normalized: {
        biz_params: {
          opportunityId
        }
      },
      biz_params: {
        opportunityId
      }
    },
    artifacts: {
      context: {
        raw: {
          rawRow
        }
      },
      references: {
        dictionary: fs.readFileSync(DICTIONARY_FILE, "utf8")
      },
      outputs: {
        authorize_scope: {
          allowed_fields: ["*"]
        }
      }
    }
  };
}

function assertProfileContainsLegacyFields(profile) {
  for (const fieldName of LEGACY_AGENT_PROFILE_FIELDS) {
    assert(
      Object.prototype.hasOwnProperty.call(profile, fieldName),
      `facts.profile missing legacy agent field ${fieldName}`
    );
    assert.notStrictEqual(profile[fieldName], undefined, `facts.profile.${fieldName} is undefined`);
    assert.notStrictEqual(profile[fieldName], null, `facts.profile.${fieldName} is null`);
    assert.notStrictEqual(profile[fieldName], "", `facts.profile.${fieldName} is empty`);
  }
}

function findFactItem(items, fieldName) {
  return items.find((item) => item.field === fieldName) || null;
}

async function verifyProfileWithLegacyBudgetField() {
  const state = createState({
    opportunityId: "verify-profile-opportunity",
    opportunityName: "测试机会",
    customerName: "测试客户",
    salesScene: "smallProject",
    salesStage: "tenderBid",
    opportunityStatus: "progressing",
    amount: 15000,
    budgetConfirmed: 0,
    predictTenderDate: "2026-04-10",
    winRate: 50
  });
  const nextState = await runNormalizeFactsNode({ state });
  const profile = nextState.artifacts.facts.profile;
  const items = nextState.artifacts.facts.items;

  assertProfileContainsLegacyFields(profile);
  assert.strictEqual(profile.opportunityId, "verify-profile-opportunity");
  assert.strictEqual(profile.salesStage, "招标与投标");
  assert.strictEqual(profile.opportunityStatus, "进行中");
  assert.strictEqual(profile.businessType, "小项目");
  assert.strictEqual(profile.amount, "15,000元");
  assert.strictEqual(profile.budgetConfirmed, "否");
  assert.strictEqual(profile.predictTenderDate, "2026-04-10");
  assert.strictEqual(profile.winRate, "50%");
  assert.strictEqual(findFactItem(items, "businessType")?.raw_value, "smallProject");
  assert.strictEqual(findFactItem(items, "budgetConfirmed")?.raw_value, 0);
  assert(nextState.artifacts.facts.basis_fields.includes("businessType"));
  assert(nextState.artifacts.facts.basis_fields.includes("budgetConfirmed"));

  return {
    profile,
    basisFields: nextState.artifacts.facts.basis_fields
  };
}

async function verifyProfileWithMissingLegacyBudgetField() {
  const state = createState({
    opportunityId: "verify-profile-missing-budget",
    opportunityName: "缺预算字段机会",
    customerName: "测试客户",
    salesScene: "noTender",
    salesStage: "decisionChain",
    opportunityStatus: "lost",
    amount: 15999,
    predictTenderDate: "2026-04-08",
    winRate: 0
  }, "verify-profile-missing-budget");
  const nextState = await runNormalizeFactsNode({ state });
  const profile = nextState.artifacts.facts.profile;

  assertProfileContainsLegacyFields(profile);
  assert.strictEqual(profile.businessType, "不招标");
  assert.strictEqual(profile.budgetConfirmed, "未提供");
  assert.strictEqual(profile.salesStage, "决策链覆盖");
  assert.strictEqual(profile.opportunityStatus, "输单");
  assert.strictEqual(profile.amount, "15,999元");
  assert.strictEqual(profile.winRate, "0%");

  return {
    profile,
    basisFields: nextState.artifacts.facts.basis_fields
  };
}

async function main() {
  const withBudget = await verifyProfileWithLegacyBudgetField();
  const withoutBudget = await verifyProfileWithMissingLegacyBudgetField();

  console.log(JSON.stringify({
    verified: true,
    legacyAgentProfileFields: LEGACY_AGENT_PROFILE_FIELDS,
    withBudget: {
      profile: withBudget.profile,
      basisFields: withBudget.basisFields
    },
    withoutBudget: {
      profile: withoutBudget.profile,
      basisFields: withoutBudget.basisFields
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
