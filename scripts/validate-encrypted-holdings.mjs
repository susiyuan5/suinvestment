import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateEnvelope } from "./encrypted-holdings-snapshot.mjs";

const filePath = path.resolve(process.env.HOLDINGS_OUTPUT || "data/private/wealthsimple-holdings.enc.json");
const envelope = JSON.parse(await readFile(filePath, "utf8"));
if (!validateEnvelope(envelope)) throw new Error("加密持仓快照外层 schema 无效");
const iv = Buffer.from(envelope.iv_base64, "base64");
const ciphertext = Buffer.from(envelope.ciphertext_base64, "base64");
if (iv.length !== 12 || ciphertext.length <= 16) throw new Error("加密快照 IV 或密文长度无效");
if (crypto.createHash("sha256").update(ciphertext).digest("hex") !== envelope.ciphertext_hash) throw new Error("加密快照 hash 校验失败");
for (const field of ["accounts", "holdings", "positions", "balances", "consumer_key", "client_id", "user_id", "user_secret"]) {
  if (Object.prototype.hasOwnProperty.call(envelope, field)) throw new Error(`加密快照不得包含明文字段: ${field}`);
}
console.log(JSON.stringify({ valid: true, schema_version: envelope.schema_version, generated_at: envelope.generated_at }, null, 2));
