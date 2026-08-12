/* ============================================================
   editor.js - 网页 Markdown 编辑器（作者专用）
   ------------------------------------------------------------
   能力：
     - 认证门禁：未登录只显示 GitHub 登录入口，不暴露编辑工作区
     - 登录后：标题/slug/日期/专栏/标签/摘要 元数据编辑
     - 新建文章（mode=create）与编辑已发布文章（mode=update）
     - 复用 window.SimpleMarkdown.render() 做实时预览
     - localStorage 多草稿保存与恢复（草稿记录 editingSlug 以区分新建/编辑）
     - 粘贴截图：在线模式上传到 Git 仓库 assets/images/，离线仅本地预览
     - 导出 .md
     - 在线发布：apiBase 配置后调用后端，作者登录后直接写 main，不再走 PR
   安全：
     - 不在前端存储任何 GitHub token / 对象存储密钥
     - 发布请求只带 HttpOnly 会话 cookie，靠服务端鉴权
     - 前端隐藏工作区只是体验，不是安全边界：后端每个写接口都校验会话
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
  var pastePreview = $("pastePreview");
  var gate = $("authGate");
  var workspace = $("editorWorkspace");

  if (!input || !preview || !gate || !workspace) return;

  // ---------- 认证 / 门禁状态 ----------
  var authedUser = null;        // 当前登录用户（{ login, name, id }）或 null
  var workspaceInited = false; // 工作区是否已首次初始化（避免重复绑定草稿恢复）
  var editingSlug = null;      // 非 null 表示正在编辑已发布文章（update 模式），值为原 slug

  function setWorkspaceVisible(visible) {
    workspace.hidden = !visible;
    gate.hidden = !!visible;
  }

  function setGateStatus(msg, kind) {
    var el = $("gateStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "editor-status" + (kind ? " is-" + kind : "");
  }

  function applyAuthState(authed, u) {
    var userEl = $("authUser"), loginEl = $("authLogin"), logoutEl = $("authLogout");
    if (authed) {
      authedUser = u;
      userEl.textContent = "已登录：" + u.login + (u.name ? "（" + u.name + "）" : "");
      loginEl.hidden = true;
      logoutEl.hidden = false;
      setWorkspaceVisible(true);
      $("btnPublish").disabled = false;
      if (!workspaceInited) initWorkspace();
    } else {
      authedUser = null;
      userEl.textContent = "未登录";
      loginEl.hidden = false;
      logoutEl.hidden = true;
      setWorkspaceVisible(false);
      $("btnPublish").disabled = true;
      setGateStatus("", "");
    }
  }

  function refreshAuth() {
    if (!apiBase) return Promise.resolve(false);
    setGateStatus("正在验证登录状态…", "info");
    return fetch(apiBase + "/api/auth/me", { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : { login: null }; })
      .then(function (u) {
        var authed = !!(u && u.login);
        applyAuthState(authed, authed ? u : null);
        if (!authed) setGateStatus("", "");
        return authed;
      })
      .catch(function () {
        applyAuthState(false, null);
        setGateStatus("登录状态检查失败，请重试", "err");
        return false;
      });
  }

  // 会话失效（401）：重新锁定工作区，提示重新登录
  function relock() {
    applyAuthState(false, null);
    setGateStatus("会话已过期，请重新登录", "err");
  }

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

  function getQueryParam(name) {
    try { return new URLSearchParams(location.search).get(name); }
    catch (e) { return null; }
  }

  function findPostBySlug(slug) {
    var posts = window.POSTS || [];
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].slug === slug) return posts[i];
    }
    return null;
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
      editingSlug: editingSlug,   // 区分这份草稿是「新建」还是「编辑某篇已发布文章」
      updatedAt: new Date().toISOString()
    };
  }

  function applyDraft(d) {
    if (!d) return;
    editingSlug = d.editingSlug || null;
    fSlug.disabled = !!editingSlug;   // 编辑已发布文章时锁定 slug
    fTitle.value = d.title || "";
    fSlug.value = d.slug || "";
    fSlug.dataset.touched = editingSlug ? "1" : "";
    fDate.value = d.date || today();
    fCategory.value = d.category || "";
    fTags.value = d.tags || "";
    fExcerpt.value = d.excerpt || "";
    input.value = d.content || "";
    renderPreview();
    updateDeleteBtn();
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
          out.push({ key: k, slug: k.slice(DRAFT_PREFIX.length), updatedAt: d.updatedAt, title: d.title, editingSlug: d.editingSlug });
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
      var tag = d.editingSlug ? "［编辑］" : "";
      opt.textContent = (d.title || d.slug) + tag + " — " + (d.updatedAt || "").replace("T", " ").slice(0, 16);
      sel.appendChild(opt);
    });
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
      setStatus(editingSlug ? "已载入编辑草稿" : "已载入草稿", "ok");
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
    updateDeleteBtn();
  }

  function deleteDraftBySlug(slug) {
    if (!slug) return;
    localStorage.removeItem(DRAFT_PREFIX + slug);
    refreshDraftSelect();
  }

  function newDraft() {
    editingSlug = null;
    fSlug.disabled = false;
    fTitle.value = "";
    fSlug.value = "";
    fSlug.dataset.touched = "";
    fDate.value = today();
    fCategory.value = "";
    fTags.value = "";
    fExcerpt.value = "";
    input.value = "";
    renderPreview();
    setStatus("新草稿", "ok");
    refreshDraftSelect();
    updateDeleteBtn();
  }

  // ---------- 已发布文章选择 / 载入编辑 ----------
  function refreshPublishedSelect() {
    var sel = $("publishedSelect");
    if (!sel) return;
    var posts = window.POSTS || [];
    sel.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "选择已发布文章…";
    sel.appendChild(placeholder);
    posts.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.slug;
      opt.textContent = p.title + "（" + (p.date || "?") + "）";
      sel.appendChild(opt);
    });
  }

  function loadPublishedForEdit(slug) {
    var p = findPostBySlug(slug);
    if (!p) { setStatus("找不到文章：" + slug, "err"); return; }
    setStatus("正在载入「" + p.title + "」…", "info");
    // 加 cache-busting 查询参数：重新发布后浏览器/GitHub Pages 可能缓存旧 .md，
    // 不带版本号会一直返回上次发布前的内容。只破坏缓存，不影响解析（SimpleMarkdown 不看 query）。
    var mdUrl = p.file || ("posts/" + slug + ".md");
    var bust = (mdUrl.indexOf("?") === -1 ? "?" : "&") + "v=" + Date.now();
    fetch(mdUrl + bust)
      .then(function (r) {
        if (!r.ok) throw new Error("拉取正文失败 (" + r.status + ")");
        return r.text();
      })
      .then(function (md) {
        editingSlug = p.slug;
        fTitle.value = p.title || "";
        fSlug.value = p.slug;
        fSlug.dataset.touched = "1";
        fSlug.disabled = true;          // 编辑已发布文章时锁定 slug，改名 = 新建 + 留下孤儿
        fDate.value = p.date || "";
        fCategory.value = p.category || "";
        fTags.value = (p.tags || []).join(", ");
        fExcerpt.value = p.excerpt || "";
        input.value = md;
        renderPreview();
        var sel = $("publishedSelect");
        if (sel) sel.value = p.slug;
        setStatus("已载入「" + p.title + "」，修改后点发布即更新线上", "ok");
        updateDeleteBtn();
      })
      .catch(function (e) {
        setStatus("载入失败：" + e.message, "err");
      });
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
      // 在线模式：上传到 Git 仓库 assets/images/，成功后插入仓库相对路径
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
        if (r.status === 401) { relock(); throw new Error("未登录，请先用 GitHub 登录"); }
        if (!r.ok) throw new Error("上传失败 (" + r.status + ")");
        return r.json();
      }).then(function (res) {
        if (!res || !res.publicUrl) throw new Error("后端未返回图片地址");
        // 正文插入仓库相对路径（发布到线上后正确）。预览由 rebaseImgSrc
        // 改写成 raw 直链显示，本地不再 404。
        insertMarkdownImage(res.publicUrl, "截图");
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

  // ---------- 发布 ----------
  function publish() {
    if (!apiBase) { setStatus("未配置后端 API，无法在线发布", "err"); return; }
    var d = gatherDraft();
    var tags = d.tags.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
    var mode = editingSlug ? "update" : "create";
    var payload = {
      slug: editingSlug || d.slug,   // update 用原 slug（已锁定），create 用表单 slug
      title: d.title,
      date: d.date,
      excerpt: d.excerpt,
      category: d.category,
      tags: tags,
      content: d.content,
      mode: mode
    };
    // 基础前端校验
    if (!payload.slug || !/^[a-z0-9-]+$/.test(payload.slug)) {
      setStatus("slug 只能含小写字母、数字和连字符", "err"); return;
    }
    if (!payload.title) { setStatus("请填写标题", "err"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) { setStatus("日期格式应为 YYYY-MM-DD", "err"); return; }
    if (!payload.content) { setStatus("正文不能为空", "err"); return; }

    setStatus(mode === "update" ? "正在更新文章…" : "正在发布新文章…", "info");
    fetch(apiBase + "/api/posts/publish", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.status === 401) { relock(); throw new Error("未登录，请重新登录"); }
      if (r.status === 409) {
        throw new Error(mode === "update"
          ? "与远程冲突，请点「载入编辑」重新拉取该文章后再发布"
          : "slug 已存在，请换一个 slug，或用「已发布」下拉载入后修改");
      }
      if (!r.ok) {
        // 读错误体，区分「部分发布」（正文已写、注册表未写）
        return r.json().then(function (body) {
          var msg = (body && body.error) || ("发布失败 (" + r.status + ")");
          if (body && body.partial) {
            msg = "部分发布：正文已写入 main，但注册表 js/posts.js 未更新，请到仓库检查并手动补条目。";
          }
          var e = new Error(msg);
          e.partial = !!(body && body.partial);
          throw e;
        });
      }
      return r.json();
    }).then(function (res) {
      var msg = (res && res.mode === "update")
        ? "已更新文章「" + payload.slug + "」"
        : "已发布新文章「" + payload.slug + "」";
      msg += "。GitHub Pages 会自动部署，注意有缓存延迟。";
      setStatus(msg, "ok");
      // 发布成功：清理该 slug 的本地草稿，避免残留旧内容
      deleteDraftBySlug(payload.slug);
      // 发布成功后切到 update 模式并锁定 slug，避免误把后续改动当新建
      editingSlug = payload.slug;
      fSlug.value = payload.slug;
      fSlug.dataset.touched = "1";
      fSlug.disabled = true;
      // 已发布下拉同步选中
      var sel = $("publishedSelect");
      if (sel) sel.value = payload.slug;
      // 刷新已发布清单（新建后让新文章出现在下拉里）
      refreshPublishedSelect();
      updateDeleteBtn();
    }).catch(function (e) {
      setStatus("发布失败：" + e.message, "err");
    });
  }

  // ---------- 删除已发布文章 ----------
  // 删除按钮只在「正在编辑某篇已发布文章」（editingSlug 非空）时可用。
  function updateDeleteBtn() {
    var btn = $("btnDeletePublished");
    if (!btn) return;
    btn.disabled = !editingSlug;
  }

  function deletePublished() {
    if (!apiBase) { setStatus("未配置后端 API，无法删除", "err"); return; }
    if (!editingSlug) { setStatus("请先「载入编辑」一篇已发布文章再删除", "err"); return; }
    var slug = editingSlug;
    // 二次确认：删除不可逆，会连同正文与图片一起从 main 删除
    var ok = window.confirm(
      "确定删除文章「" + slug + "」？\n\n" +
      "这会从 main 分支删除 posts/" + slug + ".md、js/posts.js 中的注册表条目，" +
      "以及正文中引用的 assets/images/ 图片。此操作不可撤销。"
    );
    if (!ok) return;
    setStatus("正在删除「" + slug + "」…", "info");
    fetch(apiBase + "/api/posts/delete", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: slug })
    }).then(function (r) {
      if (r.status === 401) { relock(); throw new Error("未登录，请重新登录"); }
      if (r.status === 409) throw new Error("与远程冲突，请点「载入编辑」重新拉取后再删除");
      if (!r.ok) {
        return r.json().then(function (body) {
          var msg = (body && body.error) || ("删除失败 (" + r.status + ")");
          if (body && body.partial) msg = "部分删除：" + msg + "。请到仓库检查残留文件。";
          throw new Error(msg);
        });
      }
      return r.json();
    }).then(function (res) {
      setStatus(res.message || ("已删除「" + slug + "」"), "ok");
      // 删除该 slug 的本地草稿（若有）
      deleteDraftBySlug(slug);
      // 重置为新建草稿状态
      editingSlug = null;
      fSlug.disabled = false;
      // 从已发布下拉移除该项
      refreshPublishedSelect();
      newDraft();
    }).catch(function (e) {
      setStatus("删除失败：" + e.message, "err");
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
    // 未手动改过 slug 时自动同步（编辑已发布文章时 slug 已锁定，不会触发）
    if (!fSlug.dataset.touched && !fSlug.disabled) fSlug.value = slugify(fTitle.value);
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

  var loadPubBtn = $("btnLoadPublished");
  var pubSelect = $("publishedSelect");
  if (loadPubBtn && pubSelect) {
    loadPubBtn.addEventListener("click", function () {
      var slug = pubSelect.value;
      if (slug) loadPublishedForEdit(slug);
    });
  }

  var delPubBtn = $("btnDeletePublished");
  if (delPubBtn) {
    delPubBtn.addEventListener("click", deletePublished);
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
        .finally(function () {
          editingSlug = null;
          if (fSlug) fSlug.disabled = false;
          updateDeleteBtn();
          applyAuthState(false, null);
          setGateStatus("已退出登录", "info");
        });
    });
  }

  // 离开页面自动存草稿（仅在已进入工作区后）
  window.addEventListener("beforeunload", function () {
    if (workspaceInited) saveCurrentDraft(true);
  });

  // ---------- 工作区初始化（登录成功后首次调用） ----------
  function initWorkspace() {
    workspaceInited = true;
    refreshPublishedSelect();
    // ?edit=<slug> 直接打开指定已发布文章编辑；否则恢复最近草稿或新建
    var editSlug = getQueryParam("edit");
    if (editSlug && findPostBySlug(editSlug)) {
      loadPublishedForEdit(editSlug);
      refreshDraftSelect();
    } else {
      if (editSlug) setStatus("未找到 ?edit=" + editSlug + " 对应的文章，已新建草稿", "info");
      var drafts = listDrafts();
      if (drafts.length) loadDraft(drafts[0].key); else newDraft();
    }
    setStatus("就绪，已登录为 " + (authedUser ? authedUser.login : ""), "ok");
    updateDeleteBtn();
  }

  // ---------- 初始化 ----------
  function init() {
    // 默认：门禁可见、工作区隐藏（HTML 已设 hidden，这里显式再设一次以防脚本加载顺序差异）
    setWorkspaceVisible(false);
    if (!apiBase) {
      // 未配置发布服务：不显示编辑器，只给提示
      var noSvc = $("noServiceHint");
      if (noSvc) noSvc.hidden = false;
      if (loginEl) loginEl.hidden = true;
      setGateStatus("", "");
      return;
    }
    // 已配置 apiBase：检查会话，登录则显示工作区
    refreshAuth();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
