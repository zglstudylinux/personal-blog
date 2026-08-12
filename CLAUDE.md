# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

一个面向嵌入式开发者的、阅读优先的个人博客。纯静态站点：HTML + CSS + 原生 JS，零依赖、零构建步骤、无打包器。内容用 Markdown 编写，由一个自研解析器在前端渲染。部署目标是 GitHub Pages 或 EdgeOne Pages（纯静态，无需构建命令）。

**线上地址**：<https://zglstudylinux.github.io/personal-blog/>（GitHub Pages，`main` 分支根目录；每次推送 `main` 自动重新部署）

## 本地预览（必须）

页面通过 `fetch()` 加载 Markdown，所以**必须**通过 HTTP 服务器打开 —— 直接用 `file://` 打开 `index.html` 会静默失败（文章和关于页加载不出来，本地文件被 CORS 拦截）。

```powershell
python -m http.server 8000   # 然后访问 http://localhost:8000
# 或
npx serve
```

没有构建、lint 或测试步骤。"验证一处改动"的意思是：起服务，然后在浏览器里依次点开 首页 → 文章 → 关于。

## 架构

### 四个页面，各自脚本组合不同

- `index.html` —— 文章列表。脚本顺序：config → posts → markdown → theme → main → **list**（不加载 vendor 与增强模块 —— 首页没有正文容器，无东西可增强）
- `post.html` —— 文章详情。脚本顺序：config → posts → markdown → **highlight → mermaid** → theme → main → **diagram-highlight** → **post**
- `about.html` —— 关于页。脚本顺序：config → markdown → **highlight → mermaid** → theme → main → **diagram-highlight** → **about**（刻意省略 `posts.js` —— 关于页不需要注册表）
- `editor.html` —— 网页写作。脚本顺序：config → posts → markdown → **highlight → mermaid** → theme → main → **diagram-highlight** → **editor**

脚本加载顺序是真实的依赖链，不是装饰：`config.js` 设置 `window.SITE_CONFIG`，`posts.js` 设置 `window.POSTS`，`markdown.js` 设置 `window.SimpleMarkdown`，`vendor/highlight/highlight.min.js` 设置 `window.hljs`，`vendor/mermaid/mermaid.min.js` 设置 `window.mermaid`；`diagram-highlight.js` 设置 `window.BlogEnhance` 并在 `ensureInit()` 里监听 `blog:themechange`（必须晚于 `theme.js` 加载，否则绑不到事件源——实际上它用 document 级事件且 `ensureInit` 在首次 `enhance()` 时才跑，顺序容错较强，但仍按约定放 `theme.js` 之后）；页面专属脚本（list/post/about/editor）消费它需要的那些。调换顺序或删掉某个 `<script>` 标签会让页面失效或退化为无增强的纯文本代码块。

`<head>` 里还有两个 highlight.js 主题 CSS `<link data-hljs-theme="dark|light">`：默认启用浅色那张、禁用深色那张（`disabled` 属性），由 `diagram-highlight.js` 的 `applyHljsTheme()` 按 `data-theme` 切换 `disabled`。两张都加载、只启用一张，切主题零闪烁、零网络往返。

### 内容管理：靠注册表，不靠 frontmatter

**没有 frontmatter，也不会自动扫描文件**。`js/posts.js` 是唯一的内容来源 —— 一个手工维护的 `window.POSTS` 数组。新增文章：把 `.md` 放进 `posts/`，然后往 `POSTS` 里加一条，字段包括 `slug`（和文件名一致）、`title`、`date`（YYYY-MM-DD）、`excerpt`、`category`（主专栏，一篇文章只属于一个专栏，留空归入「未分类」）、`tags`（数组），以及可选的 `file`（默认 `posts/<slug>.md`）。没有登记的 `.md` 文件对站点不可见。

唯一例外是 `posts/about.md` —— 它由 `about.js` 直接按固定路径 `"posts/about.md"` 拉取，不走 `POSTS` 注册表。

