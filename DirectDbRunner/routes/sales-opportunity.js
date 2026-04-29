const { handleDirectDbSalesOpportunity } = require("../controllers/sales-opportunity");

async function getDirectDbSalesOpportunityRoute(body) {
  return handleDirectDbSalesOpportunity(body);
}

module.exports = {
  getDirectDbSalesOpportunityRoute
};
