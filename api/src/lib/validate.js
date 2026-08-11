/* ============================================================
   lib/validate.js - 服务端内容校验
   永远不信任浏览器传来的内容。这里再校验一遍。
   ============================================================ */

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function slugOk(s) {
  return typeof s === "string" && SLUG_RE.test(s);
}

export function dateOk(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(s + "T00:00:00Z");
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

const TAG_RE = /^[^,]{1,30}$/;
const CAT_RE = /^.{1,30}$/;

export function validatePost(body) {
  const errors = [];
  if (!body || typeof body !== "object") {
    return { ok: false, errors: ["invalid payload"] };
  }

  if (!slugOk(body.slug)) errors.push("slug 只能含小写字母、数字和连字符，长度 1-80");
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 100) {
    errors.push("标题必填，长度 1-100");
  }
  if (!dateOk(body.date)) errors.push("日期格式应为 YYYY-MM-DD 且合法");

  if (typeof body.excerpt !== "undefined" && body.excerpt !== "" &&
      (typeof body.excerpt !== "string" || body.excerpt.length > 200)) {
    errors.push("摘要长度 0-200");
  }
  if (typeof body.category !== "undefined" && body.category !== "" &&
      (typeof body.category !== "string" || !CAT_RE.test(body.category))) {
    errors.push("专栏长度 0-30");
  }

  if (!Array.isArray(body.tags)) {
    if (typeof body.tags !== "undefined" && body.tags !== "") {
      errors.push("tags 应为数组");
    }
    body.tags = [];
  } else {
    if (body.tags.length > 20) errors.push("标签最多 20 个");
    body.tags = body.tags.filter(function (t) {
      return typeof t === "string" && TAG_RE.test(t);
    });
  }

  if (typeof body.content !== "string" || !body.content.trim()) {
    errors.push("正文不能为空");
  } else if (body.content.length > 200_000) {
    errors.push("正文过长");
  }

  // Markdown 净化：拒绝原始 HTML 块、危险协议（与前端白名单一致）
  if (typeof body.content === "string") {
    const s = sanitizeMarkdown(body.content);
    if (s.dangerous) errors.push("正文包含被禁止的内容（原始 HTML 或危险协议）");
    body.content = s.text;
  }

  return { ok: errors.length === 0, errors };
}

// ============================================================
// Markdown 净化（服务端）
// 不重新渲染 HTML，只移除/拒绝明显的危险结构。
// 与前端 markdown.js 的 URL 白名单保持一致：
//   允许 https:、http:、//、相对路径、#；禁止 javascript:/vbscript:/file:、危险 data:
// ============================================================
export function sanitizeMarkdown(md) {
  if (typeof md !== "string") return { text: "", dangerous: false };
  let dangerous = false;

  // 拒绝原始 <script> / <iframe> / <object> / <embed> / <style> 等块
  if (/<\s*(script|iframe|object|embed|style|form|input|textarea|button|svg|math)\b/i.test(md)) {
    dangerous = true;
  }

  // 检查所有链接/图片 URL 协议
  const urlRe = /(!?\[)([^\]]*?)\]\(([^)]+?)\)/g;
  let m;
  while ((m = urlRe.exec(md)) !== null) {
    const url = (m[3] || "").trim().split(/\s+/)[0];
    if (!urlSafe(url)) dangerous = true;
  }

  // 拒绝裸 HTML 注释里的条件注释类结构
  if (/<!--\s*\[if\b/i.test(md)) dangerous = true;

  return { text: md, dangerous };
}

export function urlSafe(u) {
  if (!u) return true; // 空字符串不算危险
  const s = String(u).trim();
  const lower = s.toLowerCase();
  if (/^\s*(javascript|vbscript|file):/i.test(s)) return false;
  if (/^\s*data:/i.test(s)) {
    return /^\s*data:image\/(png|jpeg|webp|gif);base64,/i.test(s);
  }
  // 允许 http(s)、协议相对、相对路径、锚点
  // blob: 用于本地预览的截图；线上文章里不应出现 blob:，但若误入也不会执行 JS，故放行
  if (/^(https?:|blob:|\/\/|\/|\.\/|\.\.\/|#)/i.test(s)) return true;
  // 邮件
  if (/^mailto:/i.test(s)) return true;
  // 其它带冒号的非标准协议一律拒绝
  if (/:/i.test(s) && !/^[a-z]+:\/\//i.test(s)) return false;
  return true;
}
