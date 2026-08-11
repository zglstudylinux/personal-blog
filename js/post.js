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
    var parts = [];
    parts.push('<time datetime="' + p.date + '">' + p.date + '</time>');
    if (cfg.author) {
      parts.push('<span class="dot">·</span>');
      parts.push('<span>' + cfg.author + '</span>');
    }
    (p.tags || []).forEach(function (t) {
      parts.push('<span class="dot">·</span>');
      parts.push('<span class="tag">' + t + '</span>');
    });
    return parts.join("");
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
    metaEl.innerHTML = fmtMeta(p);
    var file = p.file || ("posts/" + p.slug + ".md");

    fetchMd(file).then(function (md) {
      bodyEl.classList.remove("is-error");
      bodyEl.innerHTML = window.SimpleMarkdown.render(md);
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
    var html = "";
    if (prev) {
      html += '<a class="post-nav__item" href="post.html?p=' + encodeURIComponent(prev.slug) + '">' +
        '<div class="post-nav__label">上一篇</div>' +
        '<div class="post-nav__title">' + prev.title + '</div></a>';
    } else {
      html += '<span></span>';
    }
    if (next) {
      html += '<a class="post-nav__item post-nav__item--next" href="post.html?p=' + encodeURIComponent(next.slug) + '">' +
        '<div class="post-nav__label">下一篇</div>' +
        '<div class="post-nav__title">' + next.title + '</div></a>';
    } else {
      html += '<span></span>';
    }
    navEl.innerHTML = html;
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
})();
