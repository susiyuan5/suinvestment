const WORKFLOWS = Object.freeze({
  today: "update-short-term-signals.yml",
  universe: "update-idea-engine.yml"
});
const MAX_BODY = 256;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== (env.ALLOWED_ORIGIN || "")) return json({ error: "origin_not_allowed" }, 403, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST" && request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin);
    const match = new URL(request.url).pathname.match(/^\/refresh\/(today|universe)(?:\/status)?$/);
    if (!match) return json({ error: "route_not_allowed" }, 404, origin);
    if (!constantTimeEqual(request.headers.get("Authorization") || "", `Bearer ${env.REFRESH_ACCESS_SECRET || ""}`)) return json({ error: "unauthorized" }, 401, origin);
    if (request.method === "POST" && (await request.text()).length > MAX_BODY) return json({ error: "input_too_large" }, 413, origin);
    const workflow = WORKFLOWS[match[1]];
    const base = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflow}`;
    try {
      const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "suinvestment-refresh-gateway" };
      if (request.method === "POST") {
        const response = await fetch(`${base}/dispatches`, { method: "POST", headers, body: JSON.stringify({ ref: "main" }) });
        if (!response.ok) return json({ error: "workflow_dispatch_failed" }, 502, origin);
        return json({ status: "queued", workflow: match[1] }, 202, origin);
      }
      const response = await fetch(`${base}/runs?per_page=1`, { headers });
      if (!response.ok) return json({ error: "workflow_status_unavailable" }, 502, origin);
      const payload = await response.json(); const run = payload.workflow_runs && payload.workflow_runs[0];
      return json({ status: run ? run.status : "unknown", conclusion: run ? run.conclusion : null, run_id: run ? run.id : null, html_url: run ? run.html_url : null }, 200, origin);
    } catch (_error) { return json({ error: "gateway_unavailable" }, 502, origin); }
  }
};

function constantTimeEqual(left, right) { if (!left || left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0; }
function cors(origin) { return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" }; }
function json(payload, status, origin) { return new Response(JSON.stringify(payload), { status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