在线发布（见下文「编辑器与在线发布后端」）时，Worker 会**同时**生成 `posts/<slug>.md` 和在 `js/posts.js` 末尾追加注册表条目 —— 两步必须一起做，否则文章不可见。

### 路由

- 文章：`post.html?p=<slug>` —— `post.js` 读 `URLSearchParams`，在 `POSTS` 里按 `slug` 查条目，拉取对应 markdown，渲染进 `#postBody`。未知 slug → 内联错误提示。上一篇/下一篇导航按注册表索引计算；同专栏前后篇由 `renderSeriesNav()` 按 `category` 分组计算（仅当同专栏 ≥2 篇时显示 `#seriesNav`）。
- 专栏筛选：`index.html?cat=<专栏名>` —— `list.js` 从 `URLSearchParams` 读 `cat` 作为初始专栏筛选。
- 关于：静态的 `about.html`，直接拉取固定路径 `posts/about.md`。
- 写作：`editor.html`，独立脚本 `editor.js`，不依赖 `posts.js`。

### Markdown 渲染（`js/markdown.js`）

`window.SimpleMarkdown.render(md)` —— 一个零依赖解析器，覆盖标题、段落、加粗/斜体/删除线、行内代码、围栏代码块、引用、有序/无序列表、表格、分隔线、链接、图片。输入做 HTML 转义（防 XSS），图片/链接走 `safeUrl()` 协议白名单（拒绝 `javascript:` / `vbscript:` / `file:`，`data:` 仅限安全图片类型），危险 URL 退化为纯文本/转义文本而非真实链接或 `<img>`。围栏代码块输出 `<pre><code class="language-<lang>">…</code></pre>`，内容已 `escapeHtml`；围栏正则是 `/^```(\w*)\s*$/`，注意 `\w*` 不匹配 `c++` / `objective-c` 这类带非单词字符的语言名，未知语言名安全地保留为普通代码块。

**关键不变量：** `inline(s, codes)` 辅助函数先把行内代码提取成占位表（`" «index» "`），处理其它格式后再还原。`codes` 数组通过参数在递归调用间传递（链接文本里可能再嵌套行内代码，比如 `` `[`js/posts.js`](../js/posts.js) ``）。`inline()` 内部对 `inline()` 的每次递归调用都必须传同一份 `codes` —— 如果某次递归自己 new 了一份 `codes`，外层占位就再也还原不了，`render()` 会抛 `Cannot read properties of undefined (reading 'replace')`。这是一次真实出现过的 bug，把关于页搞挂过。不要把 `inline()` "简化"回使用局部 `codes`。

### 渲染后增强：Mermaid 图表 + 代码高亮（`js/diagram-highlight.js`）

`SimpleMarkdown.render()` 保持同步且安全，**不**在它内部做 Mermaid / highlight.js。增强是「渲染后」的独立一层：页面脚本把 `render()` 返回的安全 HTML 字符串塞进容器 `innerHTML`，再调 `window.BlogEnhance.enhance(container, gen)` 扫描已挂载的节点：

- `pre > code.language-mermaid` → 用 `window.mermaid.render(id, code, function(svg, bindFunctions){...})` 渲染成 SVG，在回调里把 `svg` 包进 `<div class="mermaid-container">` 插到 `<pre>` 前，原 `<pre>` `display:none` 保留（作降级源）。源码取 `codeEl.textContent`（DOM 把 `escapeHtml` 的实体解码回原始文本，**不走 innerHTML**）。
- `pre code[class*="language-"]`（非 mermaid）→ `window.hljs.highlightElement(codeEl)`。
- 两处都已 `data-mmd-rendered` / `data-hl-done` 去重，避免重复增强。

**Mermaid 9.4.3 API 不变量（不可违反，否则「没报错也没图表」）：** 本站自托管的是 Mermaid **9.4.3**，其 `mermaid.render` 是**同步回调式** API，签名 `render(id, code, cb, container?)`：`cb(svg, bindFunctions)` 在 `render()` 调用期间**同步**触发，`render()` 的返回值是 svg **字符串**（不是 Promise）。9.4.3 源码里甚至有一行守卫 `if("then"in Z) throw new Error("Diagram is a promise. Use renderAsync.")`——它主动拒绝 Promise 语义。

