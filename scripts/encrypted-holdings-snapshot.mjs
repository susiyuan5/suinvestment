import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const ENCRYPTED_SNAPSHOT_SCHEMA = "wealthsimple-holdings-encrypted-v1";

export function decodeSnapshotKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}={1}$/.test(value)) throw new Error("HOLDINGS_SNAPSHOT_KEY 必须是 32 字节 Base64 密钥");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("HOLDINGS_SNAPSHOT_KEY 必须是 32 字节 Base64 密钥");
  return key;
}

export function encryptSnapshot(payload, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : decodeSnapshotKey(keyValue);
  if (key.length !== 32) throw new Error("AES-256-GCM 密钥长度无效");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(ENCRYPTED_SNAPSHOT_SCHEMA, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final(), cipher.getAuthTag()]);
  return {
    schema_version: ENCRYPTED_SNAPSHOT_SCHEMA,
    algorithm: "AES-256-GCM",
    generated_at: new Date().toISOString(),
    iv_base64: iv.toString("base64"),
    ciphertext_base64: ciphertext.toString("base64"),
    ciphertext_hash: crypto.createHash("sha256").update(ciphertext).digest("hex"),
  };
}

export function decryptSnapshot(envelope, keyValue) {
  if (!validateEnvelope(envelope)) throw new Error("加密持仓快照外层 schema 无效");
  const key = Buffer.isBuffer(keyValue) ? keyValue : decodeSnapshotKey(keyValue);
  const iv = Buffer.from(envelope.iv_base64, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext_base64, "base64");
  if (iv.length !== 12 || crypto.createHash("sha256").update(ciphertext).digest("hex") !== envelope.ciphertext_hash) throw new Error("加密持仓快照校验失败");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(ENCRYPTED_SNAPSHOT_SCHEMA, "utf8"));
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}

export function validateEnvelope(value) {
  return Boolean(value && value.schema_version === ENCRYPTED_SNAPSHOT_SCHEMA && value.algorithm === "AES-256-GCM" && typeof value.generated_at === "string" && typeof value.iv_base64 === "string" && typeof value.ciphertext_base64 === "string" && /^[a-f0-9]{64}$/.test(String(value.ciphertext_hash || "")));
}

export async function writeEncryptedSnapshotAtomic(outputPath, envelope) {
  if (!validateEnvelope(envelope)) throw new Error("拒绝写入无效加密快照");
  const absolute = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try { await fs.rename(temporary, absolute); } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}
