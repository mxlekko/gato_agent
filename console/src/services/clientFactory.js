import { apiClient } from "./apiClient";
import { mockClient } from "./mockClient";

export const consoleDataMode =
  (import.meta.env.VITE_CONSOLE_DATA_MODE || "api").trim() || "api";

export const consoleClient =
  consoleDataMode === "api" ? apiClient : mockClient;
