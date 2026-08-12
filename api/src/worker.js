/* ============================================================
   worker.js - 博客后端 API（Cloudflare Worker）
   ------------------------------------------------------------
   职责：
     - GitHub OAuth 登录 / 回调 / 登出 / 当前用户
     - 会话：自签 JWT 放在 HttpOnly + Secure + SameSite=Lax cookie
     - 作者白名单（GitHub 数字 user id）
     - 图片上传：提交到 Git 仓库 assets/images/，Markdown 保存站点根相对路径
     - 发布：服务端校验 → 作者登录后直接写 main 分支（create / update）
       两次 Contents API 调用按「先正文后注册表」顺序，第二步失败返回 partial，
       不伪称成功。不再创建 PR。
   安全铁律（不可违反）：
     - 所有 GitHub 凭据（GH_CLIENT_SECRET / GH_API_TOKEN）只来自 Secret，
       绝不出现在响应、日志或前端可读代码中。
     - 前端只持 HttpOnly 会话 cookie，永远拿不到 PAT。
     - 服务端重新校验 slug/日期/标题/专栏/标签/Markdown，不信任浏览器。
     - 禁止 javascript:/vbscript:/危险 data: 协议；禁止原始 HTML 注入。
     - 只写固定路径（posts/ 与 js/posts.js），拒绝客户端传任意文件路径。
     - Origin / CORS 白名单 + 请求体大小限制 + 基础频率限制。
   ============================================================ */

import { sign, verify } from "./lib/jwt.js";
import {
  json, err, requireOrigin, safeMethod,
  rateLimit
} from "./lib/http.js";
import {
  validatePost, sanitizeMarkdown, slugOk, dateOk
} from "./lib/validate.js";
import { githubLogin, githubExchange, ghApi } from "./lib/github.js";
import { publishPost, deletePost } from "./lib/publish.js";
import { commitImage } from "./lib/images.js";

// ---------- 入口 ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // 所有需要写操作或带凭据的接口都做 Origin 校验和频率限制。
    // 静态 OPTIONS 预检直接放行。
    if (request.method === "OPTIONS") return preflight(request, env);

    // 仅对写接口强制 Origin；GET /api/auth/me 允许跨站携带 cookie 读取
    const writePaths = new Set([
      "/api/auth/login", "/api/auth/callback", "/api/auth/logout",
      "/api/images/upload",
      "/api/posts/validate", "/api/posts/publish",
      "/api/posts/delete"
    ]);
    const originOk = writePaths.has(path) ? requireOrigin(request, env) : true;
    if (!originOk) return err("forbidden origin", 403);

    // 简单的 per-IP 频率限制（Worker 内存，非持久；生产可用 KV/Durable Object 加强）
    const limited = await rateLimit(request, env);
    if (limited) return err("rate limited", 429);

    try {
      const handler = (() => {
        switch (path) {
          case "/api/auth/login":    return handleLogin(request, env);
          case "/api/auth/callback": return handleCallback(request, env, url);
          case "/api/auth/logout":   return handleLogout(request, env);
          case "/api/auth/me":       return handleMe(request, env);
          case "/api/images/upload":  return handleImageUpload(request, env);
          case "/api/posts/validate": return handleValidate(request, env);
          case "/api/posts/publish":  return handlePublish(request, env);
          case "/api/posts/delete":   return handleDelete(request, env);
          case "/":                   return json({ ok: true, service: "blog-api" });
          default: return err("not found", 404);
        }
      })();
      const res = await handler;
      // 给所有响应补上 CORS 头（白名单来源才带 Allow-Origin）
      return withCors(res, request, env);
    } catch (e) {
      // 永不把内部错误堆栈/token 泄露给前端
      console.error("api error", path, e && e.message);
      return withCors(err("internal error", 500), request, env);
    }
  }
};

// 给响应附加 CORS 头。重定向（302）不重复加，避免影响 Location。
function withCors(res, request, env) {
  const origin = request.headers.get("origin");
  const allow = allowedOrigin(origin, env);
  if (!allow) return res;
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", allow);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: headers
  });
}

// ============================================================
// 会话
// ============================================================
const SESSION_COOKIE = "blog_sess";
const SESSION_TTL = 7 * 24 * 60 * 60; // 7 天，秒