**绝不能**按 Mermaid 10+ 的 Promise 链来写：`var ret = mermaid.render(id, code); if (ret && typeof ret.then === "function") { ret.then(...).catch(...) }`。在 9.4.3 里 `ret` 是字符串，`typeof ret.then === "function"` **恒为 false**，整个 `.then` 块（插 SVG 那段）永远不执行——SVG 被 mermaid 算出来后**直接丢弃，既不插入也不报错**。这正是本次修过的一个真实 bug：升级或重构 `diagram-highlight.js` 时，**不要**「简化」回调式写法为 Promise 链，也不要去用 `renderAsync`（那是 9.4.3 才有的异步包装，签名又不一样，徒增复杂度）。认准 `render(id, code, cb)` 这一种。

9.4.3 的词法/解析错误是**同步抛出**（不是 reject），所以 `enhanceMermaid` 和 `onThemeChange` 都用 `try/catch` 包住 `mermaid.render(...)`，捕获后降级为 `.is-mermaid-fallback`（首渲）或保留旧 SVG（切主题时），不中断后续块、不上抛。

**降级铁律：** `window.mermaid` 或 `window.hljs` 缺失（vendor 没加载）→ 对应分支直接 return，保留 `SimpleMarkdown` 原本输出的可读 `<pre><code>`。单块 Mermaid 渲染抛错 → 给 `<pre>` 加 `.is-mermaid-fallback` 类（CSS 用 `::before` 显示「Mermaid 渲染失败，显示源码」），不替换内容。单块高亮抛错 → catch 吞掉保留原样。**不要把增强写成「库不在就崩页」** —— 读者应永远能看到代码/图表源码。

**安全：** Mermaid 用 `securityLevel: "strict"`（禁用 HTML 注入与 click 回调里的代码执行）；`mermaid.render(id, code, cb)` 的 `code` 来自 `textContent`，不是 `innerHTML`。`hljs.highlightElement` 读 `textContent` 生成转义 token。二者都不引入新的未转义 HTML，与 `SimpleMarkdown` 的转义契约一致。`cb` 的第二参 `bindFunctions` 是 Mermaid 交互节点绑定，在 strict 模式下安全，回调里 `bindFunctions(wrap)` 调用即可。

**Mermaid 9.4.3 标签转义规则（写文章时易踩）：** 9.4.3 的词法器对节点/边标签里的部分字符会**同步抛 Lexical error**，导致该块降级为源码。含 `#` `:` `=` `<` `>` `;` `（` `）`、全角 `：`、箭头 `→`、斜杠 `/` 等的标签，**必须用双引号包裹**：`X["#if foo"]`、`X["sys_cb.mic_alg_en = 1"]`、`X["Mix PACC：PCM0 + PCM1 → 节点链"]`。纯字母数字/中文/空格的标签可不加引号。这些块在 Typora（Mermaid 10+）里能显示，不等于在本站能显示——9.4.3 的词法器更严。作者粘图块回退时，多半是哪个标签漏了引号。

**主题切换（`blog:themechange`）：** `theme.js` 在 `applyTheme(next)` 之后 `document.dispatchEvent(new CustomEvent("blog:themechange"))`。`diagram-highlight.js` 的 `onThemeChange()` 收到后：(1) `applyHljsTheme()` 按当前 `data-theme` 启用对应 `link[data-hljs-theme]`、禁用另一张（零网络往返）；(2) 若 Mermaid 主题名变了（dark↔default），`mermaid.initialize` 重设主题，遍历 `registry` 里仍挂载的条目用回调式 `mermaid.render(id, code, cb)` 重渲染，在 `cb` 里把新 SVG 写回 `r.wrap.innerHTML`。`registry` 在重渲染前先过滤掉 `pre` 已脱离 DOM 的失效条目。切主题的重渲染同样用 `try/catch` 包 `mermaid.render`，同步抛错则保留旧 SVG。改主题切换逻辑时记住写回前再判一次 `r.wrap.parentNode`。

