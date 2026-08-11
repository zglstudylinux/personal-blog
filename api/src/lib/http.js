/* ============================================================
   lib/http.js - HTTP 工具：响应、CORS/Origin 校验、频率限制
   CORS 头由 worker.js 的 withCors() 统一附加，这里不重复处理。
   ============================================================ */

export function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function err(msg, status) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: status || 500,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

// Origin 校验：写接口必须来自白名单来源
export function requireOrigin(request, env) {
  const origin = request.headers.get("origin");
  const allowed = [env.SITE_ORIGIN, env.LOCAL_ORIGIN].filter(Boolean);
  // 同源请求可能没有 Origin 头，但浏览器 POST/PUT 一般会带；这里宽松允许空 Origin 的 GET
  if (request.method === "GET" && !origin) return true;
  if (!origin) return false;
  return allowed.indexOf(origin) !== -1;
}

// 简单的内存频率限制：每个 IP 在窗口内最多 N 次。
// 注意 Worker 实例间不共享内存，这只是基础防护。生产可用 KV/DO。
const BUCKET = new Map(); // ip -> [{ts}]
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

export async function rateLimit(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "anon";
  const now = Date.now();
  let arr = BUCKET.get(ip);
  if (!arr) { arr = []; BUCKET.set(ip, arr); }
  arr.push(now);
  // 清理过期
  while (arr.length && now - arr[0] > WINDOW_MS) arr.shift();
  // 防止 Map 无限增长（粗略上限）
  if (BUCKET.size > 5000) BUCKET.clear();
  return arr.length > MAX_PER_WINDOW;
}

export function safeMethod(m) {
  return ["GET", "POST", "HEAD", "OPTIONS"].indexOf(m) !== -1;
}
