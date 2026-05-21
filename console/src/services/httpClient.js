const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "";
const ADMIN_TOKEN_STORAGE_KEY = "agent-platform-console-admin-token";
const ADMIN_USER_STORAGE_KEY = "agent-platform-console-admin-user";

export function getConsoleAdminToken() {
  const envToken = import.meta.env.VITE_CONSOLE_ADMIN_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  try {
    return window.localStorage?.getItem(ADMIN_TOKEN_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function getConsoleAdminUser() {
  try {
    return window.localStorage?.getItem(ADMIN_USER_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function hasConsoleAdminSession() {
  return Boolean(getConsoleAdminToken());
}

export function setConsoleAdminSession({ token, username }) {
  try {
    window.localStorage?.setItem(ADMIN_TOKEN_STORAGE_KEY, String(token || "").trim());
    window.localStorage?.setItem(ADMIN_USER_STORAGE_KEY, String(username || "").trim());
  } catch {
    // Ignore storage failures; subsequent protected calls will fail normally.
  }
}

export function clearConsoleAdminSession() {
  try {
    window.localStorage?.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    window.localStorage?.removeItem(ADMIN_USER_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`API 返回了不可解析的 JSON: ${error.message}`);
  }
}

export async function requestJson(path, options = {}) {
  const adminToken = getConsoleAdminToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "X-Console-Admin-Token": adminToken } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await parseResponse(response);
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

export async function requestFormData(path, formData, options = {}) {
  const adminToken = getConsoleAdminToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    method: options.method || "POST",
    headers: {
      ...(adminToken ? { "X-Console-Admin-Token": adminToken } : {}),
      ...(options.headers || {})
    },
    body: formData
  });

  const payload = await parseResponse(response);
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}
