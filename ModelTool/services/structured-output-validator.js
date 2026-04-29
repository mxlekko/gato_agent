const { createAppError } = require("../../utils/errors");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringifyPath(path) {
  return path || "payload";
}

function schemaError(message, details = null) {
  return createAppError("INVALID_REQUEST", message, {
    stage: "model-tool",
    details
  });
}

function modelOutputError(message, details = null) {
  return createAppError("INVALID_MODEL_OUTPUT", message, {
    stage: "model-tool",
    details
  });
}

function normalizeUniqueArray(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }

  return result;
}

function validateSchemaNode(schema, path = "schema") {
  if (!isPlainObject(schema)) {
    throw schemaError("schema must be a JSON object.", {
      path
    });
  }

  if (typeof schema.type !== "string") {
    throw schemaError("schema.type is required.", {
      path
    });
  }

  if (schema.type === "object") {
    if (!isPlainObject(schema.properties)) {
      throw schemaError("schema.properties is required for object schemas.", {
        path
      });
    }

    if (schema.required !== undefined && !Array.isArray(schema.required)) {
      throw schemaError("schema.required must be an array when provided.", {
        path
      });
    }

    for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
      validateSchemaNode(propertySchema, `${path}.properties.${propertyName}`);
    }
  }

  if (schema.type === "array") {
    if (!isPlainObject(schema.items)) {
      throw schemaError("schema.items is required for array schemas.", {
        path
      });
    }

    validateSchemaNode(schema.items, `${path}.items`);
  }
}

function validateString(value, schema, path) {
  if (typeof value !== "string") {
    throw modelOutputError("Expected string value.", {
      path: stringifyPath(path),
      expectedType: "string"
    });
  }

  const normalized = value.trim();

  if (schema.minLength !== undefined && normalized.length < schema.minLength) {
    throw modelOutputError("String value is shorter than allowed.", {
      path: stringifyPath(path),
      minLength: schema.minLength
    });
  }

  if (schema.maxLength !== undefined && normalized.length > schema.maxLength) {
    return normalized.slice(0, schema.maxLength);
  }

  return normalized;
}

function validateNumber(value, schema, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw modelOutputError("Expected finite number value.", {
      path: stringifyPath(path),
      expectedType: "number"
    });
  }

  if (schema.integer === true && !Number.isInteger(value)) {
    throw modelOutputError("Expected integer value.", {
      path: stringifyPath(path),
      expectedType: "integer"
    });
  }

  return value;
}

function validateStringOrNumber(value, schema, path) {
  if (typeof value === "string") {
    return validateString(value, schema, path);
  }

  return validateNumber(value, schema, path);
}

function validateBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw modelOutputError("Expected boolean value.", {
      path: stringifyPath(path),
      expectedType: "boolean"
    });
  }

  return value;
}

function validateArray(value, schema, path) {
  if (!Array.isArray(value)) {
    throw modelOutputError("Expected array value.", {
      path: stringifyPath(path),
      expectedType: "array"
    });
  }

  let normalized = value.map((item, index) => validateValue(item, schema.items, `${path}[${index}]`));

  if (schema.uniqueItems === true) {
    normalized = normalizeUniqueArray(normalized);
  }

  if (schema.minItems !== undefined && normalized.length < schema.minItems) {
    throw modelOutputError("Array item count is smaller than allowed.", {
      path: stringifyPath(path),
      minItems: schema.minItems
    });
  }

  if (schema.maxItems !== undefined && normalized.length > schema.maxItems) {
    normalized = normalized.slice(0, schema.maxItems);
  }

  return normalized;
}

function validateObject(value, schema, path) {
  if (!isPlainObject(value)) {
    throw modelOutputError("Expected object value.", {
      path: stringifyPath(path),
      expectedType: "object"
    });
  }

  const normalized = {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const requiredField of required) {
    if (value[requiredField] === undefined) {
      throw modelOutputError("Required field is missing.", {
        path: stringifyPath(`${path}.${requiredField}`),
        requiredField
      });
    }
  }

  for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
    if (value[propertyName] === undefined) {
      continue;
    }

    normalized[propertyName] = validateValue(value[propertyName], propertySchema, `${path}.${propertyName}`);
  }

  if (schema.additionalProperties === true) {
    for (const [key, fieldValue] of Object.entries(value)) {
      if (normalized[key] !== undefined || schema.properties[key]) {
        continue;
      }
      normalized[key] = fieldValue;
    }
  }

  return normalized;
}

function validateValue(value, schema, path) {
  switch (schema.type) {
    case "string":
      return validateString(value, schema, path);
    case "number":
      return validateNumber(value, schema, path);
    case "integer":
      return validateNumber(value, { ...schema, integer: true }, path);
    case "string_or_number":
      return validateStringOrNumber(value, schema, path);
    case "boolean":
      return validateBoolean(value, path);
    case "array":
      return validateArray(value, schema, path);
    case "object":
      return validateObject(value, schema, path);
    default:
      throw schemaError(`Unsupported schema.type: ${schema.type}.`, {
        path: stringifyPath(path)
      });
  }
}

function validateStructuredOutputRequest(body) {
  if (!isPlainObject(body)) {
    throw schemaError("Model tool request body must be a JSON object.");
  }

  if (!body.requestId || typeof body.requestId !== "string") {
    throw schemaError("requestId is required for model tool validation.");
  }

  if (!body.scene || typeof body.scene !== "string") {
    throw schemaError("scene is required for model tool validation.");
  }

  if (!isPlainObject(body.payload)) {
    throw schemaError("payload must be a JSON object.");
  }

  validateSchemaNode(body.schema);

  return {
    requestId: body.requestId,
    scene: body.scene,
    payload: body.payload,
    schema: body.schema
  };
}

function validateStructuredOutput(body) {
  const validated = validateStructuredOutputRequest(body);
  const normalizedPayload = validateValue(validated.payload, validated.schema, "payload");

  return {
    requestId: validated.requestId,
    scene: validated.scene,
    payload: normalizedPayload
  };
}

module.exports = {
  validateStructuredOutput
};
