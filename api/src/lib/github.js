/* ============================================================
   lib/github.js - GitHub OAuth 与 REST API 调用
   所有 token 都来自 env，绝不出现在返回给前端的响应里。
   ============================================================ */

// 用授权码换 access token
export async function githubExchange(env, code, redirectUri) {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: env.GH_CLIENT_ID,
      client_secret: env.GH_CLIENT_SECRET,
      code: code,
      redirect_uri: redirectUri
    })
  });
  if (!r.ok) {
    throw new Error("github token exchange failed: " + r.status);
  }
  const data = await r.json();
  if (!data.access_token) {
    throw new Error("github returned no access_token");
  }
  return data.access_token;
}

// 用 access token 取当前用户
export async function githubLogin(env, token) {
  const r = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "User-Agent": "blog-api"
    }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return {
    id: u.id,
    login: u.login,
    name: u.name
  };
}

// 用 GH_API_TOKEN 调 GitHub REST API（带分页与版本头）
//   method, path（相对 https://api.github.com/repos/<repo>/...）, body, contentType
export async function ghApi(env, method, repoPath, body) {
  const repo = env.GH_REPO;
  if (!repo) throw new Error("GH_REPO not set");
  const url = "https://api.github.com/repos/" + repo + repoPath;
  const headers = {
    "Authorization": "Bearer " + env.GH_API_TOKEN,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "blog-api"
  };
  const init = { method: method, headers: headers };
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await fetch(url, init);
  let parsed = null;
  const text = await r.text();
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
  return { ok: r.ok, status: r.status, data: parsed, raw: text };
}

// 取某路径文件的当前内容与 SHA（默认分支）
export async function getSha(env, branch, path) {
  const res = await ghApi(env, "GET", "/contents/" + path + "?ref=" + encodeURIComponent(branch));
  if (res.status === 404) return { exists: false, sha: null, content: "" };
  if (!res.ok) throw new Error("getSha " + res.status);
  return { exists: true, sha: res.data.sha, content: res.data.content || "" };
}

// 删除某路径文件（必须带 SHA）。用 GitHub Contents DELETE API。
// 返回 { ok, status }；404 视为「已不存在」按 ok 处理（幂等），方便清理孤儿资源时重试。
export async function deleteFile(env, path, sha, message) {
  const res = await ghApi(env, "DELETE", "/contents/" + path, {
    message: message,
    branch: env.IMAGES_BRANCH || "main",
    sha: sha
  });
  if (res.status === 404) return { ok: true, status: 404, gone: true };
  return { ok: res.ok, status: res.status };
}
