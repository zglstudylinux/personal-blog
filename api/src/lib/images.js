/* ============================================================
   lib/images.js - 图片上传（直接提交进 Git 仓库）
   ------------------------------------------------------------
   不用对象存储 / R2。图片作为静态资源直接提交到目标仓库的
   assets/images/<yyyy>/<mm>/<uuid>.<ext>，部署到 GitHub Pages
   后即可公开访问。Markdown 里保存站点根相对路径。
   流程：
     1. 浏览器 POST /api/images/upload，带 { type, size, data }
        其中 data 是 data URL（data:image/png;base64,xxxx）或纯 base64。
     2. Worker 校验类型 / 大小 / 文件头魔数，生成随机对象名。
     3. Worker 用 GitHub Contents API 把图片提交到 IMAGES_BRANCH（默认 main）。
     4. 返回 publicUrl（站点根相对路径），浏览器插入 Markdown。
   安全：
     - 类型白名单（png/jpeg/webp）+ 大小上限 + 魔数校验，不信 MIME。
     - 对象名用随机 hex，不用用户原文件名，防路径穿越与冲突。
     - 只写固定前缀 assets/images/，不接受客户端传任意路径。
   代价权衡：图片直接进 main，不走 PR。这是有意为之——图片是受控
   二进制静态资源（已校验类型/大小/魔数），不含可执行内容；正文
   与注册表仍严格走 PR 审查。缺点是放弃发布的文章会留下孤儿图片，
   可后续清理。适合图片量小的个人博客。
   ============================================================ */

import { ghApi } from "./github.js";

const ALLOWED_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};

// 各类型文件头魔数（防伪造 MIME）
function magicOk(bytes, type) {
  function eq(off, seq) {
    for (var i = 0; i < seq.length; i++) {
      if (bytes[off + i] !== seq[i]) return false;
    }
    return true;
  }
  if (type === "image/png") {
    if (bytes.length < 8) return false;
    return eq(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (type === "image/jpeg") {
    if (bytes.length < 3) return false;
    return eq(0, [0xff, 0xd8, 0xff]);
  }
  if (type === "image/webp") {
    if (bytes.length < 12) return false;
    return eq(0, [0x52, 0x49, 0x46, 0x46]) /*RIFF*/ && eq(8, [0x57, 0x45, 0x42, 0x50]) /*WEBP*/;
  }
  return false;
}

function randomHex(len) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b).map(function (x) {
    return x.toString(16).padStart(2, "0");
  }).join("");
}

function objectName(type) {
  const ext = ALLOWED_EXT[type] || "bin";
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return "assets/images/" + y + "/" + m + "/" + randomHex(16) + "." + ext;
}

// base64（纯或 data URL）→ Uint8Array
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function extractBase64(input) {
  const s = String(input || "").trim();
  const m = s.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  return m ? m[1] : s;
}

// 提交图片到仓库。返回 { ok, publicUrl, objectName, branch, status, error }
export async function commitImage(env, type, data, size) {
  const allowedTypes = String(env.IMAGE_TYPES || "").split(",").map(function (s) { return s.trim(); });
  if (allowedTypes.indexOf(type) === -1) {
    return { ok: false, status: 415, error: "unsupported image type" };
  }

  const maxBytes = parseInt(env.IMAGE_MAX_BYTES || "5242880", 10);
  if (size && size > maxBytes) return { ok: false, status: 413, error: "image too large" };

  const b64 = extractBase64(data);
  let bytes;
  try { bytes = b64ToBytes(b64); }
  catch (e) { return { ok: false, status: 400, error: "bad base64" }; }
  if (bytes.length === 0) return { ok: false, status: 400, error: "empty image" };
  if (bytes.length > maxBytes) return { ok: false, status: 413, error: "image too large" };

  // 魔数校验，拒绝伪造 MIME
  if (!magicOk(bytes, type)) {
    return { ok: false, status: 415, error: "image magic mismatch" };
  }

  const name = objectName(type);
  const branch = env.IMAGES_BRANCH || "main";

  const res = await ghApi(env, "PUT", "/contents/" + name, {
    message: "upload image: " + name,
    branch: branch,
    content: b64
  });
  if (!res.ok) {
    return { ok: false, status: 502, error: "github commit failed: " + res.status };
  }

  return {
    ok: true,
    publicUrl: name,
    objectName: name,
    branch: branch
  };
}
