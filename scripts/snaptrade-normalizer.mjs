import crypto from "node:crypto";

const INVESTMENT_KINDS = new Set(["stock", "adr", "etf"]);

export function finiteDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function stableAccountId(account, institution = "WEALTHSIMPLETRADE") {
  const seed = `${institution}:${String(account?.institution_account_id || account?.id || "")}`;
  return `wsa_${crypto.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32)}`;
}

function iso(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

const own = (value, key) => value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
const MAX_SOURCE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function sourceTimestamp(value, name, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new Error(`${name} 缺少持仓来源时间；不能使用本地生成时间替代。`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${name} 的持仓来源时间无效。`);
  const result = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(result);
  if (!match || result.startsWith("0000-") || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) throw new Error(`${name} 的持仓来源时间不是有效 ISO 时间。`);
  const day = new Date(match[1] + "T00:00:00Z");
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1] || !Number.isFinite(Date.parse(result))) throw new Error(`${name} 的持仓来源时间无效。`);
  return result;
}

export function normalizeConnection(connection) {
  const brokerage = connection?.brokerage || {};
  return {
    id: connection?.id || null,
    brokerage_slug: brokerage.slug || brokerage.brokerage_slug || null,
    brokerage_name: brokerage.name || connection?.name || null,
    type: connection?.type || null,
    disabled: connection?.disabled !== false,
    data_freshness_mode: connection?.data_freshness_mode || null,
    raw: connection,
  };
}

export function isEligibleReadOnlyConnection(connection) {
  const normalized = normalizeConnection(connection);
  return normalized.brokerage_slug === "WEALTHSIMPLETRADE" && normalized.type === "read" && normalized.disabled === false;
}

export function normalizeBalance(balance) {
  const currency = balance?.currency?.code || balance?.currency || null;
  return {
    currency,
    cash: finiteDecimal(balance?.cash),
    buying_power: finiteDecimal(balance?.buying_power),
  };
}

export function normalizePosition(position) {
  const legacyInstrument = position?.instrument || {};
  const instrument = position?.symbol?.symbol || legacyInstrument;
  const typeCode = instrument?.type?.code || instrument?.type?.id || instrument?.kind || "other";
  const kind = ({ cs: "stock", ad: "adr", et: "etf" })[String(typeCode).toLowerCase()] || String(typeCode).toLowerCase();
  const unitsRaw = position?.units ?? legacyInstrument.units ?? null;
  const priceRaw = position?.price ?? legacyInstrument.price ?? null;
  const costBasisRaw = position?.average_purchase_price ?? legacyInstrument.cost_basis ?? position?.cost_basis ?? null;
  const positionCurrency = position?.currency?.code || position?.currency || legacyInstrument.currency?.code || legacyInstrument.currency || null;
  const listingCurrency = instrument?.currency?.code || instrument?.currency || null;
  const marketValueRaw = position?.market_value ?? position?.marketValue ?? null;
  const cashEquivalent = position?.cash_equivalent === true || instrument.cash_equivalent === true;
  return {
    symbol: instrument.symbol || (typeof position?.symbol === "string" ? position.symbol : null),
    raw_symbol: instrument.raw_symbol || position?.raw_symbol || null,
    description: instrument.description || position?.description || null,
    instrument_kind: kind,
    exchange: instrument?.exchange?.code || instrument?.exchange?.mic_code || instrument?.exchange?.name || instrument.exchange || position?.exchange || null,
    listing_currency: listingCurrency,
    units: finiteDecimal(unitsRaw),
    units_raw: unitsRaw === null || unitsRaw === undefined ? null : String(unitsRaw),
    price: finiteDecimal(priceRaw),
    price_raw: priceRaw === null || priceRaw === undefined ? null : String(priceRaw),
    cost_basis: finiteDecimal(costBasisRaw),
    cost_basis_raw: costBasisRaw === null || costBasisRaw === undefined ? null : String(costBasisRaw),
    position_currency: positionCurrency,
    market_value: finiteDecimal(marketValueRaw) ?? (finiteDecimal(unitsRaw) !== null && finiteDecimal(priceRaw) !== null ? finiteDecimal(unitsRaw) * finiteDecimal(priceRaw) : null),
    data_as_of: iso(position?.data_as_of || position?.as_of || instrument?.as_of),
    cash_equivalent: cashEquivalent,
    included_in_stock_plan: INVESTMENT_KINDS.has(kind) && !cashEquivalent,
  };
}

export function normalizeAccount(account, details = {}, positions = {}, balances = []) {
  if (!Array.isArray(positions) && !Array.isArray(positions?.results)) throw new Error("持仓响应明细无效；不能将缺失明细视为空持仓。");
  const sync = own(details?.sync_status, "holdings") ? details.sync_status : account?.sync_status || {};
  const holdingsSync = sync.holdings || {};
  const dailyHoldingsAsOf = iso(holdingsSync.last_successful_sync);
  const hasPositionMetadata = own(positions, "data_freshness");
  let positionsAsOf, positionsTimestampSource;
  if (hasPositionMetadata) {
    // Endpoint metadata describes when these returned positions were fetched
    // from the brokerage. A successful HTTP request alone proves no freshness.
    positionsAsOf = sourceTimestamp(positions.data_freshness?.as_of, "positions.data_freshness.as_of", { required: true });
    positionsTimestampSource = "positions_response";
  } else {
    positionsAsOf = sourceTimestamp(holdingsSync.last_successful_sync, "sync_status.holdings.last_successful_sync");
    positionsTimestampSource = own(details?.sync_status, "holdings") ? "account_details_holdings_sync" : "account_list_holdings_sync";
  }
  const rawPositions = Array.isArray(positions) ? positions : positions.results;
  const rawBalances = Array.isArray(balances) ? balances : [];
  const total = account?.balance?.total || details?.balance?.total || {};
  return {
    internal_account_id: stableAccountId(account),
    account_name: account?.name || null,
    account_category: account?.account_category || null,
    raw_type: account?.raw_type || null,
    institution: account?.institution_name || "Wealthsimple",
    total_value: finiteDecimal(total.amount),
    total_value_currency: total.currency || null,
    sync_status: holdingsSync.holdings_unavailable ? "unavailable" : (holdingsSync.last_successful_sync ? "synced" : "unknown"),
    holdings_as_of: dailyHoldingsAsOf,
    positions_as_of: positionsAsOf,
    positions_timestamp_source: positionsTimestampSource,
    balances: rawBalances.map(normalizeBalance),
    positions: rawPositions.map(normalizePosition),
  };
}

export function normalizeSnapshot({ connections = [], accounts = [], accountDetails = new Map(), positions = new Map(), balances = new Map(), generatedAt = new Date().toISOString() }) {
  const generationTime = Date.parse(sourceTimestamp(generatedAt, "generated_at", { required: true }));
  const eligible = connections.filter(isEligibleReadOnlyConnection).map(normalizeConnection);
  const eligibleIds = new Set(eligible.map((item) => item.id).filter(Boolean));
  const normalizedAccounts = accounts
    .filter((account) => eligibleIds.has(typeof account?.brokerage_authorization === "string" ? account.brokerage_authorization : account?.brokerage_authorization?.id))
    .map((account) => normalizeAccount(account, accountDetails.get(account.id), positions.get(account.id), balances.get(account.id)));
  const missingSource = normalizedAccounts.some((account) => account.positions_as_of === null);
  const unavailableHoldings = normalizedAccounts.some((account) => account.sync_status === "unavailable");
  for (const account of normalizedAccounts) {
    if (account.positions_as_of !== null && Date.parse(account.positions_as_of) > generationTime) throw new Error("持仓来源时间晚于快照生成时间；不发布未来来源数据。");
  }
  const oldestAccount = missingSource ? null : normalizedAccounts.reduce((oldest, account) =>
    oldest === null || Date.parse(account.positions_as_of) < Date.parse(oldest.positions_as_of) ? account : oldest, null);
  const warnings = eligible.length ? [] : ["没有可用的 Wealthsimple 只读连接"];
  if (missingSource) warnings.push("存在缺失持仓来源时间的账户，不能证明完整快照的新鲜度。");
  if (unavailableHoldings) warnings.push("存在无法从券商读取持仓的账户，不能将空返回值视为完整持仓。");
  return {
    schema_version: "wealthsimple-holdings-v1",
    generated_at: generatedAt,
    positions_as_of: oldestAccount?.positions_as_of || null,
    source: "snaptrade_personal_readonly",
    institution: "Wealthsimple",
    connections: eligible.map(({ raw, ...connection }) => connection),
    accounts: normalizedAccounts,
    holdings: normalizedAccounts.flatMap((account) => account.positions.map((position) => ({ ...position, internal_account_id: account.internal_account_id, account_name: account.account_name }))),
    status: eligible.length && normalizedAccounts.length && !missingSource && !unavailableHoldings ? "healthy" : eligible.length ? "warning" : "blocked",
    warnings,
  };
}

// Called before comparing/encrypting/publishing a newly fetched snapshot. This
// deliberately validates source age against this run's generation timestamp,
// never substitutes that local clock for unknown or stale brokerage data.
export function assertSnapshotSourceFreshness(snapshot) {
  const generatedAt = sourceTimestamp(snapshot?.generated_at, "generated_at", { required: true });
  const generatedTime = Date.parse(generatedAt);
  if (snapshot?.status !== "healthy" || !Array.isArray(snapshot.accounts) || snapshot.accounts.length === 0) throw new Error("持仓来源未通过完整性核对；不覆盖最后有效快照。");
  const snapshotAsOf = sourceTimestamp(snapshot.positions_as_of, "positions_as_of", { required: true });
  let oldestTime = Infinity;
  for (const account of snapshot.accounts) {
    if (account.sync_status === "unavailable") throw new Error("账户持仓来源不可用；不覆盖最后有效快照。");
    const accountAsOf = sourceTimestamp(account.positions_as_of, "account.positions_as_of", { required: true });
    const sourceTime = Date.parse(accountAsOf);
    if (sourceTime > generatedTime) throw new Error("持仓来源时间晚于快照生成时间；不发布未来来源数据。");
    if (generatedTime - sourceTime > MAX_SOURCE_AGE_MS) throw new Error("券商持仓来源数据已超过 3 天；不覆盖最后有效快照。");
    oldestTime = Math.min(oldestTime, sourceTime);
  }
  if (Date.parse(snapshotAsOf) !== oldestTime) throw new Error("快照来源时间未反映全部账户中最旧的数据；不覆盖最后有效快照。");
  return snapshot;
}

function rateFresh(options = {}) { const at = Date.parse(options.fxAsOf || ""), now = options.now ?? Date.now(), age = (now - at) / 86400000; return Number.isFinite(at) && age >= 0 && age <= (options.fxMaxAgeDays ?? 3) && Number(options.fxRate) > 0; }
function toUsd(amount, currency, options) { if (currency === "USD") return Number(amount); if (currency === "CAD" && rateFresh(options)) return Number(amount) / Number(options.fxRate); return null; }

export function portfolioRiskFromSnapshot(snapshot, options = {}) {
  const holdings = (snapshot?.holdings || []).filter((item) => item.included_in_stock_plan && item.market_value !== null);
  const balances = (snapshot?.accounts || []).flatMap((account) => account.balances || []);
  const invalid = holdings.some((item) => toUsd(item.market_value, item.position_currency || item.listing_currency, options) === null) || balances.some((balance) => toUsd(balance.cash || 0, balance.currency, options) === null);
  if (invalid) return { complete: false, currency: "USD", available_cash_provided: false, positions: {}, source: "snaptrade_automatic", source_as_of: snapshot?.positions_as_of || null, warnings: ["持仓币种或 USD/CAD 汇率不可用，组合风控已停止"] };
  const cash = balances.reduce((sum, balance) => sum + toUsd(balance.cash || 0, balance.currency, options), 0);
  const positions = {};
  holdings.forEach((item) => {
    if (!item.symbol) return;
    const current = positions[item.symbol] || { current_value: 0, shares: 0, cost_total: 0, cost_complete: true, average_cost: null, latest_price: null, currency: "USD" };
    const units = item.units || 0, itemCurrency = item.position_currency || item.listing_currency;
    current.current_value += toUsd(item.market_value || 0, itemCurrency, options);
    current.shares += units;
    if (item.cost_basis !== null && item.cost_basis !== undefined) current.cost_total += toUsd(item.cost_basis * units, itemCurrency, options); else if (units > 0) current.cost_complete = false;
    if (item.price !== null && item.price !== undefined) current.latest_price = toUsd(item.price, itemCurrency, options);
    positions[item.symbol] = current;
  });
  const stockTotal = Object.values(positions).reduce((sum, position) => sum + position.current_value, 0), total = stockTotal + cash;
  Object.values(positions).forEach((position) => { position.average_cost = position.cost_complete && position.shares > 0 ? position.cost_total / position.shares : null; position.current_allocation = total > 0 ? (position.current_value / total) * 100 : 0; delete position.cost_total; delete position.cost_complete; });
  return { complete: true, currency: "USD", available_cash: cash, available_cash_provided: true, positions, source: "snaptrade_automatic", source_as_of: snapshot?.positions_as_of || null, total_stock_value: stockTotal, total_portfolio_value: total, cash_percentage: total > 0 ? cash / total * 100 : 0, equity_exposure_percentage: total > 0 ? stockTotal / total * 100 : 0, warnings: [] };
}

export const NORMALIZER_VERSION = "snaptrade-normalizer-v1";
