import { createPersonalClient, responseData, withRetry } from "./snaptrade-client.mjs";
import { normalizeConnection } from "./snaptrade-normalizer.mjs";

const client = createPersonalClient();
const response = await withRetry(() => client.connections.listBrokerageAuthorizations());
const rows = (responseData(response) || []).map(normalizeConnection).map((connection) => ({ brokerage_slug: connection.brokerage_slug, type: connection.type, disabled: connection.disabled, data_freshness_mode: connection.data_freshness_mode }));
console.log(JSON.stringify({ personal: true, connections: rows }, null, 2));
