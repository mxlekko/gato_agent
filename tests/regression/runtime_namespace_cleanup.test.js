#!/usr/bin/env node

const assert = require("assert");
const path = require("path");

const {
  CANONICAL_RUNTIME_NAMESPACE,
  RUNTIME_PREFIX,
  RUNTIME_ROOT,
  resolvePathReference
} = require("../../utils/path-resolver");
const {
  bundleReferenceToRelativePath,
  normalizeBundlePathReference
} = require("../../services/bundle-renderer");
const { RETIRED_AGENT_RUNTIME_TOKEN } = require("../../utils/retired-runtime-markers");

function runtimeRef(namespace, assetPath) {
  return `${RUNTIME_PREFIX}${namespace}/${assetPath}`;
}

function testCanonicalRuntimeNamespaceResolves() {
  const ref = runtimeRef(CANONICAL_RUNTIME_NAMESPACE, "agents/sales-agent/agent/models.json");
  const resolution = resolvePathReference(ref);

  assert.strictEqual(
    resolution.resolvedPath,
    path.join(RUNTIME_ROOT, CANONICAL_RUNTIME_NAMESPACE, "agents", "sales-agent", "agent", "models.json")
  );
  assert.strictEqual(
    bundleReferenceToRelativePath(ref, "runtimeModels"),
    path.join("runtime-assets", CANONICAL_RUNTIME_NAMESPACE, "agents", "sales-agent", "agent", "models.json")
  );
  assert.strictEqual(normalizeBundlePathReference(ref), ref);
}

function testRetiredRuntimeNamespaceIsRejected() {
  const ref = runtimeRef(RETIRED_AGENT_RUNTIME_TOKEN, "agents/sales-agent/agent/models.json");

  assert.throws(
    () => resolvePathReference(ref),
    (error) => /Unsupported runtime namespace/.test(error.message)
  );

  assert.throws(
    () => normalizeBundlePathReference(ref),
    (error) => error.code === "INVALID_REQUEST"
      && error.stage === "bundle-renderer"
      && error.details?.supportedNamespace === CANONICAL_RUNTIME_NAMESPACE
  );

  assert.throws(
    () => bundleReferenceToRelativePath(ref, "runtimeModels"),
    (error) => error.code === "INVALID_REQUEST"
      && error.stage === "bundle-renderer"
      && error.details?.supportedNamespace === CANONICAL_RUNTIME_NAMESPACE
  );
}

function main() {
  testCanonicalRuntimeNamespaceResolves();
  testRetiredRuntimeNamespaceIsRejected();
  process.stdout.write("runtime namespace cleanup tests passed\n");
}

main();
