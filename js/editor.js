/* ============================================================
   editor.js - 网页 Markdown 编辑器
   ------------------------------------------------------------
   能力：
     - 标题/slug/日期/专栏/标签/摘要 元数据编辑
     - 复用 window.SimpleMarkdown.render() 做实时预览
     - localStorage 多草稿保存与恢复
     - 粘贴截图本地预览（持久化上传需 API 启用后由服务端签名）
     - 导出 .md
     - 在线发布：apiBase 配置后调用后端 API（需登录）
   安全：
     - 不在前端存储任何 GitHub token / 对象存储密钥
     - 发布请求只带 HttpOnly 会话 cookie，靠服务端鉴权
     - 所有客户端校验仅为体验，服务端必须再次校验
   ============================================================ */
(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var apiBase = cfg.apiBase || "";
  var DRAFT_PREFIX = "blog:draft:";

  var $ = function (id) { return document.getElementById(id); };
  var input = $("editorInput");
  var preview = $("editorPreview");
  var fTitle = $("fTitle");
  var fSlug = $("fSlug");
  var fDate = $("fDate");
  var fCategory = $("fCategory");
  var fTags = $("fTags");
  var fExcerpt = $("fExcerpt");
  var statusEl = $("editorStatus");
  var noteEl = $("editorNote");
  var publishNote = $("publishNote");
  var pastePreview = $("pastePreview");

  if (!input || !preview) return;

  // ---------- 工具 ----------
  function setStatus(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "editor-status" + (kind ? " is-" + kind : "");
  }

  function slugify(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")  // 非字母数字转连字符
      .replace(/^-+|-+$/g, "")
      .substring(0, 80);
  }

  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function currentDraftKey() {
    var s = fSlug.value.trim();
    if (!s) s = slugify(fTitle.value) || "untitled";
    return DRAFT_PREFIX + s;
  }

  function gatherDraft() {
    return {
      title: fTitle.value,
      slug: fSlug.value,
      date: fDate.value,
      category: fCategory.value,
      tags: fTags.value,
      excerpt: fExcerpt.value,
      content: input.value,
      updatedAt: new Date().toISOString()
    };
  }

  function applyDraft(d) {
    if (!d) return;
    fTitle.value = d.title || "";
    fSlug.value = d.slug || "";
    fDate.value = d.date || today();
    fCategory.value = d.category || "";
    fTags.value = d.tags || "";
    fExcerpt.value = d.excerpt || "";
    input.value = d.content || "";
    renderPreview();
  }

  // ---------- 实时预览 ----------
  var renderTimer = null;
  function renderPreview() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      var md = input.value;
      try {
        var html = window.SimpleMarkdown.render(md);
        // 本地编辑预览：把仓库相对路径 assets/images/... 改写成 raw 直链。
        // 正文里存的是仓库相对路径（发布到线上后正确），但本地工作副本里
        // 没有 Worker 刚提交的图片，static server 会 404；改写成 raw.githubusercontent.com
        // 直链即可在预览里看到。这只改预览 DOM 的 src，不改正文 textarea，不影响发布内容。
        preview.innerHTML = rebaseImgSrc(html);
      } catch (e) {
        preview.innerHTML = '<p class="editor-preview__err">预览渲染出错：' +
          window.SimpleMarkdown.escapeHtml(String(e.message)) + "</p>";
      }
    }, 120);
  }

  // 把 HTML 串里 <img src="assets/images/..."> 改写成 raw 直链。
  // 仅处理仓库内相对图片路径，其它（blob:/data:/http(s)/绝对路径）保持原样。
  function rebaseImgSrc(html) {
    var base = cfg.gitRawBase;
    if (!base) return html;
    // 匹配 src="assets/images/..." 或 src='assets/images/...'
    return html.replace(
      /(<img\b[^>]*\bsrc=)(["'])(assets\/images\/[^"']+)\2/gi,
      function (_, pre, q, src) {
        return pre + q + base + "/" + src + q;
      }
    );
  }

  // ---------- 草稿 ----------
  function listDrafts() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(DRAFT_PREFIX) === 0) {
        try {
          var d = JSON.parse(localStorage.getItem(k));
          out.push({ key: k, slug: k.slice(DRAFT_PREFIX.length), updatedAt: d.updatedAt, title: d.title });
        } catch (e) {}
      }
    }
    out.sort(function (a, b) { return (a.updatedAt < b.updatedAt) ? 1 : -1; });
    return out;
  }

  function refreshDraftSelect() {
    var sel = $("draftSelect");
    if (!sel) return;
    var drafts = listDrafts();
    sel.innerHTML = "";
    drafts.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = d.key;
      opt.textContent = (d.title || d.slug) + " — " + (d.updatedAt || "").replace("T", " ").slice(0, 16);
      sel.appendChild(opt);
    });
    // 选中当前
    var cur = currentDraftKey();
    if (Array.prototype.indexOf.call(sel.options, sel.querySelector('option[value="' + cur + '"]')) >= 0) {
      sel.value = cur;
    } else if (sel.options.length) {
      sel.value = sel.options[0].value;
    }
  }

  function saveCurrentDraft(silent) {
    var key = currentDraftKey();
    var d = gatherDraft();
    try {
      localStorage.setItem(key, JSON.stringify(d));
      if (!silent) setStatus("已保存草稿", "ok");
      refreshDraftSelect();
    } catch (e) {
      setStatus("草稿保存失败：" + e.message, "err");
    }
  }

  function loadDraft(key) {
    try {
      var d = JSON.parse(localStorage.getItem(key));
      applyDraft(d);
      setStatus("已载入草稿", "ok");
    } catch (e) {
      setStatus("草稿读取失败", "err");
    }
  }

  function deleteCurrentDraft() {
    var key = currentDraftKey();
    localStorage.removeItem(key);
    setStatus("已删除草稿", "ok");
    refreshDraftSelect();
    if (listDrafts().length === 0) newDraft();
    else loadDraft(listDrafts()[0].key);
  }

  function newDraft() {
    fTitle.value = "";
    fSlug.value = "";
    fDate.value = today();
    fCategory.value = "";
    fTags.value = "";
    fExcerpt.value = "";
    input.value = "";
    renderPreview();
    setStatus("新草稿", "ok");
    refreshDraftSelect();
  }

  // ---------- 导出 .md ----------
  function exportMd() {
    var d = gatherDraft();
    var header = [
      "<!--",
      "title: " + d.title,
      "slug: " + d.slug,
      "date: " + d.date,
      "category: " + d.category,
      "tags: " + d.tags,
      "excerpt: " + d.excerpt,
      "-->",
      ""
    ].join("\n");
    var blob = new Blob([header + d.content], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (d.slug || "draft") + ".md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus("已导出 Markdown", "ok");
  }

  // ---------- 粘贴截图 ----------
  function handlePaste(e) {
    var items = (e.clipboardData || {}).items || [];
    var imageItem = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image/") === 0) {
        imageItem = items[i];
        break;
      }
    }
    if (!imageItem) return; // 普通文本粘贴，交给默认行为
    e.preventDefault();
    var blob = imageItem.getAsFile();
    if (!blob) return;
    // 前端预校验：类型与大小
    var allowed = (cfg.imageTypes || ["image/png", "image/jpeg", "image/webp"]);
    if (allowed.indexOf(blob.type) === -1) {
      setStatus("不支持的图片类型：" + blob.type, "err");
      return;
    }
    if (cfg.imageMaxBytes && blob.size > cfg.imageMaxBytes) {
      setStatus("图片过大（> " + Math.round(cfg.imageMaxBytes / 1024 / 1024) + " MB）", "err");
      return;
    }

    if (apiBase) {
      // 在线模式：请求预签名 URL 并上传，成功后插入公开 URL
      uploadImage(blob);
    } else {
      // 离线模式：仅本地预览，插入 blob: URL（仅本机可见，刷新即失效）
      localInsertImage(blob);
    }
  }

  function localInsertImage(blob) {
    var url = URL.createObjectURL(blob);
    showPastePreview(url, blob.type, blob.size);
    insertMarkdownImage(url, "截图");
    setStatus("已插入本地预览图（仅本机可见，未上传）", "ok");
  }

  function showPastePreview(url, type, size, stateLabel) {
    if (!pastePreview) return;
    pastePreview.innerHTML = "";
    pastePreview.hidden = false;
    var img = document.createElement("img");
    img.src = url;
    img.className = "editor-paste__img";
    var meta = document.createElement("div");
    meta.className = "editor-paste__meta";
    var info = type + " · " + (size / 1024).toFixed(1) + " KB";
    if (stateLabel) info += " · " + stateLabel;
    meta.textContent = info;
    pastePreview.appendChild(img);
    pastePreview.appendChild(meta);
  }

  function insertMarkdownImage(url, alt) {
    var md = "![" + (alt || "截图") + "](" + url + ")";
    var start = input.selectionStart;
    var end = input.selectionEnd;
    var before = input.value.slice(0, start);
    var after = input.value.slice(end);
    var insert = (before && !before.endsWith("\n") ? "\n\n" : "") + md + "\n\n";
    input.value = before + insert + after;
    input.selectionStart = input.selectionEnd = start + insert.length;
    renderPreview();
    touchDraft();
  }

  function uploadImage(blob) {
    setStatus("正在上传图片…", "info");
    // 先用 blob: URL 在粘贴预览区即时显示，让作者立刻看到图，不等网络往返。
    var blobUrl = URL.createObjectURL(blob);
    showPastePreview(blobUrl, blob.type, blob.size, "正在上传…");
    // 在线模式：把 blob 读成 data URL，一次性 POST 到后端。
    // 后端用 GitHub Contents API 提交到 assets/images/，返回站点根相对路径。
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result; // data:image/png;base64,xxxx
      fetch(apiBase + "/api/images/upload", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: blob.type, size: blob.size, data: dataUrl })
      }).then(function (r) {
        if (r.status === 401) throw new Error("未登录，请先用 GitHub 登录");
        if (!r.ok) throw new Error("上传失败 (" + r.status + ")");
        return r.json();
      }).then(function (res) {
        if (!res || !res.publicUrl) throw new Error("后端未返回图片地址");
        // 正文插入仓库相对路径（发布到线上后正确）。预览由 rebaseImgSrc
        // 改写成 raw 直链显示，本地不再 404。
        insertMarkdownImage(res.publicUrl, "截图");
        // 更新粘贴预览区状态：图已提交进仓库。
        showPastePreview(blobUrl, blob.type, blob.size, "已上传并插入正文");
        setStatus("图片已上传并插入", "ok");
      }).catch(function (e) {
        setStatus("图片上传失败：" + e.message, "err");
        showPastePreview(blobUrl, blob.type, blob.size, "上传失败");
      });
    };
    reader.onerror = function () {
      setStatus("图片读取失败", "err");
    };
    reader.readAsDataURL(blob);
  }

  // ---------- 登录状态 ----------
  function refreshAuth() {
    var bar = $("authBar");
    if (!bar) return;
    if (!apiBase) { bar.hidden = true; return; }
    bar.hidden = false;
    fetch(apiBase + "/api/auth/me", { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (u) {
        var userEl = $("authUser"), loginEl = $("authLogin"), logoutEl = $("authLogout");
        if (u && u.login) {
          userEl.textContent = "已登录：" + u.login;
          loginEl.hidden = true;
          logoutEl.hidden = false;
          $("btnPublish").disabled = false;
        } else {
          userEl.textContent = "未登录";
          loginEl.hidden = false;
          logoutEl.hidden = true;
          $("btnPublish").disabled = true;
        }
      })
      .catch(function () {
        $("authUser").textContent = "未登录";
        $("authLogin").hidden = false;
        $("authLogout").hidden = true;
      });
  }

  // ---------- 发布 ----------
  function publish() {
    if (!apiBase) {
      setStatus("未配置后端 API，无法在线发布", "err");
      return;
    }
    var d = gatherDraft();
    var tags = d.tags.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
    var payload = {
      slug: d.slug,
      title: d.title,
      date: d.date,
      excerpt: d.excerpt,
      category: d.category,
      tags: tags,
      content: d.content,
      mode: "publish"
    };
    // 基础前端校验
    if (!payload.slug || !/^[a-z0-9-]+$/.test(payload.slug)) {
      setStatus("slug 只能含小写字母、数字和连字符", "err"); return;
    }
    if (!payload.title) { setStatus("请填写标题", "err"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) { setStatus("日期格式应为 YYYY-MM-DD", "err"); return; }
    if (!payload.content) { setStatus("正文不能为空", "err"); return; }

    setStatus("正在提交发布…", "info");
    fetch(apiBase + "/api/posts/publish", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.status === 401) throw new Error("未登录");
      if (r.status === 409) throw new Error("slug 已存在或与远程冲突");
      if (!r.ok) throw new Error("发布失败 (" + r.status + ")");
      return r.json();
    }).then(function (res) {
      var msg = "已创建 PR";
      if (res && res.prUrl) msg += "：" + res.prUrl;
      msg += "。合并后 GitHub Pages 会自动部署，注意有缓存延迟。";
      setStatus(msg, "ok");
    }).catch(function (e) {
      setStatus("发布失败：" + e.message, "err");
    });
  }

  // ---------- 事件绑定 ----------
  var touchTimer = null;
  function touchDraft() {
    if (touchTimer) clearTimeout(touchTimer);
    touchTimer = setTimeout(function () { saveCurrentDraft(true); refreshDraftSelect(); }, 800);
  }

  input.addEventListener("input", function () { renderPreview(); touchDraft(); });
  input.addEventListener("paste", handlePaste);
  fTitle.addEventListener("input", function () {
    // 未手动改过 slug 时自动同步
    if (!fSlug.dataset.touched) fSlug.value = slugify(fTitle.value);
    touchDraft();
  });
  fSlug.addEventListener("input", function () { fSlug.dataset.touched = "1"; touchDraft(); });
  [fDate, fCategory, fTags, fExcerpt].forEach(function (el) {
    el.addEventListener("input", touchDraft);
  });

  $("btnSaveDraft").addEventListener("click", function () { saveCurrentDraft(false); });
  $("btnExport").addEventListener("click", exportMd);
  $("btnPublish").addEventListener("click", publish);
  $("btnNewDraft").addEventListener("click", newDraft);
  $("btnDelDraft").addEventListener("click", deleteCurrentDraft);

  var draftSelect = $("draftSelect");
  if (draftSelect) {
    draftSelect.addEventListener("change", function () {
      if (draftSelect.value) loadDraft(draftSelect.value);
    });
  }

  var loginEl = $("authLogin");
  if (loginEl) {
    loginEl.addEventListener("click", function (e) {
      e.preventDefault();
      if (apiBase) location.href = apiBase + "/api/auth/login";
    });
  }
  var logoutEl = $("authLogout");
  if (logoutEl) {
    logoutEl.addEventListener("click", function () {
      fetch(apiBase + "/api/auth/logout", { method: "POST", credentials: "include" })
        .finally(function () { refreshAuth(); });
    });
  }

  // 离开页面自动存草稿
  window.addEventListener("beforeunload", function () { saveCurrentDraft(true); });

  // ---------- 初始化 ----------
  function init() {
    if (!apiBase) {
      if (publishNote) publishNote.hidden = false;
    } else {
      if (publishNote) publishNote.hidden = false; // 提示仍显示，指向 README
      refreshAuth();
    }
    // 恢复最近草稿，或新建
    var drafts = listDrafts();
    if (drafts.length) {
      loadDraft(drafts[0].key);
    } else {
      newDraft();
    }
    refreshDraftSelect();
    setStatus(apiBase ? "就绪" : "本地模式（未配置 apiBase）", "ok");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
