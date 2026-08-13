import crypto from "node:crypto";

const key = crypto.randomBytes(32).toString("base64");
process.stdout.write(`HOLDINGS_SNAPSHOT_KEY=${key}\n`);
process.stdout.write("请立即复制到 GitHub Secret 和私人电脑设置；不要提交、截图或写入日志。\n");
