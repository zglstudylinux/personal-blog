/* ============================================================
   diagram-highlight.js - 渲染后增强：Mermaid 图表 + 代码高亮
   ------------------------------------------------------------
   这是一个「渲染后增强」模块，不改 window.SimpleMarkdown.render 的同步与安全契约。
   SimpleMarkdown 把 ```mermaid 与 ```<lang> 渲染成 <pre><code class="language-...">…</code></pre>
   （内容已经过 escapeHtml，安全）；本模块在容器挂到 DOM 后再扫描这些节点：
     - pre > code.language-mermaid → 调用 mermaid 渲染成 SVG，包进 .mermaid-container
     - pre code[class*="language-"]（非 mermaid）→ 调用 hljs.highlightElement 做语法高亮
   降级：mermaid / hljs 未加载或单块渲染失败时，保留 SimpleMarkdown 原本输出的可读 <pre><code>。
   主题：监听 document 的 blog:themechange 事件，重渲染 Mermaid 并切换 highlight.js 主题 CSS。
   竞态：enhance(container, gen) 接受一个数字 gen；每次调用前在 container 上记 _blogGen=gen，
     Mermaid 9.4.3 的 render 是【同步回调式】API（render(id, code, cb) 期间同步触发 cb），
     但 cb 仍可能在后续 enhance 已替换容器后才跑，故写 DOM 前比较 container._blogGen===gen
     与 pre 是否仍在容器，不等说明容器已被更新一轮渲染，当前回调作废。
     编辑器预览（120ms debounce + 整体替换 innerHTML）靠这条避免旧 SVG 落到新 DOM。
   安全：Mermaid 用 securityLevel:'strict'，源码取 textContent（DOM 解码回原始文本，
   不走 innerHTML）；hljs 读 textContent 生成转义 token。二者都不引入新的未转义 HTML。
   ============================================================ */
