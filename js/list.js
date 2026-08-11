/* ============================================================
   list.js - 首页文章列表渲染 + 搜索 + 标签筛选
   ============================================================ */
(function () {
  "use strict";

  var POSTS = window.POSTS || [];
  var container = document.getElementById("postList");
  var searchInput = document.getElementById("searchInput");
  var tagFilter = document.getElementById("tagFilter");
  var emptyHint = document.getElementById("emptyHint");
  if (!container) return;

  var activeTag = null;

  // 格式化日期：2026-08-03 -> 08月03日；保留年份在 title 属性
  function fmtDate(d) {
    var parts = d.split("-");
    if (parts.length !== 3) return d;
    return parts[1] + "月" + parts[2] + "日";
  }

  // 采集所有标签及其计数
  function allTags() {
    var map = {};
    POSTS.forEach(function (p) {
      (p.tags || []).forEach(function (t) { map[t] = (map[t] || 0) + 1; });
    });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; });
  }

  function renderTags() {
    if (!tagFilter) return;
    var tags = allTags();
    tagFilter.innerHTML = "";
    tags.forEach(function (t) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (activeTag === t ? " is-active" : "");
      chip.textContent = "#" + t;
      chip.addEventListener("click", function () {
        activeTag = (activeTag === t) ? null : t;
        renderTags();
        renderList();
      });
      tagFilter.appendChild(chip);
    });
  }

  function renderList() {
    var q = (searchInput && searchInput.value || "").trim().toLowerCase();
    var list = POSTS.slice().sort(function (a, b) {
      return (a.date < b.date) ? 1 : (a.date > b.date) ? -1 : 0;
    });

    list = list.filter(function (p) {
      if (activeTag && !(p.tags || []).includes(activeTag)) return false;
      if (q) {
        var hay = (p.title + " " + (p.excerpt || "") + " " + (p.tags || []).join(" ")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    container.innerHTML = "";
    if (list.length === 0) {
      if (emptyHint) emptyHint.hidden = false;
      return;
    }
    if (emptyHint) emptyHint.hidden = true;

    list.forEach(function (p) {
      var card = document.createElement("article");
      card.className = "post-card";

      var date = document.createElement("div");
      date.className = "post-card__date";
      date.textContent = fmtDate(p.date);
      date.title = p.date;

      var main = document.createElement("div");
      main.className = "post-card__main";

      var title = document.createElement("h2");
      title.className = "post-card__title";
      var link = document.createElement("a");
      link.href = "post.html?p=" + encodeURIComponent(p.slug);
      link.textContent = p.title;
      title.appendChild(link);
      main.appendChild(title);

      if (p.excerpt) {
        var ex = document.createElement("p");
        ex.className = "post-card__excerpt";
        ex.textContent = p.excerpt;
        main.appendChild(ex);
      }

      if (p.tags && p.tags.length) {
        var tags = document.createElement("div");
        tags.className = "post-card__tags";
        p.tags.forEach(function (t) {
          var s = document.createElement("span");
          s.className = "post-card__tag";
          s.textContent = "#" + t;
          tags.appendChild(s);
        });
        main.appendChild(tags);
      }

      card.appendChild(date);
      card.appendChild(main);
      container.appendChild(card);
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", renderList);
  }

  renderTags();
  renderList();
})();
