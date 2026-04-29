const { info, error } = require("../../utils/logger");

function writeAuditLog(entry) {
  info("context-helper.audit", entry);
}

function writeAuditError(entry) {
  error("context-helper.audit", entry);
}

module.exports = {
  writeAuditError,
  writeAuditLog
};
