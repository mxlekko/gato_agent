const { handleStructuredOutputValidation } = require("../controllers/structured-output");

async function getStructuredOutputValidationRoute(body) {
  return handleStructuredOutputValidation(body);
}

module.exports = {
  getStructuredOutputValidationRoute
};
