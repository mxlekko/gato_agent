import {
  clearConsoleAdminSession,
  getConsoleAdminToken,
  getConsoleAdminUser,
  hasConsoleAdminSession,
  requestJson,
  setConsoleAdminSession
} from "./httpClient";

export const authClient = {
  hasSession: hasConsoleAdminSession,
  getToken: getConsoleAdminToken,
  getUser: getConsoleAdminUser,
  clearSession: clearConsoleAdminSession,
  async login({ username, password }) {
    const response = await requestJson("/api/console/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    if (response.ok && response.payload?.success !== false) {
      const data = response.payload?.data || {};
      if (data.token) {
        setConsoleAdminSession({
          token: data.token,
          username: data.username || username
        });
      }
    }

    return response;
  }
};
