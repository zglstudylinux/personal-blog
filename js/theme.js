/* ============================================================
   theme.js - 深浅色主题切换
   ============================================================ */
(function () {
  "use strict";

  function getStored() {
    try { return localStorage.getItem("theme"); } catch (e) { return null; }
  }
  function setStored(t) {
    try { localStorage.setItem("theme", t); } catch (e) {}
  }
  function systemLight() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
  }

  // 初始化（HTML 内联脚本已设置过，这里只兜底）
  if (!document.documentElement.getAttribute("data-theme")) {
    var cfg = (window.SITE_CONFIG && window.SITE_CONFIG.defaultTheme) || "dark";
    var t = (cfg === "auto") ? (systemLight() ? "light" : "dark") : cfg;
    applyTheme(t);
  }

  // 绑定切换按钮
  function bindToggle() {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme") || "dark";
      var next = cur === "dark" ? "light" : "dark";
      applyTheme(next);
      setStored(next);
      // 通知增强模块（Mermaid 重渲染 + highlight.js 主题 CSS 切换）。
      // 事件在 applyTheme 之后派发，订阅者读到的是新主题。
      document.dispatchEvent(new CustomEvent("blog:themechange"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindToggle);
  } else {
    bindToggle();
  }
})();
