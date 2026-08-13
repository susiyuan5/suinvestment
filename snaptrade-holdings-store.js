(function (root) {
  "use strict";
  var DB_NAME = "suinvestment-snaptrade-readonly-v1";
  var STORE_NAME = "keys";
  var KEY_NAME = "holdings-snapshot-key";
  var ENVELOPE_URL = "data/private/wealthsimple-holdings.enc.json";
  var memoryKey = null;

  function base64ToBytes(value) { var binary = atob(value); var bytes = new Uint8Array(binary.length); for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return bytes; }
  function bytesToText(bytes) { return new TextDecoder().decode(bytes); }
  function validBase64Key(value) { return typeof value === "string" && /^[A-Za-z0-9+/]{43}={1}$/.test(value) && base64ToBytes(value).length === 32; }
  function openDb() { return new Promise(function (resolve, reject) { if (!root.indexedDB) return reject(new Error("当前浏览器不支持 IndexedDB")); var request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = function () { request.result.createObjectStore(STORE_NAME); }; request.onsuccess = function () { resolve(request.result); }; request.onerror = function () { reject(request.error || new Error("IndexedDB 打开失败")); }; }); }
  async function getStoredKey() { try { var db = await openDb(); return await new Promise(function (resolve, reject) { var request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(KEY_NAME); request.onsuccess = function () { resolve(request.result || null); }; request.onerror = function () { reject(request.error); }; }); } catch (_) { return null; } }
  async function storeKey(key) { var db = await openDb(); return new Promise(function (resolve, reject) { var request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(key, KEY_NAME); request.onsuccess = function () { resolve(true); }; request.onerror = function () { reject(request.error); }; }); }
  async function forgetKey() { memoryKey = null; try { var db = await openDb(); await new Promise(function (resolve, reject) { var request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(KEY_NAME); request.onsuccess = resolve; request.onerror = function () { reject(request.error); }; }); } catch (_) {} }
  async function importKey(value) { if (!validBase64Key(value)) throw new Error("请提供合法的 32 字节 Base64 密钥"); var key = await crypto.subtle.importKey("raw", base64ToBytes(value), { name: "AES-GCM" }, false, ["decrypt"]); memoryKey = key; try { await storeKey(key); } catch (_) {} return key; }
  async function loadEnvelope() { var response = await fetch(ENVELOPE_URL, { cache: "no-cache" }); if (!response.ok) throw new Error("加密持仓快照尚未发布"); var envelope = await response.json(); if (envelope.schema_version !== "wealthsimple-holdings-encrypted-v1" || envelope.algorithm !== "AES-256-GCM") throw new Error("加密持仓快照 schema 无效"); return envelope; }
  async function decryptEnvelope(envelope, key) { var cipher = base64ToBytes(envelope.ciphertext_base64); var hash = await crypto.subtle.digest("SHA-256", cipher); var hashHex = Array.from(new Uint8Array(hash)).map(function (item) { return item.toString(16).padStart(2, "0"); }).join(""); if (hashHex !== envelope.ciphertext_hash) throw new Error("加密快照完整性校验失败"); var plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv_base64), additionalData: new TextEncoder().encode("wealthsimple-holdings-encrypted-v1") }, key, cipher); return JSON.parse(bytesToText(new Uint8Array(plaintext))); }
  async function unlock(value) { var key = await importKey(value); var envelope = await loadEnvelope(); var snapshot = await decryptEnvelope(envelope, key); if (!snapshot || snapshot.schema_version !== "wealthsimple-holdings-v1" || !Array.isArray(snapshot.accounts) || !Array.isArray(snapshot.holdings)) throw new Error("持仓数据 schema 无效"); return snapshot; }
  async function load() { var key = memoryKey || await getStoredKey(); if (!key) return { status: "locked", snapshot: null }; try { var envelope = await loadEnvelope(); var snapshot = await decryptEnvelope(envelope, key); return { status: "ready", snapshot: snapshot, envelope: envelope }; } catch (error) { return { status: "error", snapshot: null, error: error }; } }
  root.SnaptradeHoldingsStore = Object.freeze({ importKey: importKey, unlock: unlock, load: load, forgetKey: forgetKey, validBase64Key: validBase64Key });
})(typeof globalThis !== "undefined" ? globalThis : this);
