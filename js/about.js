/* ============================================================
   about.js - 关于页：加载 about.md 并渲染
   ============================================================ */
(function () {
  "use strict";
  var body = document.getElementById("aboutBody");
  if (!body) return;

  document.title = "关于 - " + (window.SITE_CONFIG.name || "博客");

  fetch("posts/about.md", { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    })
    .then(function (md) {
      try {
        body.innerHTML = window.SimpleMarkdown.render(md);
        // 渲染后增强：Mermaid 图表 + 代码语法高亮。
        // 单块 Mermaid 渲染失败已在 BlogEnhance 内部降级为源码展示，不会抛到这层；
        // 这里再加一层 try/catch 兜底，确保即使 enhance 整体抛错也不会把 about 正文清掉。
        try {
          if (window.BlogEnhance) window.BlogEnhance.enhance(body);
        } catch (enhErr) {
          console.warn("enhance 失败（about 正文已加载，保留原文）:", enhErr);
        }
      } catch (e) {
        throw e; // 渲染抛错也走 catch，给出更明确的提示
      }
    })
    .catch(function (err) {
      console.error("about.js 加载/渲染失败:", err);
      body.classList.add("is-error");
      var msg = err && err.message ? err.message : "未知错误";
      body.innerHTML =
        "<p>关于页加载失败：" + msg + "。</p>" +
        "<p>请确认通过本地服务器（python -m http.server 或 npx serve）打开本站，而不是直接双击 html 文件。</p>";
    });
})();