**异步竞态（generation token）：** `enhance(container, gen)` 把 `container._blogGen = gen` 记在容器上；`stale(container, gen, pre)` 在每个回调写 DOM 前比对 `container._blogGen === gen` 且 `pre` 仍在容器内，不等则作废。**编辑器实时预览必须传 `++previewGen`**：`renderPreview()` 120ms debounce 后整体替换 `preview.innerHTML` 再 `enhance(preview, ++previewGen)`，上一轮还在跑的回调比对到 gen 不等就 return，避免旧 SVG 落到新 DOM。post/about 页不传 gen（gen=0 时 `stale` 跳过代际检查，只看 `pre` 是否仍在 DOM），因为它们一次性渲染、不会整体替换容器。改预览逻辑时不要丢掉这个代际号，否则快速输入时会出现图表错位/闪烁。

> 9.4.3 的 `cb` 本身是同步触发的，竞态风险不如 Mermaid 10+ 的 Promise 回调高；但 `renderPreview` 的整体替换 + 下一轮 `enhance` 之间仍有微小窗口，代际号是廉价保险，保留不删。

**vendor 自托管（固定版本，无 CDN 运行时依赖）：** `vendor/mermaid/`（Mermaid 9.4.3，`mermaid.min.js` + `.map` + LICENSE + package.json）、`vendor/highlight/`（highlight.js 11.9.0 预构建浏览器包 `highlight.min.js`，暴露 `window.hljs`，含约 37 种常用语言；`styles/github-dark.min.css` + `styles/github.min.css` 两张主题；LICENSE + package.json）。升级版本时同步改 `vendor/*/package.json`、重新下载 min 文件、保留 LICENSE，并在 README/CLAUDE.md 标注新版本。**不要改用 CDN** —— 站点定位是零外部运行时依赖的纯静态站。

`index.html` 故意不加载 vendor 与 `diagram-highlight.js`：首页只渲染列表卡片，没有正文容器需要增强；加载它们只会增重。

### 主题（无闪烁）

每个 HTML 页面 `<head>` 里有一段内联脚本，读取 `localStorage.theme`（回退到 `prefers-color-scheme`），在首次绘制前给 `<html>` 设 `data-theme`。`theme.js` 只负责绑定切换按钮和持久化用户选择。所有颜色都是 `css/style.css` 里以 `[data-theme="dark"]` / `[data-theme="light"]` 作用域的 CSS 自定义属性。`prefers-reduced-motion` 受到尊重（关闭平滑滚动和过渡）。

## 设计约束（锁定，不要漂移）

这些来自构建本站时遵循的 `taste-skill` 设计指令（在 `.claude/skills/` 下，已 git 忽略）。它们是站点身份的一部分，不是随意的偏好：

- **单一强调色，全站锁定。** 深色 `#6cb6ff`，浅色 `#0b6bcb` —— 一个冷青蓝，刻意选来对抗 AI 紫的默认套路。不要引入第二个强调色（不要青色徽章、不要绿色状态点）。要改色就改 `css/style.css` 里的 `--accent`，全站联动。
- **形状一致性锁定：** 一套圆角尺度（`--radius` / `--radius-sm`）。不要把胶囊按钮和直角卡片混用。
- **阅读优先的编辑风** —— 技术感来自排版和克制，不是特效。正文中禁止使用 em-dash（破折号），尽量少用甚至不用。动效保持最小。
- 字体：UI 和正文用 sans 栈（`--font-sans`），代码用 mono（`--font-mono`）。serif（`--font-serif`）可用但默认不用 —— 不要主动伸手。

## 路径与部署

