(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./dip-strategy")
      : root.DipStrategy,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DipLedger = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (S) {
  "use strict";
  const version = 1,
    money = S.money,
    clone = (x) => JSON.parse(JSON.stringify(x));
  function blank() {
    return { version, entries: [] };
  }
  function summary(book, at) {
    validate(book);
    const w = S.week(at),
      month = S.day(at).slice(0, 7),
      reversed = new Set(
        book.entries
          .filter((e) => e.type === "reversal")
          .map((e) => e.originalId),
      );
    let balance = 0,
      weekSpent = 0,
      monthAdded = 0;
    const bySymbol = {};
    let blocked = false;
    for (const e of book.entries) {
      if (e.type === "deposit") {
        balance += e.amountUSD;
        if (e.month === month) monthAdded += e.amountUSD;
      }
      if (e.type === "buy" && !reversed.has(e.id)) {
        balance -= e.amountUSD;
        if (e.anomaly) blocked = true;
        if (e.week === w) {
          weekSpent += e.amountUSD;
          bySymbol[e.symbol] = money((bySymbol[e.symbol] || 0) + e.amountUSD);
        }
      }
    }
    const weekLimit = book.entries.find(
      (e) => e.type === "week" && e.week === w,
    )?.limitUSD;
    return {
      balance: money(balance),
      weekSpent: money(weekSpent),
      bySymbol,
      monthAdded,
      weekLimit,
      blocked:
        blocked || balance < 0 || weekSpent > (weekLimit ?? Infinity) + 0.001,
      week: w,
    };
  }
  function validate(book) {
    if (!book || book.version !== version || !Array.isArray(book.entries))
      throw Error("LEDGER_VERSION_INVALID");
    const ids = new Set(),
      months = new Set(),
      weeks = new Set(),
      buys = new Map(),
      reversed = new Set(),
      limits = new Map(),
      spent = new Map(),
      symbolSpent = new Map(),
      anomalies = new Set();
    let activation,
      balance = 0;
    for (const e of book.entries) {
      if (
        !e ||
        typeof e.id !== "string" ||
        ids.has(e.id) ||
        !Number.isFinite(Date.parse(e.at))
      )
        throw Error("LEDGER_ENTRY_INVALID");
      ids.add(e.id);
      if (e.type === "activation") {
        if (activation || ids.size !== 1 || e.month !== S.day(e.at).slice(0, 7))
          throw Error("DUPLICATE_ACTIVATION");
        activation = e;
      } else if (e.type === "deposit") {
        if (
          e.amountUSD !== 100 ||
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(e.month) ||
          months.has(e.month) ||
          !activation ||
          e.month < activation.month ||
          e.month > S.day(e.at).slice(0, 7)
        )
          throw Error("DEPOSIT_INVALID");
        months.add(e.month);
        balance += 100;
      } else if (e.type === "week") {
        const expected =
          Math.floor(Math.max(0, Math.min(50, balance * 0.25)) * 100 + 1e-8) /
          100;
        if (
          e.week !== S.week(e.at) ||
          weeks.has(e.week) ||
          e.limitUSD !== expected
        )
          throw Error("WEEK_INVALID");
        weeks.add(e.week);
        limits.set(e.week, e.limitUSD);
      } else if (e.type === "buy") {
        if (
          !S.symbols.includes(e.symbol) ||
          !Number.isFinite(e.amountUSD) ||
          e.amountUSD <= 0 ||
          !Number.isFinite(e.quantity) ||
          e.quantity <= 0 ||
          !Number.isFinite(e.price) ||
          e.price <= 0 ||
          !["USD", "CAD"].includes(e.accountCurrency) ||
          !Number.isFinite(e.accountDebit) ||
          e.accountDebit <= 0 ||
          !Number.isFinite(e.fxFee) ||
          e.fxFee < 0 ||
          e.fxFee > e.accountDebit ||
          e.week !== S.week(e.tradeAt) ||
          !Number.isFinite(Date.parse(e.tradeAt)) ||
          !weeks.has(e.week)
        )
          throw Error("BUY_INVALID");
        if (
          e.accountCurrency === "CAD" &&
          (!Number.isFinite(e.fxRate) || e.fxRate <= 0)
        )
          throw Error("FX_INVALID");
        if (
          Math.abs(
            e.amountUSD -
              money(
                e.accountDebit / (e.accountCurrency === "CAD" ? e.fxRate : 1),
              ),
          ) > 0.001
        )
          throw Error("DEBIT_MISMATCH");
        if (
          Math.abs(
            e.quantity *
              e.price *
              (e.accountCurrency === "CAD" ? e.fxRate : 1) +
              e.fxFee +
              (e.commissionFee || 0) -
              e.accountDebit,
          ) > 0.021
        )
          throw Error("EXECUTION_TOTAL_MISMATCH");
        if (Date.parse(e.tradeAt) > Date.parse(e.at))
          throw Error("TRADE_DATE_INVALID");
        const key = e.week + ":" + e.symbol,
          used = spent.get(e.week) || 0,
          usedSymbol = symbolSpent.get(key) || 0;
        const cap =
          limits.get(e.week) *
          (["SPY", "QQQ"].includes(e.symbol)
            ? e.tier === "10-15"
              ? 0.25
              : 0.5
            : 0.25);
        const expectedAnomaly =
          anomalies.size > 0 ||
          balance < 0 ||
          e.amountUSD > balance + 0.001 ||
          e.amountUSD + used > limits.get(e.week) + 0.001 ||
          e.amountUSD + usedSymbol > cap + 0.001;
        if (e.anomaly !== expectedAnomaly) throw Error("ANOMALY_FLAG_INVALID");
        balance = money(balance - e.amountUSD);
        spent.set(e.week, money(used + e.amountUSD));
        symbolSpent.set(key, money(usedSymbol + e.amountUSD));
        if (e.anomaly) anomalies.add(e.id);
        buys.set(e.id, e);
      } else if (e.type === "reversal") {
        if (!buys.has(e.originalId) || reversed.has(e.originalId))
          throw Error("REVERSAL_INVALID");
        reversed.add(e.originalId);
        const old = buys.get(e.originalId),
          key = old.week + ":" + old.symbol;
        balance = money(balance + old.amountUSD);
        spent.set(old.week, money(spent.get(old.week) - old.amountUSD));
        symbolSpent.set(key, money(symbolSpent.get(key) - old.amountUSD));
        anomalies.delete(old.id);
      } else throw Error("ENTRY_TYPE_INVALID");
    }
    if (book.entries.length && !activation) throw Error("ACTIVATION_MISSING");
    return true;
  }
  function ensure(book, at) {
    validate(book);
    const b = clone(book),
      date = S.day(at),
      stamp = new Date(at).toISOString();
    if (!b.entries.length)
      b.entries.push({
        id: "activation",
        type: "activation",
        at: stamp,
        month: date.slice(0, 7),
      });
    let month = b.entries[0].month;
    const end = date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month) || month > end)
      throw Error("LEDGER_CLOCK_INVALID");
    for (let n = 0; month <= end; n++) {
      if (n > 1200) throw Error("LEDGER_DATE_RANGE_INVALID");
      if (!b.entries.some((e) => e.type === "deposit" && e.month === month))
        b.entries.push({
          id: "deposit:" + month,
          type: "deposit",
          month,
          amountUSD: 100,
          at: stamp,
        });
      const [y, m] = month.split("-").map(Number);
      month = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    }
    const w = S.week(at);
    if (!b.entries.some((e) => e.type === "week" && e.week === w))
      b.entries.push({
        id: "week:" + w,
        type: "week",
        week: w,
        limitUSD:
          Math.floor(
            Math.max(0, Math.min(50, summary(b, at).balance * 0.25)) * 100 +
              1e-8,
          ) / 100,
        at: stamp,
      });
    return b;
  }
  function buy(book, input, at) {
    let b = ensure(book, at);
    if (b.entries.some((e) => e.id === input.id)) {
      const old = b.entries.find((e) => e.id === input.id);
      if (
        old.type !== "buy" ||
        [
          "symbol",
          "quantity",
          "price",
          "accountCurrency",
          "accountDebit",
          "fxFee",
          "tradeAt",
        ].some((k) => old[k] !== input[k])
      )
        throw Error("ID_CONFLICT");
      return b;
    }
    if (
      !input.id ||
      !Number.isFinite(Date.parse(input.tradeAt)) ||
      Date.parse(input.tradeAt) > new Date(at).getTime()
    )
      throw Error("TRADE_DATE_INVALID");
    const w = S.week(input.tradeAt);
    if (!b.entries.some((e) => e.type === "week" && e.week === w))
      throw Error("HISTORICAL_WEEK_NOT_INITIALIZED");
    const snapshot = summary(b, input.tradeAt),
      amountUSD = money(
        input.accountDebit /
          (input.accountCurrency === "CAD" ? input.fxRate : 1),
      );
    const cap =
      snapshot.weekLimit *
      (["SPY", "QQQ"].includes(input.symbol)
        ? input.tier === "10-15"
          ? 0.25
          : 0.5
        : 0.25);
    const anomaly =
      snapshot.blocked ||
      amountUSD > summary(b, at).balance + 0.001 ||
      amountUSD + snapshot.weekSpent > snapshot.weekLimit + 0.001 ||
      amountUSD + (snapshot.bySymbol[input.symbol] || 0) > cap + 0.001;
    b.entries.push({
      ...input,
      id: input.id,
      type: "buy",
      at: new Date(at).toISOString(),
      week: w,
      amountUSD,
      anomaly,
    });
    validate(b);
    return b;
  }
  function reverse(book, id, at) {
    const b = ensure(book, at);
    if (b.entries.some((e) => e.type === "reversal" && e.originalId === id))
      return b;
    b.entries.push({
      id: "reversal:" + id,
      type: "reversal",
      originalId: id,
      at: new Date(at).toISOString(),
    });
    validate(b);
    return b;
  }
  function open(indexedDB) {
    return new Promise((resolve, reject) => {
      if (!indexedDB) {
        reject(Error("INDEXEDDB_UNAVAILABLE"));
        return;
      }
      const req = indexedDB.open("su-investment-independent-dip", version);
      req.onupgradeneeded = () => req.result.createObjectStore("ledger");
      req.onsuccess = () => {
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(Error("LEDGER_UPGRADE_BLOCKED"));
    });
  }
  async function transact(indexedDB, update) {
    const db = await open(indexedDB);
    return new Promise((resolve, reject) => {
      const tx = db.transaction("ledger", "readwrite"),
        store = tx.objectStore("ledger"),
        req = store.get("book");
      let result;
      req.onsuccess = () => {
        try {
          result = update(req.result || blank());
          validate(result);
          store.put(result, "book");
        } catch (e) {
          reject(e);
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error || Error("LEDGER_TRANSACTION_ABORTED"));
      };
    });
  }
  function restore(current, incoming) {
    validate(current);
    validate(incoming);
    if (
      !current.entries.some((e) => e.type === "buy") &&
      incoming.entries.length
    )
      return clone(incoming);
    const map = new Map(incoming.entries.map((e) => [e.id, e]));
    for (const e of current.entries) {
      if (!map.has(e.id) || JSON.stringify(map.get(e.id)) !== JSON.stringify(e))
        throw Error("RESTORE_WOULD_REWRITE_HISTORY");
    }
    return clone(incoming);
  }
  return Object.freeze({
    version,
    blank,
    validate,
    summary,
    ensure,
    buy,
    reverse,
    transact,
    restore,
  });
});
