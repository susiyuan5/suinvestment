import { createPersonalClient, responseData, withRetry } from "./snaptrade-client.mjs";
import { normalizeConnection } from "./snaptrade-normalizer.mjs";

const authorizationId = process.argv[2];
if (!authorizationId || !/^[0-9a-f-]{20,}$/i.test(authorizationId)) throw new Error("请传入要主动删除的连接 ID；不会删除账户目标配置或历史快照。");
const client = createPersonalClient();
const listed = responseData(await withRetry(() => client.connections.listBrokerageAuthorizations())) || [];
const connection = listed.map(normalizeConnection).find((item) => item.id === authorizationId);
if (!connection) throw new Error("未找到该 SnapTrade 连接");
if (connection.brokerage_slug !== "WEALTHSIMPLETRADE") throw new Error("只允许删除 Wealthsimple 连接");
await withRetry(() => client.connections.deleteConnection({ authorizationId }));
console.log(JSON.stringify({ deleted: true, brokerage_slug: connection.brokerage_slug, type: connection.type }, null, 2));
