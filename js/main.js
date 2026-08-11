/* ============================================================
   main.js - 全页通用逻辑：页脚年份、当前导航高亮
   ============================================================ */
(function () {
  "use strict";

  function fillYear() {
    var el = document.getElementById("year");
    if (el) el.textContent = new Date().getFullYear();
  }

  // 标记当前页对应的导航项
  function markNav() {
    var path = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav__link").forEach(function (a) {
      var href = a.getAttribute("href");
      a.classList.toggle("is-active", href === path);
    });
  }

  function init() {
    fillYear();
    markNav();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