async function sessionUser(request, env) {
  const cookies = parseCookies(request);
  const tok = cookies[SESSION_COOKIE];
  if (!tok) return null;
  try {
    const payload = await verify(tok, env.SESSION_SECRET);
    if (!payload || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function setSessionCookie(token, secure) {
  const maxAge = SESSION_TTL;
  // 静态站(github.io)与 Worker(workers.dev)跨站：编辑器用跨站 fetch 读 /api/auth/me，
  // 必须用 SameSite=None;Secure 才能带 cookie；SameSite=Lax 在跨站 fetch 下不会被发送。
  // 本地 dev 全在 localhost（同站），用 Lax 即可，且 http 下 None 无 Secure 会被浏览器拒绝。
  const sameSite = secure ? "None" : "Lax";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAge}` + (secure ? "; Secure" : "");
}

function clearSessionCookie(secure) {
  const sameSite = secure ? "None" : "Lax";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=0` + (secure ? "; Secure" : "");
}

// 本地 wrangler dev 跑在 http://localhost:8787，浏览器不会存带 Secure 的 cookie，
// 必须按 Worker 自身协议决定是否加 Secure。生产 https 才加，本地 http 不加。
function isSecure(request) {
  const u = new URL(request.url);
  return u.protocol === "https:";
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const out = {};
  header.split(";").forEach(function (c) {
    const i = c.indexOf("=");
    if (i > -1) {
      const k = c.slice(0, i).trim();
      const v = c.slice(i + 1).trim();
      if (k) out[k] = v;
    }
  });
  return out;
}

// ============================================================
// GET /api/auth/login -> 跳转 GitHub 授权页
// ============================================================
function handleLogin(request, env) {
  // state 防 CSRF，存 cookie，回调时比对
  const state = randomId(16);
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", env.GH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", buildRedirectUri(request));
  authUrl.searchParams.set("scope", "read:user");
  authUrl.searchParams.set("state", state);
  const sec = isSecure(request);
  // 与 session cookie 同步：跨站场景(生产)用 SameSite=None;Secure，
  // 否则 GitHub OAuth 跳转回来时浏览器不会把 state cookie 带回 Worker。
  const sameSite = sec ? "None" : "Lax";
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": `blog_oauth_state=${state}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=600` + (sec ? "; Secure" : ""),
      "Cache-Control": "no-store"
    }
  });
}

function buildRedirectUri(request) {
  // 用 Worker 自己的域名与协议做回调
  // 本地 wrangler dev 为 http://localhost:8787，生产为 https://<worker-domain>
  const u = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || u.host;
  return u.protocol + "//" + host + "/api/auth/callback";
}

// ============================================================
// GET /api/auth/callback -> 换 token、取 user、签会话
// ============================================================
async function handleCallback(request, env, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(request);
  if (!code || !state || state !== cookies.blog_oauth_state) {
    return err("invalid oauth state", 400);
  }

  // 换 access token
  const token = await githubExchange(env, code, buildRedirectUri(request));
  // 取用户
  const user = await githubLogin(env, token);
  if (!user || !user.id) return err("github user fetch failed", 502);

  // 白名单
  const allowed = String(env.ALLOWED_GH_IDS || "")
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  const isAuthor = allowed.length === 0 ? false : allowed.includes(String(user.id));
  if (!isAuthor) return err("您不在作者白名单中", 403);

  // 签发会话
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(user.id),
    login: user.login,
    name: user.name || "",
    iat: now,
    exp: now + SESSION_TTL
  };
  const jwt = await sign(payload, env.SESSION_SECRET);

  // 跳回静态站点的编辑器
  // 按请求来源决定跳回地址：本地 wrangler dev（host 含 localhost）跳回 LOCAL_ORIGIN，
  // 生产跳回 SITE_ORIGIN。避免生产环境误跳到 localhost。
  const u = new URL(request.url);
  const isLocal = /localhost/i.test(u.host);
  const siteOrigin = isLocal
    ? (env.LOCAL_ORIGIN || env.SITE_ORIGIN)
    : (env.SITE_ORIGIN || "https://zglstudylinux.github.io");
  // 生产静态站部署在 GitHub Pages 子路径 /personal-blog/ 下，回调后必须跳回
  // 带子路径的编辑器，否则会落到 https://zglstudylinux.github.io/editor.html → GitHub 404。
  // 本地 dev 直接在站点根目录服务，无子路径。SITE_ORIGIN 只放 origin（用于 CORS），
  // 子路径单独放 SITE_PATH，避免污染 Origin 白名单比对。
  const sitePath = isLocal ? "" : (env.SITE_PATH || "");
  return new Response(null, {
    status: 302,
    headers: {
      Location: siteOrigin + sitePath + "/editor.html",
      "Set-Cookie": setSessionCookie(jwt, isSecure(request)),
      "Cache-Control": "no-store"
    }
  });
}

// ============================================================
// POST /api/auth/logout
// ============================================================
function handleLogout(request, env) {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookie(isSecure(request)),
      "Cache-Control": "no-store"
    }
  });
}

// ============================================================
// GET /api/auth/me
// ============================================================
async function handleMe(request, env) {
  const u = await sessionUser(request, env);
  if (!u) return json({ login: null });
  return json({ login: u.login, name: u.name, id: u.sub });
}

