const { createFileStore } = require("./file-store");
const { createMysqlStore } = require("./mysql-store");
const { createAppError } = require("../../utils/errors");

const STORE_FACTORIES = {
  file: createFileStore,
  mysql: createMysqlStore
};

let storeSingleton = null;
let storeDriver = null;

function getConfigStoreDriver(explicitDriver = null) {
  const normalized = String(explicitDriver || process.env.CONFIG_STORE_DRIVER || "file").trim().toLowerCase();
  if (!STORE_FACTORIES[normalized]) {
    throw createAppError("INVALID_REQUEST", `Unsupported config-store driver: ${normalized}.`, {
      stage: "config-store"
    });
  }

  return normalized;
}

function createConfigStore(options = {}) {
  const driver = getConfigStoreDriver(options.driver);
  const factory = STORE_FACTORIES[driver];
  return factory(options);
}

function getConfigStore(options = {}) {
  const driver = getConfigStoreDriver(options.driver);
  if (!storeSingleton || storeDriver !== driver) {
    storeSingleton = createConfigStore({ ...options, driver });
    storeDriver = driver;
  }

  return storeSingleton;
}

async function closeConfigStore() {
  if (storeSingleton && typeof storeSingleton.close === "function") {
    await storeSingleton.close();
  }

  storeSingleton = null;
  storeDriver = null;
}

module.exports = {
  closeConfigStore,
  createConfigStore,
  getConfigStore,
  getConfigStoreDriver
};
