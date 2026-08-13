import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPersonalClient, responseData, withRetry } from "./snaptrade-client.mjs";
import { normalizeConnection, normalizeSnapshot } from "./snaptrade-normalizer.mjs";
import { decryptSnapshot, encryptSnapshot, writeEncryptedSnapshotAtomic } from "./encrypted-holdings-snapshot.mjs";

const outputPath = path.resolve(process.env.HOLDINGS_OUTPUT || "data/private/wealthsimple-holdings.enc.json");
const key = process.env.HOLDINGS_SNAPSHOT_KEY;
if (!key) throw new Error("缺少 HOLDINGS_SNAPSHOT_KEY；同步失败，不覆盖最后有效快照。");
const client = createPersonalClient();
const rawConnections = responseData(await withRetry(() => client.connections.listBrokerageAuthorizations())) || [];
const eligibleConnections = rawConnections.filter((connection) => {
  const normalized = normalizeConnection(connection);
  return normalized.brokerage_slug === "WEALTHSIMPLETRADE" && normalized.type === "read" && normalized.disabled === false;
});
if (!eligibleConnections.length) throw new Error("没有有效的 Wealthsimple read-only 连接；不覆盖最后有效快照。");

const accountsResponse = await withRetry(() => client.accountInformation.listUserAccounts());
const eligibleConnectionIds = new Set(eligibleConnections.map((connection) => connection.id).filter(Boolean));
const accounts = (responseData(accountsResponse) || []).filter((account) => eligibleConnectionIds.has(typeof account?.brokerage_authorization === "string" ? account.brokerage_authorization : account?.brokerage_authorization?.id));
const accountDetails = new Map();
const positions = new Map();
const balances = new Map();
for (const account of accounts) {
  const [detail, position, balance] = await Promise.all([
    withRetry(() => client.accountInformation.getUserAccountDetails({ accountId: account.id })),
    withRetry(() => client.accountInformation.getAllAccountPositions({ accountId: account.id })),
    withRetry(() => client.accountInformation.getUserAccountBalance({ accountId: account.id })),
  ]);
  accountDetails.set(account.id, responseData(detail));
  positions.set(account.id, responseData(position));
  balances.set(account.id, responseData(balance));
}
const snapshot = normalizeSnapshot({ connections: rawConnections, accounts, accountDetails, positions, balances });
if (!snapshot.accounts.length) throw new Error("SnapTrade 返回的 Wealthsimple 连接没有可同步投资账户；不覆盖最后有效快照。");
const comparable = (value) => { const copy = JSON.parse(JSON.stringify(value)); delete copy.generated_at; return copy; };
try {
  const existing = JSON.parse(await readFile(outputPath, "utf8"));
  const previous = decryptSnapshot(existing, key);
  if (JSON.stringify(comparable(previous)) === JSON.stringify(comparable(snapshot))) {
    console.log(JSON.stringify({ changed: false, output: path.relative(process.cwd(), outputPath), accountCount: snapshot.accounts.length, positionCount: snapshot.holdings.length, generatedAt: existing.generated_at }, null, 2));
    process.exit(0);
  }
} catch (_) {
  // First run, unavailable old key, or placeholder: replace only after successful validation.
}
const envelope = encryptSnapshot(snapshot, key);
await writeEncryptedSnapshotAtomic(outputPath, envelope);
console.log(JSON.stringify({ changed: true, output: path.relative(process.cwd(), outputPath), accountCount: snapshot.accounts.length, positionCount: snapshot.holdings.length, generatedAt: snapshot.generated_at }, null, 2));
