(function (root) {
  "use strict";
  var DB_NAME = "suinvestment-snaptrade-readonly-v1", DB_VERSION = 2, STORE_NAME = "keys", KEY_NAME = "holdings-snapshot-key";
  var ENVELOPE_URL = "data/private/wealthsimple-holdings.enc.json", ENVELOPE_SCHEMA = "wealthsimple-holdings-encrypted-v1", SNAPSHOT_SCHEMA = "wealthsimple-holdings-v1";
  var memoryKey = null;

  function base64ToBytes(value) {
    if (typeof value !== "string") throw new Error("密钥格式无效");
    var binary;
    try { binary = atob(value); } catch (_) { throw new Error("密钥格式无效"); }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function validateBase64Key(value) { if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}={1}$/.test(value)) return false; try { return base64ToBytes(value).length === 32; } catch (_) { return false; } }
  function bytesToText(bytes) { return new TextDecoder().decode(bytes); }
  function hex(bytes) { return Array.from(new Uint8Array(bytes)).map(function (item) { return item.toString(16).padStart(2, "0"); }).join(""); }
  function validDate(value) { var time = Date.parse(value || ""); return Number.isFinite(time) && time <= Date.now() + 5 * 60 * 1000; }
  function isCryptoKey(value) { return value && value.constructor && value.constructor.name === "CryptoKey"; }
  function isStoredCryptoKey(value) { return isCryptoKey(value) && value.algorithm && value.algorithm.name === "AES-GCM" && value.extractable === false && Array.isArray(value.usages) && value.usages.indexOf("decrypt") >= 0; }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error("IndexedDB 不可用"));
      var request;
      try { request = root.indexedDB.open(DB_NAME, DB_VERSION); } catch (error) { return reject(error); }
      request.onupgradeneeded = function () { var db = request.result; if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME); };
      request.onblocked = function () { reject(new Error("IndexedDB 被其他页面占用，请关闭旧页面后重试")); };
      request.onerror = function () { reject(request.error || new Error("IndexedDB 打开失败")); };
      request.onsuccess = function () { var db = request.result; db.onversionchange = function () { db.close(); }; resolve(db); };
    });
  }
  function closeDb(db) { if (db && typeof db.close === "function") db.close(); }
  function transaction(db, mode, action) {
    return new Promise(function (resolve, reject) {
      var tx, result, settled = false;
      try {
        tx = db.transaction(STORE_NAME, mode);
        tx.onabort = function () { if (!settled) { settled = true; reject(tx.error || new Error("IndexedDB 事务中止")); } };
        tx.onerror = function () { if (!settled) { settled = true; reject(tx.error || new Error("IndexedDB 事务失败")); } };
        tx.oncomplete = function () { if (!settled) { settled = true; resolve(result); } };
        var request = action(tx.objectStore(STORE_NAME));
        request.onsuccess = function () { result = request.result; };
        request.onerror = function () { if (!settled) { settled = true; reject(request.error || new Error("IndexedDB 请求失败")); } };
      } catch (error) { if (!settled) { settled = true; reject(error); } }
    });
  }
  async function readStoredKey() { var db = await openDb(); try { return await transaction(db, "readonly", function (store) { return store.get(KEY_NAME); }); } finally { closeDb(db); } }
  async function verifyPersistedKey() { var key = await readStoredKey(); if (key === undefined || key === null) throw new Error("本机没有保存密钥"); if (!isStoredCryptoKey(key)) throw new Error("IndexedDB 未能回读有效 CryptoKey"); return key; }
  async function persistValidatedKey(key) {
    if (!isStoredCryptoKey(key)) throw new Error("拒绝保存未验证的本机密钥");
    var db = await openDb();
    try { await transaction(db, "readwrite", function (store) { return store.put(key, KEY_NAME); }); } finally { closeDb(db); }
    return verifyPersistedKey();
  }
  async function deleteStoredKey() {
    var db = await openDb();
    try { await transaction(db, "readwrite", function (store) { return store.delete(KEY_NAME); }); } finally { closeDb(db); }
    var remaining = await readStoredKey();
    if (remaining !== undefined && remaining !== null) throw new Error("本机密钥删除确认失败");
  }
  async function requestPersistentStorage() {
    if (!root.navigator || !root.navigator.storage) return { status: "saved_indexeddb", supported: false };
    try {
      if (typeof root.navigator.storage.persisted === "function" && await root.navigator.storage.persisted()) return { status: "persistent", supported: true };
      if (typeof root.navigator.storage.persist === "function" && await root.navigator.storage.persist()) return { status: "persistent", supported: true };
      return { status: "saved_may_clear", supported: true };
    } catch (_) { return { status: "saved_may_clear", supported: true }; }
  }
  async function currentPersistenceStatus() {
    if (!root.navigator || !root.navigator.storage || typeof root.navigator.storage.persisted !== "function") return "saved_indexeddb";
    try { return await root.navigator.storage.persisted() ? "persistent" : "saved_may_clear"; } catch (_) { return "saved_may_clear"; }
  }
  async function importNonExtractableKey(value) { if (!validateBase64Key(value)) throw new Error("请提供合法的 32 字节 Base64 密钥"); return root.crypto.subtle.importKey("raw", base64ToBytes(value), { name: "AES-GCM" }, false, ["decrypt"]); }
  async function loadEncryptedEnvelope() {
    var response = await root.fetch(ENVELOPE_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error("加密持仓快照尚未发布");
    var envelope = await response.json();
    if (!envelope || envelope.schema_version !== ENVELOPE_SCHEMA || envelope.algorithm !== "AES-256-GCM") throw new Error("加密持仓快照 schema 无效");
    if (!validDate(envelope.generated_at)) throw new Error("加密持仓快照时间无效");
    return envelope;
  }
  async function decryptAndValidateEnvelope(envelope, key) {
    if (!isStoredCryptoKey(key)) throw new Error("本机密钥不可用于解密");
    var cipher = base64ToBytes(envelope.ciphertext_base64), iv = base64ToBytes(envelope.iv_base64);
    if (iv.length !== 12 || cipher.length < 17) throw new Error("加密快照字段无效");
    var digest = await root.crypto.subtle.digest("SHA-256", cipher);
    if (hex(digest) !== String(envelope.ciphertext_hash || "").toLowerCase()) throw new Error("加密快照完整性校验失败");
    var plaintext;
    try { plaintext = await root.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv, additionalData: new TextEncoder().encode(ENVELOPE_SCHEMA) }, key, cipher); } catch (_) { throw new Error("密钥与加密快照不匹配"); }
    var snapshot;
    try { snapshot = JSON.parse(bytesToText(new Uint8Array(plaintext))); } catch (_) { throw new Error("解密后的持仓数据无效"); }
    if (!snapshot || snapshot.schema_version !== SNAPSHOT_SCHEMA || !Array.isArray(snapshot.accounts) || !Array.isArray(snapshot.holdings)) throw new Error("持仓数据 schema 无效");
    if (!validDate(snapshot.generated_at) || (snapshot.positions_as_of && !validDate(snapshot.positions_as_of))) throw new Error("持仓数据时间无效");
    return snapshot;
  }
  async function unlock(value) {
    var key = await importNonExtractableKey(value), envelope = await loadEncryptedEnvelope(), snapshot = await decryptAndValidateEnvelope(envelope, key);
    memoryKey = key;
    var persistence = { status: "session_only", error: null };
    try { await persistValidatedKey(key); persistence = await requestPersistentStorage(); } catch (error) { persistence.error = error; }
    return { snapshot: snapshot, envelope: envelope, persistence: persistence };
  }
  async function autoUnlockFromStoredKey() {
    var key;
    try { key = await verifyPersistedKey(); } catch (error) { var message = String(error.message || error); return { status: message === "本机没有保存密钥" ? "locked" : /IndexedDB|存储|事务|回读|打开/.test(message) ? "idb_unavailable" : "error", snapshot: null, error: error }; }
    try { var envelope = await loadEncryptedEnvelope(), snapshot = await decryptAndValidateEnvelope(envelope, key); memoryKey = key; return { status: "ready", snapshot: snapshot, envelope: envelope, persistence: await currentPersistenceStatus(), autoUnlockedAt: new Date().toISOString() }; } catch (error) { return { status: "error", snapshot: null, error: error, persistence: await currentPersistenceStatus() }; }
  }
  async function forgetStoredKey() { memoryKey = null; await deleteStoredKey(); return true; }
  root.SnaptradeHoldingsStore = Object.freeze({ validateBase64Key: validateBase64Key, validBase64Key: validateBase64Key, importNonExtractableKey: importNonExtractableKey, importKey: importNonExtractableKey, loadEncryptedEnvelope: loadEncryptedEnvelope, decryptAndValidateEnvelope: decryptAndValidateEnvelope, persistValidatedKey: persistValidatedKey, verifyPersistedKey: verifyPersistedKey, autoUnlockFromStoredKey: autoUnlockFromStoredKey, forgetStoredKey: forgetStoredKey, forgetKey: forgetStoredKey, unlock: unlock, load: autoUnlockFromStoredKey, isStoredCryptoKey: isStoredCryptoKey });
})(typeof globalThis !== "undefined" ? globalThis : this);
