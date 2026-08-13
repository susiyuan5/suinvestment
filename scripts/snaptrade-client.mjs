import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";

export function requiredEnv() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  if (!clientId || !consumerKey) throw new Error("缺少 SNAPTRADE_CLIENT_ID 或 SNAPTRADE_CONSUMER_KEY；请仅在本机环境或 GitHub Secret 中配置。");
  return { clientId, consumerKey };
}

export function createPersonalClient() {
  const { clientId, consumerKey } = requiredEnv();
  return new Snaptrade({ auth: SnaptradeAuth.personalApiKey({ clientId, consumerKey }) });
}

export async function withRetry(operation, { attempts = 3, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      const status = Number(error?.status || error?.response?.status || 0);
      if (attempt === attempts - 1 || ![429, 500, 502, 503, 504].includes(status)) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** attempt)));
    }
  }
  throw lastError;
}

export function responseData(response) { return response?.data ?? response?.body ?? response; }

export const READ_ONLY_CONNECTION = Object.freeze({ broker: "WEALTHSIMPLETRADE", connectionType: "read", connectionPortalVersion: "v4", darkMode: true });
