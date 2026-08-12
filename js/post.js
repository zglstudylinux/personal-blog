/* ============================================================
   post.js - 文章详情页：加载 Markdown、渲染、上一篇/下一篇
   ============================================================ */
(function () {
  "use strict";

  var POSTS = window.POSTS || [];
  var titleEl = document.getElementById("postTitle");
  var metaEl = document.getElementById("postMeta");
  var bodyEl = document.getElementById("postBody");
  var navEl = document.getElementById("postNav");
  if (!titleEl || !bodyEl) return;

  // 从 ?p=slug 取 slug，缺省取第一篇
  function getSlug() {
    var p = new URLSearchParams(location.search).get("p");
    if (p) return p;
    return POSTS.length ? POSTS[0].slug : "";
  }

  function fmtMeta(p) {
    var cfg = window.SITE_CONFIG || {};
    // 用 DOM API 构建，避免标题/标签/专栏等来自编辑器的内容进入未经处理的 innerHTML
    var wrap = document.createElement("div");
    wrap.className = "article__meta";

    var time = document.createElement("time");
    time.setAttribute("datetime", p.date);
    time.textContent = p.date;
    wrap.appendChild(time);

    if (cfg.author) {
      wrap.appendChild(makeDot());
      var au = document.createElement("span");
      au.textContent = cfg.author;
      wrap.appendChild(au);
    }

    if (p.category) {
      wrap.appendChild(makeDot());
      var cat = document.createElement("a");
      cat.className = "meta-cat";
      cat.href = "index.html?cat=" + encodeURIComponent(p.category);
      cat.textContent = p.category;
      wrap.appendChild(cat);
    }

    (p.tags || []).forEach(function (t) {
      wrap.appendChild(makeDot());
      var tg = document.createElement("span");
      tg.className = "tag";
      tg.textContent = t;
      wrap.appendChild(tg);
    });
    return wrap;
  }

  function makeDot() {
    var d = document.createElement("span");
    d.className = "dot";
    d.textContent = "·";
    return d;
  }

  // 加载 Markdown 文件
  function fetchMd(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      });
  }

  // 提取 Markdown 首段或前 ~120 字作为摘要（当配置里没 excerpt 时兜底）
  function setError(msg) {
    bodyEl.classList.add("is-error");
    bodyEl.innerHTML = "<p>" + msg + "</p>" +
      '<p><a href="index.html">← 返回文章列表</a></p>';
  }

  function renderPost(p) {
    document.title = p.title + " - " + (window.SITE_CONFIG.name || "博客");
    titleEl.textContent = p.title;
    metaEl.innerHTML = "";
    metaEl.appendChild(fmtMeta(p));
    var file = p.file || ("posts/" + p.slug + ".md");

    fetchMd(file).then(function (md) {
      bodyEl.classList.remove("is-error");
      bodyEl.innerHTML = window.SimpleMarkdown.render(md);
      // 渲染后增强：Mermaid 图表 + 代码语法高亮。
      // 单块 Mermaid 渲染失败已在 BlogEnhance 内部降级为源码展示，不会抛到这层；
      // 这里再加一层 try/catch 兜底，确保即使 enhance 整体抛错也不会把「正文已加载成功」
      // 误报成「找不到文章」。
      try {
        if (window.BlogEnhance) window.BlogEnhance.enhance(bodyEl);
      } catch (enhErr) {
        console.warn("enhance 失败（正文已加载，保留原文）:", enhErr);
      }
      // 跳转后定位到页顶
      window.scrollTo(0, 0);
    }).catch(function () {
      setError("加载文章失败：找不到 " + file + "。请检查 posts.js 里的配置，或通过本地服务器（不是直接双击 html）打开。");
    });
  }

  function renderNav(idx) {
    if (!navEl) return;
    var prev = POSTS[idx - 1];
    var next = POSTS[idx + 1];
    navEl.innerHTML = "";
    if (prev) {
      var a1 = document.createElement("a");
      a1.className = "post-nav__item";
      a1.href = "post.html?p=" + encodeURIComponent(prev.slug);
      a1.appendChild(makeNav("上一篇", prev.title));
      navEl.appendChild(a1);
    } else {
      navEl.appendChild(document.createElement("span"));
    }
    if (next) {
      var a2 = document.createElement("a");
      a2.className = "post-nav__item post-nav__item--next";
      a2.href = "post.html?p=" + encodeURIComponent(next.slug);
      a2.appendChild(makeNav("下一篇", next.title));
      navEl.appendChild(a2);
    } else {
      navEl.appendChild(document.createElement("span"));
    }
  }

  function makeNav(label, title) {
    var frag = document.createDocumentFragment();
    var lab = document.createElement("div");
    lab.className = "post-nav__label";
    lab.textContent = label;
    var t = document.createElement("div");
    t.className = "post-nav__title";
    t.textContent = title;
    frag.appendChild(lab);
    frag.appendChild(t);
    return frag;
  }

  // 同专栏前后篇导航（在通用前后篇之外，按 category 分组）
  function renderSeriesNav(current) {
    var navEl = document.getElementById("seriesNav");
    if (!navEl || !current || !current.category) {
      if (navEl) navEl.hidden = true;
      return;
    }
    var same = POSTS.filter(function (p) { return p.category === current.category; });
    if (same.length < 2) { navEl.hidden = true; return; }
    same.sort(function (a, b) { return (a.date < b.date) ? 1 : (a.date > b.date) ? -1 : 0; });
    var i = same.findIndex(function (p) { return p.slug === current.slug; });
    var prev = same[i + 1];
    var next = same[i - 1];
    var titleEl = document.getElementById("seriesName");
    if (titleEl) titleEl.textContent = current.category;
    var wrap = document.getElementById("seriesNavItems");
    wrap.innerHTML = "";
    if (prev) {
      var a = document.createElement("a");
      a.className = "post-nav__item";
      a.href = "post.html?p=" + encodeURIComponent(prev.slug);
      a.appendChild(makeNav("同专栏 · 上一篇", prev.title));
      wrap.appendChild(a);
    } else {
      wrap.appendChild(document.createElement("span"));
    }
    if (next) {
      var b = document.createElement("a");
      b.className = "post-nav__item post-nav__item--next";
      b.href = "post.html?p=" + encodeURIComponent(next.slug);
      b.appendChild(makeNav("同专栏 · 下一篇", next.title));
      wrap.appendChild(b);
    } else {
      wrap.appendChild(document.createElement("span"));
    }
    navEl.hidden = false;
  }

  var slug = getSlug();
  var idx = POSTS.findIndex(function (p) { return p.slug === slug; });
  if (idx === -1) {
    document.title = "未找到文章";
    titleEl.textContent = "未找到文章";
    metaEl.innerHTML = "";
    setError("找不到这篇文章（slug: " + slug + "）。请回到列表页重新选择。");
    return;
  }
  renderPost(POSTS[idx]);
  renderNav(idx);
  renderSeriesNav(POSTS[idx]);
})();