HTML 里所有资源路径都相对于站点根（`css/...`、`js/...`、`posts/...`、`assets/...`）。注意：`posts/about.md` 里有 `../` 前缀的链接（如 `[css/style.css](../css/style.css)`），是相对于根目录下的 `about.html` 解析的 —— 在根目录部署时正确。若部署在 GitHub Pages 的子路径下，这些链接和 `?p=` 链接可能需要调整（目前没有用 `<base>` 标签）。

GitHub Pages：Settings → Pages → Source = `Deploy from a branch`，分支 `main`，目录 `/`（根）。不需要 `.nojekyll`（没有下划线开头的文件）。EdgeOne Pages：构建命令留空，输出目录 `.`。

## Git / 远程

- 远程：`git@github.com:zglstudylinux/personal-blog.git`（分支 `main`，跟踪 `origin/main`）。
- `.gitignore` 忽略 `.claude/`（本地技能/工具文件）和 `taste-skill/`（当初 clone 的技能仓库，自带 `.git` —— 一个嵌套仓库，绝不能提交）。`node_modules/`、IDE 文件、系统缩略图同样忽略。`vendor/` **不忽略** —— Mermaid / highlight.js 的 min 文件、map、LICENSE、package.json 都要提交，这是「自托管、无 CDN 运行时依赖」的代价，也是站点离线可用的前提。
- 本仓库是在一个已有远程上初始化的，远端当时已有一个 `Initial commit`（MIT LICENSE，作者 `zgl_Embedded`）。本地历史是线性的：`0e33d67 Initial commit → <博客提交>`。那份 LICENSE 保留了 —— 不要覆盖或删除。
- 行尾：仓库里是 LF，Windows checkout 时 git 会警告 LF→CRLF（无害，是 `core.autocrlf` 默认行为）。

## 改动清单

