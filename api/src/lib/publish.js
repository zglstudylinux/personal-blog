/* ============================================================
   lib/publish.js - 发布流程
   在独立分支上同时提交 Markdown 正文与 js/posts.js 注册表更新，
   然后创建 Pull Request。不直接写 main。
   ============================================================ */

import { ghApi, getSha } from "./github.js";

const DEFAULT_BRANCH = "main";

// 把文章对象序列化成符合现有 js/posts.js 风格的一条配置
function buildPostEntry(p) {
  const lines = [];
  lines.push("  {");
  lines.push('    slug: ' + JSON.stringify(p.slug) + ",");
  lines.push('    title: ' + JSON.stringify(p.title) + ",");
  lines.push('    date: ' + JSON.stringify(p.date) + ",");
  lines.push('    excerpt: ' + JSON.stringify(p.excerpt || "") + ",");
  lines.push('    category: ' + JSON.stringify(p.category || "") + ",");
  lines.push('    tags: ' + JSON.stringify(p.tags || []) + ",");
  lines.push('    file: ' + JSON.stringify("posts/" + p.slug + ".md"));
  lines.push("  }");
  return lines.join("\n");
}

// 解析现有 js/posts.js，在数组末尾追加新条目。
// 采用保守的字符串注入，不做完整 JS 解析（Worker 无 AST 库）：
//   找到 "window.POSTS = [" 与最后的 "];"，在中间插入。
// 注意：不能对数组内容整体 .trim()——那会把第一条的 2 空格缩进一起去掉，
// 造成 "[\n{" 的缩进塌陷（发布越多越乱）。这里只去尾空白，保留首条缩进。
function appendToRegistry(src, entry) {
  const start = src.indexOf("window.POSTS = [");
  if (start === -1) throw new Error("registry: window.POSTS = [ not found");
  const arrOpen = src.indexOf("[", start);
  if (arrOpen === -1) throw new Error("registry: array open not found");
  const close = src.lastIndexOf("];");
  if (close === -1 || close < arrOpen) throw new Error("registry: array close not found");
  // '[' 之后、'];' 之前的原始内容：只去尾空白，保留首条缩进。
  const inner = src.slice(arrOpen + 1, close).replace(/\s+$/, "");
  const needComma = inner.length > 0 && !/,$/.test(inner);
  const pre = src.slice(0, arrOpen + 1); // 末尾是 '['
  const post = src.slice(close);         // 开头是 '];'
  return pre + inner + (needComma ? "," : "") + "\n" + entry + "\n" + post;
}

export async function publishPost(env, post, branch, user) {
  const mdPath = "posts/" + post.slug + ".md";
  const registryPath = "js/posts.js";

  // 1. 取 main 最新 commit SHA 作为发布分支起点
  const refRes = await ghApi(env, "GET", "/git/ref/heads/" + DEFAULT_BRANCH);
  if (!refRes.ok) return { ok: false, error: "cannot read main ref", conflict: false };
  const baseSha = refRes.data.object.sha;

  // 2. 冲突检测：文章文件若已存在则拒绝（要求 slug 唯一）
  const existMd = await getSha(env, DEFAULT_BRANCH, mdPath);
  if (existMd.exists) {
    return { ok: false, error: "slug already exists: " + post.slug, conflict: true };
  }

  // 3. 创建发布分支
  const brRes = await ghApi(env, "POST", "/git/refs", {
    ref: "refs/heads/" + branch,
    sha: baseSha
  });
  if (!brRes.ok) {
    // 422/422 可能是引用已存在
    if (brRes.status !== 422) return { ok: false, error: "cannot create branch", conflict: false };
  }

  // 4. 提交 Markdown 正文
  const mdContent = btoa(unescape(encodeURIComponent(post.content)));
  const putMd = await ghApi(env, "PUT", "/contents/" + mdPath, {
    message: "publish: " + post.slug + " (content)",
    branch: branch,
    content: mdContent
  });
  if (!putMd.ok) return { ok: false, error: "cannot commit markdown", conflict: false };

  // 5. 读当前 js/posts.js，追加注册表条目，提交
  const reg = await getSha(env, branch, registryPath);
  const currentSrc = reg.exists ? decodeBase64(reg.content) : "";
  let newSrc;
  try {
    newSrc = appendToRegistry(currentSrc, buildPostEntry(post));
  } catch (e) {
    return { ok: false, error: "registry update failed: " + e.message, conflict: false };
  }
  const putReg = await ghApi(env, "PUT", "/contents/" + registryPath, {
    message: "publish: " + post.slug + " (registry)",
    branch: branch,
    sha: reg.exists ? reg.sha : undefined,
    content: btoa(unescape(encodeURIComponent(newSrc)))
  });
  if (!putReg.ok) return { ok: false, error: "cannot commit registry", conflict: false };

  // 6. 创建 PR
  const pr = await ghApi(env, "POST", "/pulls", {
    title: post.title,
    head: branch,
    base: DEFAULT_BRANCH,
    body: buildPrBody(post, user)
  });
  if (!pr.ok) return { ok: false, error: "cannot create pr", conflict: false };

  return {
    ok: true,
    prUrl: pr.data && pr.data.html_url,
    branch: branch
  };
}

function buildPrBody(p, user) {
  return [
    "## " + (p.title || ""),
    "",
    "- slug: `" + p.slug + "`",
    "- date: `" + p.date + "`",
    p.category ? "- 专栏: " + p.category : "",
    p.tags && p.tags.length ? "- 标签: " + p.tags.join(", ") : "",
    "- 作者: @" + (user && user.login ? user.login : ""),
    "",
    "> 由网页编辑器发布。合并后 GitHub Pages 会自动部署，注意有缓存延迟。"
  ].filter(Boolean).join("\n");
}

function decodeBase64(b64) {
  // GitHub API 返回的 content 可能带换行，先去掉
  const clean = String(b64 || "").replace(/\s/g, "");
  try {
    const bin = atob(clean);
    return decodeURIComponent(escape(bin));
  } catch (e) {
    return "";
  }
}
