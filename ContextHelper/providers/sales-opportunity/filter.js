function isBlankString(value) {
  return typeof value === "string" && value.trim().length === 0;
}

function filterNonEmptyFields(row) {
  const filtered = {};

  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (isBlankString(value)) {
      continue;
    }

    filtered[key] = value;
  }

  return filtered;
}

module.exports = {
  filterNonEmptyFields
};