- 改站点名 / 副标题 / 作者 / 默认主题 / `apiBase` → `js/config.js`。`apiBase` 留空 = 编辑器只显示「尚未配置发布服务」提示，不进入编辑界面；填 Worker 地址 = 作者 GitHub 登录后编辑与发布。
- 增删或重排文章 → `js/posts.js`（外加 `posts/` 里的 `.md` 文件）。每条带 `category`（主专栏）和 `tags`（数组）。
- 关于页内容 → `posts/about.md`。
- 颜色、间距、字体、组件 → `css/style.css` 顶部的 CSS 变量；单一强调色，锁定。
- 改了任何 JS 或 markdown 之后：用 HTTP 起服务，依次点开 首页 → 一篇文章 → 关于 → 编辑器 才算完成 —— `file://` 会掩盖回归。验证文章页 / 关于页 / 编辑器预览时，至少各点一个 ` ```mermaid ` 块和一个 ` ```js `（或 ` ```c `）块，确认 Mermaid 出 SVG、代码块上色；再切一次主题，确认 Mermaid 按新主题重渲染、highlight.js 主题 CSS 切换。

## 编辑器与在线发布后端（`api/`）

网页写作由两个独立部分组成：

1. **前端编辑器**（`editor.html` + `js/editor.js` + `css/style.css` 里的「12. 编辑器」一节）：
   - **认证门禁**：默认只显示 `#authGate`（GitHub 登录按钮 + 「仅作者本人可编辑和发布」提示），`#editorWorkspace`（全部编辑内容）默认 `hidden`。`apiBase` 为空时只显示「尚未配置发布服务」提示，不进入编辑界面。`init()` → `refreshAuth()` 调 `/api/auth/me`，登录成功才 `setWorkspaceVisible(true)` 并 `initWorkspace()`；未登录/网络失败/会话过期都按未授权处理。前端隐藏只是体验，不是安全边界。
   - **新建 vs 编辑已发布**：`editingSlug` 状态决定 `mode`。`editor.html?edit=<slug>` 或「已发布」下拉 + 「载入编辑」按钮 → `loadPublishedForEdit()` 从 `window.POSTS` 取元数据、fetch `posts/<slug>.md` 拉正文，置 `editingSlug=<slug>` 并锁定 `#fSlug`（disabled，改名 = 新建 + 留下孤儿）。发布时 `editingSlug` 非空 → `mode: "update"`，slug 用原值；为空 → `mode: "create"`。发布成功后切到 update 模式并锁定 slug，刷新「已发布」下拉，删除该 slug 的本地草稿。
   - 实时预览复用 `window.SimpleMarkdown.render()`（120ms debounce）—— 不要再写第二套解析器。
   - 多草稿存 localStorage，键 `blog:draft:<slug>`，含 `updatedAt` 与 `editingSlug`（区分这份草稿是新建还是编辑某篇已发布文章）。
   - slug 由 `slugify()` 用 `\p{L}\p{N}` 生成，只允许小写字母数字连字符。
   - 粘贴截图：`apiBase` 为空 → `blob:` 本机预览；非空 → 客户端读成 data URL，单次 POST `/api/images/upload`，Worker 校验类型/大小/魔数后用 GitHub Contents API 提交到 `assets/images/<yyyy>/<mm>/<uuid>.<ext>`，返回站点根相对路径插入 Markdown。不走对象存储 / R2。
   - **正文里存的是仓库相对路径 `assets/images/...`**（发布到线上后正确），但本地工作副本里没有 Worker 刚提交的图，static server 会 404。`renderPreview()` 用 `rebaseImgSrc()` 把预览 DOM 里的 `<img src="assets/images/...">` 临时改写成 `cfg.gitRawBase`（`raw.githubusercontent.com/.../main` 直链，非密钥）显示——**只改预览 DOM 的 src，不改正文 textarea**，发布内容不受影响。`uploadImage()` 还会在上传前先用 `blob:` URL 在 `#pastePreview` 即时显示图，不等网络往返。改预览逻辑时记住这条「正文路径 ≠ 预览 src」的拆分，不要把 raw 直链写进正文。
   - 发布 POST `/api/posts/publish`，发 `mode: "create" | "update"`；处理 401（`relock()` 重新锁定工作区）/409（slug 冲突或 SHA 冲突，区分提示）/`partial`（正文已写、注册表未写，不伪称成功）；成功提示「已直接发布到 main，GitHub Pages 自动部署，注意缓存延迟」，不再提 PR。
   - **载入已发布文章编辑时，`loadPublishedForEdit()` 给 `posts/<slug>.md` 的 fetch 拼 `?v=<Date.now()>` cache-busting**。重新发布后浏览器/GitHub Pages 会缓存旧 `.md`，不带版本号会一直返回发布前的旧正文，让人误以为更新没生效。这只破坏缓存，不影响解析。
   - **删除已发布文章**：`#btnDeletePublished` 仅在 `editingSlug` 非空（已载入某篇已发布文章）时可用（`updateDeleteBtn()` 统一管）。点「删除」→ `window.confirm` 二次确认 → POST `/api/posts/delete` `{slug}`，处理 401/409/`partial`；成功后删该 slug 的本地草稿、`refreshPublishedSelect()`、`newDraft()` 重置。删除按钮用 `.editor-btn--danger`（红色语义色，与 `.editor-status.is-err` 一致，**不是第二个装饰强调色**）。

