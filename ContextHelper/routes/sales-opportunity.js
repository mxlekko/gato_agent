const { handleSalesOpportunityContext } = require("../controllers/sales-opportunity");

async function getSalesOpportunityContextRoute(body) {
  return handleSalesOpportunityContext(body);
}

module.exports = {
  getSalesOpportunityContextRoute
};
