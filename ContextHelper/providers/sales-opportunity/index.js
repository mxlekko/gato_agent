const { filterNonEmptyFields } = require("./filter");
const { querySalesOpportunity } = require("./query");
const { validateInput } = require("./schema");

async function getSalesOpportunityContext(params) {
  const validated = validateInput(params);
  const row = await querySalesOpportunity(validated.opportunityId);
  const rawRow = filterNonEmptyFields(row);

  return {
    requestId: validated.requestId,
    opportunityId: validated.opportunityId,
    rawRow
  };
}

module.exports = {
  getSalesOpportunityContext
};
