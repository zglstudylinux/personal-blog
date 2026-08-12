/* ============================================================
   lib/publish.js - 发布流程
   作者登录后由 Worker 直接写 main 分支：
     - create：Markdown 不存在 → 提交正文 + 追加 js/posts.js 条目
     - update：Markdown 已存在 → 用 SHA 更新正文 + 替换同 slug 的注册表条目
   不再创建发布分支和 PR。合并 PR 的审阅环节由作者白名单 + 服务端校验取代。
   两次 GitHub Contents API 调用无法组成一次原子提交，采用「先正文后注册表」
   的顺序：第二步失败时返回 partial，不伪称成功，也不暴露 token/堆栈。
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

// 在 js/posts.js 里找到指定 slug 的顶层对象块，替换为新条目文本。
// 用花括号深度切分顶层对象（处理字符串里的花括号与转义），不做 JS 解析。
// 注册表顶部的大注释在 "window.POSTS = [" 之前，不在切分范围内。
function updateRegistryEntry(src, newEntryText, slug) {
  const start = src.indexOf("window.POSTS = [");
  if (start === -1) throw new Error("registry: window.POSTS = [ not found");
  const arrOpen = src.indexOf("[", start);
  if (arrOpen === -1) throw new Error("registry: array open not found");
  const close = src.lastIndexOf("];");
  if (close === -1 || close < arrOpen) throw new Error("registry: array close not found");
  const inner = src.slice(arrOpen + 1, close);
  const range = findEntryRange(inner, slug);
  if (!range) throw new Error("registry: entry not found for slug " + slug);
  const newInner = inner.slice(0, range.start) + newEntryText + inner.slice(range.end);
  const pre = src.slice(0, arrOpen + 1);
  const post = src.slice(close);
  return pre + newInner + post;
}

// 在数组内容里定位属于某 slug 的顶层 {...} 块的 [start, end) 字符区间。
function findEntryRange(inner, slug) {
  let depth = 0;
  let start = -1;
  let inStr = false;
  let strCh = "";
  let esc = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === strCh) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const block = inner.slice(start, i + 1);
        const m = block.match(/slug\s*:\s*["']([^"']+)["']/);
        if (m && m[1] === slug) return { start: start, end: i + 1 };
        start = -1;
      }
    }
  }
  return null;
}

function commitMsg(prefix, slug, user) {
  return prefix + ": " + slug + " by @" + (user && user.login ? user.login : "unknown");
}

function encodeContent(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

// mode: "create" | "update"
export async function publishPost(env, post, mode, user) {
  const branch = DEFAULT_BRANCH;
  const mdPath = "posts/" + post.slug + ".md";
  const registryPath = "js/posts.js";

  if (mode === "update") {
    // 更新已有文章：Markdown 必须已存在
    const existMd = await getSha(env, branch, mdPath);
    if (!existMd.exists) {
      return { ok: false, error: "文章不存在，无法更新：" + post.slug, conflict: false };
    }
    // 1. 用 SHA 更新 Markdown 正文
    const putMd = await ghApi(env, "PUT", "/contents/" + mdPath, {
      message: commitMsg("update", post.slug, user) + " (content)",
      branch: branch,
      sha: existMd.sha,
      content: encodeContent(post.content)
    });
    if (!putMd.ok) {
      if (putMd.status === 409) return { ok: false, error: "正文与远程冲突，请重新载入后再发布", conflict: true };
      return { ok: false, error: "cannot update markdown (" + putMd.status + ")", conflict: false };
    }
    // 2. 替换注册表同 slug 条目
    const reg = await getSha(env, branch, registryPath);
    if (!reg.exists) {
      return { ok: false, error: "正文已更新，但注册表 js/posts.js 在远程不存在，需手动补条目", partial: true };
    }
    let newSrc;
    try {
      newSrc = updateRegistryEntry(decodeBase64(reg.content), buildPostEntry(post), post.slug);
    } catch (e) {
      return { ok: false, error: "registry update failed: " + e.message, partial: true };
    }
    const putReg = await ghApi(env, "PUT", "/contents/" + registryPath, {
      message: commitMsg("update", post.slug, user) + " (registry)",
      branch: branch,
      sha: reg.sha,
      content: encodeContent(newSrc)
    });
    if (!putReg.ok) {
      if (putReg.status === 409) return { ok: false, error: "注册表与远程冲突，请重新载入后再发布（正文已更新）", conflict: true, partial: true };
      return { ok: false, error: "正文已更新，但注册表更新失败 (" + putReg.status + ")", partial: true };
    }
    return { ok: true, mode: "update", slug: post.slug };
  }

  // create 模式：Markdown 必须不存在
  const existMd = await getSha(env, branch, mdPath);
  if (existMd.exists) {
    return { ok: false, error: "slug 已存在：" + post.slug, conflict: true };
  }
  // 1. 提交 Markdown 正文
  const putMd = await ghApi(env, "PUT", "/contents/" + mdPath, {
    message: commitMsg("publish", post.slug, user) + " (content)",
    branch: branch,
    content: encodeContent(post.content)
  });
  if (!putMd.ok) {
    if (putMd.status === 409) return { ok: false, error: "正文与远程冲突，请重新载入后再发布", conflict: true };
    return { ok: false, error: "cannot commit markdown (" + putMd.status + ")", conflict: false };
  }
  // 2. 追加注册表条目
  const reg = await getSha(env, branch, registryPath);
  if (!reg.exists) {
    return { ok: false, error: "Markdown 已提交，但注册表 js/posts.js 在远程不存在，需手动补条目", partial: true };
  }
  let newSrc;
  try {
    newSrc = appendToRegistry(decodeBase64(reg.content), buildPostEntry(post));
  } catch (e) {
    return { ok: false, error: "registry update failed: " + e.message, partial: true };
  }
  const putReg = await ghApi(env, "PUT", "/contents/" + registryPath, {
    message: commitMsg("publish", post.slug, user) + " (registry)",
    branch: branch,
    sha: reg.sha,
    content: encodeContent(newSrc)
  });
  if (!putReg.ok) {
    if (putReg.status === 409) return { ok: false, error: "注册表与远程冲突，请重新载入后再发布（正文已提交，建议手动补注册表条目）", conflict: true, partial: true };
    return { ok: false, error: "Markdown 已提交，但注册表更新失败 (" + putReg.status + ")", partial: true };
  }
  return { ok: true, mode: "create", slug: post.slug };
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
