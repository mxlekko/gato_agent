const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "";

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
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
