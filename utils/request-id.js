const { randomUUID } = require("crypto");

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function buildTimestampedId(prefix, date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  const suffix = randomUUID().split("-")[0];

  return `${prefix}_${yyyy}${mm}${dd}_${hh}${mi}${ss}${ms}_${suffix}`;
}

function buildRequestId(date = new Date()) {
  return buildTimestampedId("req", date);
}

function buildTraceId(date = new Date()) {
  return buildTimestampedId("trace", date);
}

module.exports = {
  buildRequestId,
  buildTraceId,
  buildTimestampedId
};
