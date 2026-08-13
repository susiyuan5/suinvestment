import { createPersonalClient, READ_ONLY_CONNECTION, responseData, withRetry } from "./snaptrade-client.mjs";

const client = createPersonalClient();
const response = await withRetry(() => client.authentication.loginSnapTradeUser(READ_ONLY_CONNECTION));
const data = responseData(response);
if (!data?.redirectURI) throw new Error("SnapTrade 未返回有效 Connection Portal 链接");
console.log(JSON.stringify({ redirectURI: data.redirectURI, expiresInMinutes: 5, broker: READ_ONLY_CONNECTION.broker, connectionType: READ_ONLY_CONNECTION.connectionType, connectionPortalVersion: READ_ONLY_CONNECTION.connectionPortalVersion }, null, 2));
console.log("请复制链接到普通浏览器完成 Wealthsimple 和 MFA 授权；本工具不会自动打开浏览器。");
