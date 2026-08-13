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
  const instrument = position?.instrument || {};
  const kind = typeof instrument.kind === "string" ? instrument.kind.toLowerCase() : "other";
  const unitsRaw = instrument.units ?? position?.units ?? null;
  const priceRaw = instrument.price ?? position?.price ?? null;
  const costBasisRaw = instrument.cost_basis ?? position?.cost_basis ?? null;
  const positionCurrency = instrument.currency || position?.currency || null;
  const marketValueRaw = position?.market_value ?? position?.marketValue ?? null;
  const cashEquivalent = position?.cash_equivalent === true || instrument.cash_equivalent === true;
  return {
    symbol: instrument.symbol || position?.symbol || null,
    raw_symbol: instrument.raw_symbol || position?.raw_symbol || null,
    description: instrument.description || position?.description || null,
    instrument_kind: kind,
    exchange: instrument.exchange || position?.exchange || null,
    listing_currency: instrument.currency || null,
    units: finiteDecimal(unitsRaw),
    units_raw: unitsRaw === null || unitsRaw === undefined ? null : String(unitsRaw),
    price: finiteDecimal(priceRaw),
    price_raw: priceRaw === null || priceRaw === undefined ? null : String(priceRaw),
    cost_basis: finiteDecimal(costBasisRaw),
    cost_basis_raw: costBasisRaw === null || costBasisRaw === undefined ? null : String(costBasisRaw),
    position_currency: positionCurrency,
    market_value: finiteDecimal(marketValueRaw),
    data_as_of: iso(position?.data_as_of || position?.as_of || instrument?.as_of),
    cash_equivalent: cashEquivalent,
    included_in_stock_plan: INVESTMENT_KINDS.has(kind) && !cashEquivalent,
  };
}

export function normalizeAccount(account, details = {}, positions = {}, balances = []) {
  const sync = account?.sync_status || {};
  const holdingsSync = sync.holdings || {};
  const rawPositions = Array.isArray(positions?.results) ? positions.results : Array.isArray(positions) ? positions : [];
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
    holdings_as_of: iso(holdingsSync.last_successful_sync),
    balances: rawBalances.map(normalizeBalance),
    positions: rawPositions.map(normalizePosition),
  };
}

export function normalizeSnapshot({ connections = [], accounts = [], accountDetails = new Map(), positions = new Map(), balances = new Map(), generatedAt = new Date().toISOString() }) {
  const eligible = connections.filter(isEligibleReadOnlyConnection).map(normalizeConnection);
  const eligibleIds = new Set(eligible.map((item) => item.id).filter(Boolean));
  const normalizedAccounts = accounts
    .filter((account) => eligibleIds.has(typeof account?.brokerage_authorization === "string" ? account.brokerage_authorization : account?.brokerage_authorization?.id))
    .map((account) => normalizeAccount(account, accountDetails.get(account.id), positions.get(account.id), balances.get(account.id)));
  return {
    schema_version: "wealthsimple-holdings-v1",
    generated_at: generatedAt,
    positions_as_of: normalizedAccounts.map((account) => account.holdings_as_of).filter(Boolean).sort()[0] || null,
    source: "snaptrade_personal_readonly",
    institution: "Wealthsimple",
    connections: eligible.map(({ raw, ...connection }) => connection),
    accounts: normalizedAccounts,
    holdings: normalizedAccounts.flatMap((account) => account.positions.map((position) => ({ ...position, internal_account_id: account.internal_account_id, account_name: account.account_name }))),
    status: eligible.length && normalizedAccounts.length ? "healthy" : eligible.length ? "warning" : "blocked",
    warnings: eligible.length ? [] : ["没有可用的 Wealthsimple 只读连接"],
  };
}

export function portfolioRiskFromSnapshot(snapshot) {
  const holdings = (snapshot?.holdings || []).filter((item) => item.included_in_stock_plan && item.market_value !== null);
  const total = holdings.reduce((sum, item) => sum + item.market_value, 0) + (snapshot?.accounts || []).flatMap((account) => account.balances || []).reduce((sum, balance) => sum + (balance.cash || 0), 0);
  const positions = {};
  holdings.forEach((item) => {
    if (!item.symbol) return;
    const current = positions[item.symbol] || { current_value: 0, shares: 0, average_cost: null, currency: item.position_currency };
    current.current_value += item.market_value || 0;
    current.shares += item.units || 0;
    if (current.average_cost === null && item.cost_basis !== null) current.average_cost = item.cost_basis;
    positions[item.symbol] = current;
  });
  Object.values(positions).forEach((position) => { position.current_allocation = total > 0 ? (position.current_value / total) * 100 : 0; });
  return { available_cash: (snapshot?.accounts || []).flatMap((account) => account.balances || []).reduce((sum, balance) => sum + (balance.cash || 0), 0), available_cash_provided: true, positions, source: "snaptrade_automatic", source_as_of: snapshot?.generated_at || null, total_portfolio_value: total };
}

export const NORMALIZER_VERSION = "snaptrade-normalizer-v1";