// ============================================================
// POST /api/images/upload
// body: { type, size, data }
//   data 为 data URL（data:image/png;base64,xxxx）或纯 base64。
// 校验后用 GitHub Contents API 提交到 assets/images/<yyyy>/<mm>/<uuid>.<ext>。
// 返回 { ok, publicUrl }，publicUrl 是站点根相对路径，直接写进 Markdown。
// ============================================================
async function handleImageUpload(request, env) {
  const u = await sessionUser(request, env);
  if (!u) return err("unauthorized", 401);

  // 请求体大小限制（防超大 base64）
  const cl = parseInt(request.headers.get("content-length") || "0", 10);
  // base64 膨胀约 4/3，按图片上限的 2 倍再加余量
  const maxBody = parseInt(env.IMAGE_MAX_BYTES || "5242880", 10) * 3;
  if (cl > maxBody) return err("payload too large", 413);

  let body;
  try { body = await request.json(); } catch (e) { return err("bad json", 400); }

  const res = await commitImage(env, body.type, body.data, body.size);
  if (!res.ok) return err(res.error, res.status);
  return json({ ok: true, publicUrl: res.publicUrl });
}

// ============================================================
// POST /api/posts/validate
// 只做校验，不写仓。可用于发布前 dry-run。
// ============================================================
async function handleValidate(request, env) {
  const u = await sessionUser(request, env);
  if (!u) return err("unauthorized", 401);

  let body;
  try { body = await request.json(); } catch (e) { return err("bad json", 400); }

  const v = validatePost(body);
  if (!v.ok) return json({ ok: false, errors: v.errors }, 422);
  return json({ ok: true });
}

// ============================================================
// POST /api/posts/publish
// body: { slug, title, date, excerpt, category, tags[], content, mode }
//   mode: "create" 新建（slug 必须不存在） / "update" 更新已有文章
// 作者登录后由 Worker 直接写 main 分支，不再创建 PR。
// ============================================================
async function handlePublish(request, env) {
  const u = await sessionUser(request, env);
  if (!u) return err("unauthorized", 401);

  // 请求体大小限制（防超大正文/图片 base64）
  const cl = parseInt(request.headers.get("content-length") || "0", 10);
  if (cl > 2 * 1024 * 1024) return err("payload too large", 413);

  let body;
  try { body = await request.json(); } catch (e) { return err("bad json", 400); }

  const v = validatePost(body);
  if (!v.ok) return json({ ok: false, errors: v.errors }, 422);

  // mode 只接受 create / update，默认 create；服务端最终以远程文件是否存在为准
  const mode = body.mode === "update" ? "update" : "create";

  const result = await publishPost(env, {
    slug: body.slug,
    title: body.title,
    date: body.date,
    excerpt: body.excerpt || "",
    category: body.category || "",
    tags: Array.isArray(body.tags) ? body.tags : [],
    content: body.content
  }, mode, u);

  if (result.ok) {
    return json({
      ok: true,
      mode: result.mode,
      slug: result.slug,
      message: "已直接发布到 main，GitHub Pages 会自动部署，注意有缓存延迟。"
    });
  }
  // 冲突 → 409；部分更新（正文已写、注册表未写）→ 500 但带 partial 标记
  const status = result.conflict ? 409 : (result.partial ? 500 : 502);
  return json({ ok: false, error: result.error, partial: !!result.partial, conflict: !!result.conflict }, status);
}

// ============================================================
// POST /api/posts/delete
// body: { slug }
// 删除已发布文章：先删 js/posts.js 注册表条目，再删 posts/<slug>.md，
// 再删正文中引用的 assets/images/... 图片。非原子，partial 标记各阶段失败。
// ============================================================
async function handleDelete(request, env) {
  const u = await sessionUser(request, env);
  if (!u) return err("unauthorized", 401);

  let body;
  try { body = await request.json(); } catch (e) { return err("bad json", 400); }

  const slug = String(body && body.slug || "").trim();
  if (!slugOk(slug)) return json({ ok: false, errors: ["slug 无效"] }, 422);

  const result = await deletePost(env, slug, u);
  if (result.ok) {
    let message = "已删除文章「" + slug + "」";
    if (result.imagesTotal > 0) {
      if (result.imagesFailed.length === 0) {
        message += "，并清理了 " + result.imagesTotal + " 张图片。";
      } else {
        message += "，正文与注册表已删，但 " + result.imagesFailed.length + "/" + result.imagesTotal + " 张图片未删净，需手动到仓库 assets/images/ 删除。";
      }
    }
    return json({
      ok: true,
      slug: slug,
      imagesTotal: result.imagesTotal || 0,
      imagesFailed: result.imagesFailed || [],
      message: message
    });
  }
  const status = result.conflict ? 409 : (result.partial ? 500 : 502);
  return json({ ok: false, error: result.error, partial: !!result.partial, conflict: !!result.conflict }, status);
}

// ============================================================
// 工具：CORS 预检
// ============================================================
function preflight(request, env) {
  const origin = request.headers.get("origin");
  const allow = allowedOrigin(origin, env);
  return new Response(null, {
    status: 204,
    headers: corsHeaders(allow)
  });
}

function allowedOrigin(origin, env) {
  const list = [env.SITE_ORIGIN, env.LOCAL_ORIGIN].filter(Boolean);
  if (origin && list.indexOf(origin) !== -1) return origin;
  return null;
}

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
  if (origin) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Credentials"] = "true";
  }
  return h;
}

function randomId(len) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
}
