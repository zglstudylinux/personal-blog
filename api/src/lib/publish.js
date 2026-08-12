/* ============================================================
   lib/publish.js - 发布与删除流程
   作者登录后由 Worker 直接写 main 分支：
     - create：Markdown 不存在 → 提交正文 + 追加 js/posts.js 条目
     - update：Markdown 已存在 → 用 SHA 更新正文 + 替换同 slug 的注册表条目
     - delete：先删注册表条目、再删正文、最后删引用的图片（尽力清理）
   不再创建发布分支和 PR。合并 PR 的审阅环节由作者白名单 + 服务端校验取代。
   多次 GitHub Contents API 调用无法组成一次原子提交，按「先注册表后资源」
   的顺序：中途失败时返回 partial，不伪称成功，也不暴露 token/堆栈。
   ============================================================ */

import { ghApi, getSha, deleteFile } from "./github.js";

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

// 从 js/posts.js 移除指定 slug 的顶层对象块，并连带吃掉相邻的逗号与空白，
// 保证删除后仍是合法 JS（不留下悬挂逗号或多余空行）。
function removeRegistryEntry(src, slug) {
  const start = src.indexOf("window.POSTS = [");
  if (start === -1) throw new Error("registry: window.POSTS = [ not found");
  const arrOpen = src.indexOf("[", start);
  if (arrOpen === -1) throw new Error("registry: array open not found");
  const close = src.lastIndexOf("];");
  if (close === -1 || close < arrOpen) throw new Error("registry: array close not found");
  const inner = src.slice(arrOpen + 1, close);
  const range = findEntryRange(inner, slug);
  if (!range) throw new Error("registry: entry not found for slug " + slug);
  let s = range.start, e = range.end;
  // 优先吃掉块后紧跟的逗号（非末尾条目的分隔逗号）；没有则吃掉块前的逗号。
  // 这样无论删的是首条/中间/末条，剩余条目间的逗号都恰好保留一份。
  const afterMatch = inner.slice(e).match(/^\s*,/);
  if (afterMatch) {
    e += afterMatch[0].length;
  } else {
    const beforeMatch = inner.slice(0, s).match(/,\s*$/);
    if (beforeMatch) s -= beforeMatch[0].length;
  }
  let newInner = inner.slice(0, s) + inner.slice(e);
  // 折叠删除后可能出现的连续空行
  newInner = newInner.replace(/\n{3,}/g, "\n\n");
  const pre = src.slice(0, arrOpen + 1);
  const post = src.slice(close);
  return pre + newInner + post;
}

// 从 Markdown 正文里提取要清理的图片路径：只认仓库相对路径 assets/images/...。
// 去重；忽略 blob:/data:/http(s) 等其它来源（不是仓库资源，删不着）。
// 注意：uuid 命名的图片上传后每张唯一，实践中不会被多篇文章共用；
// 若作者手动把同一路径粘进多篇文章，这里仍会删，可能导致其它文章图裂。
// 这是已知边界，单作者博客不跨文章复用图片路径。
function extractImagePaths(md) {
  const out = [];
  const re = /!\[[^\]]*\]\((assets\/images\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    if (out.indexOf(m[1]) === -1) out.push(m[1]);
  }
  return out;
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

// ============================================================
// deletePost - 删除已发布文章并清理图片资源
// 顺序：先删注册表条目（文章立即从站点消失），再删正文 Markdown，再删引用的图片。
// 三类资源分多次 GitHub Contents DELETE 调用，非原子：
//   - 注册表删除失败 → 整体失败，文章仍可见，无副作用
//   - 注册表删除成功但正文删除失败 → partial（文章仍在仓库，但站点不可见，需手动删 .md）
//   - 正文删除成功但部分图片删除失败 → 仍算成功，未删图片成孤儿（返回 imagesFailed 列表）
// 不暴露 token/堆栈，失败信息只给前端可读文案。
// ============================================================
export async function deletePost(env, slug, user) {
  const branch = DEFAULT_BRANCH;
  const mdPath = "posts/" + slug + ".md";
  const registryPath = "js/posts.js";

  // 1. 先读正文：确认文章存在，同时提取要清理的图片路径
  const existMd = await getSha(env, branch, mdPath);
  if (!existMd.exists) {
    return { ok: false, error: "文章不存在或已被删除：" + slug, conflict: false };
  }
  const mdContent = decodeBase64(existMd.content);
  const imagePaths = extractImagePaths(mdContent);

  // 2. 删除注册表条目（先做：文章从站点消失，即使后续失败也不会留下「点开 404」的链接）
  const reg = await getSha(env, branch, registryPath);
  if (!reg.exists) {
    return { ok: false, error: "正文存在但注册表 js/posts.js 在远程不存在，需手动删条目", partial: true };
  }
  let newSrc;
  try {
    newSrc = removeRegistryEntry(decodeBase64(reg.content), slug);
  } catch (e) {
    // 注册表里找不到该 slug 条目：仍继续删正文，避免留下「注册表无、正文在」的孤儿
    newSrc = null;
  }
  if (newSrc !== null) {
    const putReg = await ghApi(env, "PUT", "/contents/" + registryPath, {
      message: commitMsg("delete", slug, user) + " (registry)",
      branch: branch,
      sha: reg.sha,
      content: encodeContent(newSrc)
    });
    if (!putReg.ok) {
      if (putReg.status === 409) return { ok: false, error: "注册表与远程冲突，请重新载入后再删除", conflict: true };
      return { ok: false, error: "删除注册表条目失败 (" + putReg.status + ")", conflict: false };
    }
  }

  // 3. 删除正文 Markdown（带 SHA）
  const delMd = await deleteFile(env, mdPath, existMd.sha, commitMsg("delete", slug, user) + " (content)");
  if (!delMd.ok) {
    if (delMd.status === 409) return { ok: false, error: "正文与远程冲突，请重新载入后再删除（注册表条目已删）", conflict: true, partial: true };
    return { ok: false, error: "注册表已删，但正文删除失败 (" + delMd.status + ")", partial: true };
  }

  // 4. 清理图片（尽力而为；失败不回滚已删的正文/注册表，只上报哪些图没删掉）
  const imagesFailed = [];
  for (const imgPath of imagePaths) {
    const img = await getSha(env, branch, imgPath);
    if (!img.exists) continue; // 已不存在，跳过
    const delImg = await deleteFile(env, imgPath, img.sha, commitMsg("delete-img", slug, user) + " (" + imgPath + ")");
    if (!delImg.ok) imagesFailed.push(imgPath);
  }

  return { ok: true, slug: slug, imagesTotal: imagePaths.length, imagesFailed: imagesFailed };
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