(function () {
  "use strict";

  var idCounter = 0;
  // 已渲染的 Mermaid 记录，用于主题切换时重渲染。条目 { pre, wrap, code, container }。
  var registry = [];
  var initialized = false;
  var curMermaidTheme = null;

  function isDark() {
    return document.documentElement.getAttribute("data-theme") !== "light";
  }

  function mermaidThemeName() {
    return isDark() ? "dark" : "default";
  }

  function ensureInit() {
    if (initialized) return;
    initialized = true;
    curMermaidTheme = mermaidThemeName();
    if (window.mermaid) {
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: curMermaidTheme,
          fontFamily: "inherit"
        });
      } catch (e) {
        // mermaid.initialize 失败不阻塞后续降级
      }
    }
    // 切主题：Mermaid 重渲染 + highlight.js CSS 切换
    document.addEventListener("blog:themechange", onThemeChange);
    applyHljsTheme();
  }

  // 切换 highlight.js 主题 CSS：两个 <link data-hljs-theme> 只启用一个。
  function applyHljsTheme() {
    var want = isDark() ? "dark" : "light";
    var links = document.querySelectorAll('link[data-hljs-theme]');
    for (var i = 0; i < links.length; i++) {
      links[i].disabled = (links[i].getAttribute("data-hljs-theme") !== want);
    }
  }

  function onThemeChange() {
    applyHljsTheme();
    if (!window.mermaid) return;
    var nextTheme = mermaidThemeName();
    if (nextTheme === curMermaidTheme) return;
    curMermaidTheme = nextTheme;
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: nextTheme,
        fontFamily: "inherit"
      });
    } catch (e) { return; }
    // 清理失效条目（容器已被替换，pre 脱离 DOM）
    registry = registry.filter(function (r) {
      return r.pre.parentNode && r.container && r.container.contains(r.pre);
    });
    for (var i = 0; i < registry.length; i++) {
      (function (r) {
        var id = "mmd-" + (++idCounter);
        // 与首次渲染一致：9.4.3 的 mermaid.render 是【同步回调式】API，
        //   render(id, code, cb) 同步回调 cb(svg, bindFunctions)。
        // 错误（含 # : = < 等特殊字符未双引号包裹）是【同步抛出】，
        // try/catch 兜住，避免切主题时把 onThemeChange 打断；失败时保留旧 SVG。
        try {
          window.mermaid.render(id, r.code, function (svg, bindFunctions) {
            // 容器可能又被替换；写之前再确认一次
            if (!r.wrap.parentNode) return;
            r.wrap.innerHTML = svg;
            if (bindFunctions) bindFunctions(r.wrap);
          });
        } catch (e) { /* 同步抛错：保留旧 SVG */ }
      })(registry[i]);
    }
  }

  // 容器是否已「翻篇」：当前 gen 与最近一次 enhance 的 gen 不等，或 pre 已脱离容器。
  function stale(container, gen, pre) {
    if (container && typeof gen === "number" && gen !== 0) {
      if (container._blogGen !== gen) return true;
    }
    if (pre && (!pre.parentNode || (container && !container.contains(pre)))) return true;
    return false;
  }

  function enhanceMermaid(container, gen) {
    if (!window.mermaid) return;
    var blocks = container.querySelectorAll("pre > code.language-mermaid");
    Array.prototype.forEach.call(blocks, function (codeEl) {
      if (codeEl.getAttribute("data-mmd-rendered")) return;
      var pre = codeEl.parentNode;
      // textContent 由 DOM 把 SimpleMarkdown 转义后的实体解码回原始源码，正是 Mermaid 需要的输入。
      var code = codeEl.textContent;
      codeEl.setAttribute("data-mmd-rendered", "1");
      pre.classList.add("is-mermaid-pending");

      var id = "mmd-" + (++idCounter);
      // Mermaid 9.4.3 的 mermaid.render 是【同步回调式】API，签名 render(id, code, cb, container?)：
      //   cb(svg, bindFunctions) 在 render 调用期间【同步】触发，render 返回值是 svg 字符串（非 Promise）。
      // 切不可按 Mermaid 10+ 的 Promise 链（.then/.catch）来写——9.4.3 下返回的是字符串，
      //   typeof ret.then === "function" 恒为 false，SVG 被算出后直接丢弃，既不插入也不报错，
      //   表现为「没报错、也没图表」（本次报告的现象）。
      // 9.4.3 的词法/解析错误（含 # : = < 等特殊字符未双引号包裹）是【同步抛出】，
      // 这里用 try/catch 兜住，降级为 .is-mermaid-fallback，不中断后续块、不上抛。
      try {
        window.mermaid.render(id, code, function (svg, bindFunctions) {
          if (stale(container, gen, pre)) return;
          var wrap = document.createElement("div");
          wrap.className = "mermaid-container";
          wrap.setAttribute("role", "img");
          wrap.innerHTML = svg;
          if (bindFunctions) bindFunctions(wrap);
          pre.parentNode.insertBefore(wrap, pre);
          pre.style.display = "none";
          pre.classList.remove("is-mermaid-pending");
          registry.push({ pre: pre, wrap: wrap, code: code, container: container });
        });
      } catch (e) {
        // 同步抛错：降级为源码展示，不中断后续块、不上抛。
        // 把具体错误写到 pre.title（悬停可见）并 console.warn，
        // 便于作者定位是哪个字符触发了词法错误（# : = < 等需双引号包裹）。
        if (stale(container, gen, pre)) return;
        pre.classList.remove("is-mermaid-pending");
        pre.classList.add("is-mermaid-fallback");
        try { pre.title = "Mermaid 渲染失败：" + (e && e.message ? e.message : e); } catch (_) {}
        console.warn("Mermaid 渲染失败，已降级为源码展示。错误：", e);
      }
    });
  }

  function enhanceHighlight(container) {
    if (!window.hljs) return;
    var blocks = container.querySelectorAll('pre code[class*="language-"]');
    Array.prototype.forEach.call(blocks, function (codeEl) {
      if (codeEl.getAttribute("data-hl-done")) return;
      if (codeEl.classList.contains("language-mermaid")) return;
      codeEl.setAttribute("data-hl-done", "1");
      try {
        window.hljs.highlightElement(codeEl);
      } catch (e) {
        // 单块高亮失败：保留原样，不抛
      }
    });
  }

  // 公开入口。gen 可选，编辑器预览用来防异步竞态；post/about 页不传。
  function enhance(container, gen) {
    if (!container) return;
    ensureInit();
    if (typeof gen === "number" && gen !== 0) {
      container._blogGen = gen;
    }
    enhanceHighlight(container);
    enhanceMermaid(container, gen);
  }

  window.BlogEnhance = { enhance: enhance };
})();