2. **后端 Worker**（`api/src/`，与静态站点**不同域名**，独立部署）：
   - 路由与安全铁律见 `api/README.md` 和 `api/src/worker.js` 顶部注释。
   - OAuth 回调跳回编辑器时必须补 `SITE_PATH`（`wrangler.toml` 里的 `SITE_PATH = "/personal-blog"`）。静态站部署在 GitHub Pages 子路径 `/personal-blog/` 下，`SITE_ORIGIN` 只放 origin 用于 CORS 比对（不能带路径），而 OAuth 回调 302 的 `Location` 必须是 `SITE_ORIGIN + SITE_PATH + "/editor.html"`，否则会跳到 `https://zglstudylinux.github.io/editor.html`（无此文件 → GitHub 返回 **404 "There isn't a GitHub Pages site here"**）。本地 dev 无子路径，`SITE_PATH` 留空即可。
   - 会话：自签 HS256 JWT（`api/src/lib/jwt.js`）放 `HttpOnly + Secure + SameSite` cookie。**生产**（静态站在 `github.io`、Worker 在 `workers.dev`，跨站 fetch）cookie 用 `SameSite=None; Secure`，否则跨站 `fetch(credentials:"include")` 不会带 cookie，`/api/auth/me` 永远返回 `login:null`，登录门禁永远不通过。**本地** wrangler dev（`localhost`，同站、http）用 `SameSite=Lax`（http 下 `SameSite=None` 无 `Secure` 会被浏览器拒绝）。`setSessionCookie` / `clearSessionCookie` / `handleLogin` 的 `blog_oauth_state` 都按 `isSecure(request)` 选 `None` 或 `Lax`——三处必须一致，否则 state cookie 或 session cookie 在某一步被浏览器丢掉，回调报 `invalid oauth state` 或登录后跳回仍显示未登录。
   - 作者白名单：`ALLOWED_GH_IDS`（GitHub 数字 user id）。
   - 服务端校验：`api/src/lib/validate.js` —— slug/日期/标题/专栏/标签/Markdown 全部重校验，并 `sanitizeMarkdown` 拒绝原始 HTML 块与危险协议（与前端 `safeUrl()` 白名单一致）。
   - 发布：`api/src/lib/publish.js` 的 `publishPost(env, post, mode, user)` **直接写 `main` 分支**（`DEFAULT_BRANCH = "main"`，不再创建发布分支/PR）。
     - `mode: "create"`：`getSha` 确认 Markdown **不存在**（存在 → 409），PUT 提交正文，再 `appendToRegistry` 在 `window.POSTS = [` 与 `];` 之间追加条目。
     - `mode: "update"`：`getSha` 确认 Markdown **存在**，PUT 带该 SHA 更新正文，再 `updateRegistryEntry` 用 `findEntryRange()`（花括号深度解析，处理字符串里的花括号与转义）定位同 slug 的顶层 `{...}` 块并替换，其它条目不变。注册表 PUT 带其 SHA。
     - 两次 GitHub Contents API 调用非原子，按「先正文后注册表」顺序；第二步失败 → `partial: true`，不伪称成功，不暴露 token/堆栈。SHA 冲突 → `conflict: true` + 409 提示重新载入。`buildPostEntry` 缩进 2 空格，`appendToRegistry` 只去尾空白不 trim（保留首条缩进，避免塌陷）。**不要把 `inline(s, codes)` 的递归 `codes` 教训照搬误改这里的字符串注入逻辑**——它不是同一个不变量。
   - 删除：`api/src/lib/publish.js` 的 `deletePost(env, slug, user)` 走「先注册表、后正文、最后图片」顺序。`removeRegistryEntry(src, slug)` 复用 `findEntryRange()` 定位顶层 `{...}` 块，并连带吃掉块后或块前的逗号（保证剩余条目间逗号恰好一份），再折叠多余空行。`extractImagePaths(md)` 只认 `assets/images/...` 相对路径并去重。`api/src/lib/github.js` 的 `deleteFile(env, path, sha, message)` 用 GitHub Contents DELETE API（必须带 SHA；404 视为已删，幂等，方便清理孤儿时重试）。删除非原子：注册表删失败 → 整体失败无副作用；注册表删成功但正文删失败 → `partial`；正文删成功但部分图片删失败 → 仍算成功，返回 `imagesFailed` 列表让作者手动清理。删除用 `IMAGES_BRANCH`（= `main`）。

**安全铁律（不可违反）：** GitHub PAT / OAuth Secret / SESSION_SECRET 只能来自 `wrangler secret put`，绝不写进 `wrangler.toml`、`js/`、HTML、localStorage 或日志。前端只持 HttpOnly cookie，永远拿不到 PAT。客户端校验仅为体验，服务端必须再校验一遍。`mode` 由前端给但服务端以远程文件是否存在为最终判据（不能由前端绕过冲突规则）。改 Worker 代码后用 `npx wrangler dev` 本地验证，不要把 Secret 硬编码。
