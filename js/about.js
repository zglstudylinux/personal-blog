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
