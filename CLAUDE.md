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

### 三个页面，各自脚本组合不同

- `index.html` —— 文章列表。脚本顺序：config → posts → markdown → theme → main → **list**
- `post.html` —— 文章详情。脚本顺序：config → posts → markdown → theme → main → **post**
- `about.html` —— 关于页。脚本顺序：config → markdown → theme → main → **about**（刻意省略 `posts.js` —— 关于页不需要注册表）
- `editor.html` —— 网页写作。脚本顺序：config → markdown → theme → main → **editor**（省略 `posts.js` —— 编辑器不读注册表）

脚本加载顺序是真实的依赖链，不是装饰：`config.js` 设置 `window.SITE_CONFIG`，`posts.js` 设置 `window.POSTS`，`markdown.js` 设置 `window.SimpleMarkdown`；页面专属脚本（list/post/about/editor）消费它需要的那些。调换顺序或删掉某个 `<script>` 标签会让页面失效。

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

`window.SimpleMarkdown.render(md)` —— 一个零依赖解析器，覆盖标题、段落、加粗/斜体/删除线、行内代码、围栏代码块、引用、有序/无序列表、表格、分隔线、链接、图片。输入做 HTML 转义（防 XSS），图片/链接走 `safeUrl()` 协议白名单（拒绝 `javascript:` / `vbscript:` / `file:`，`data:` 仅限安全图片类型），危险 URL 退化为纯文本/转义文本而非真实链接或 `<img>`。

**关键不变量：** `inline(s, codes)` 辅助函数先把行内代码提取成占位表（`" «index» "`），处理其它格式后再还原。`codes` 数组通过参数在递归调用间传递（链接文本里可能再嵌套行内代码，比如 `` `[`js/posts.js`](../js/posts.js) ``）。`inline()` 内部对 `inline()` 的每次递归调用都必须传同一份 `codes` —— 如果某次递归自己 new 了一份 `codes`，外层占位就再也还原不了，`render()` 会抛 `Cannot read properties of undefined (reading 'replace')`。这是一次真实出现过的 bug，把关于页搞挂过。不要把 `inline()` "简化"回使用局部 `codes`。

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
- `.gitignore` 忽略 `.claude/`（本地技能/工具文件）和 `taste-skill/`（当初 clone 的技能仓库，自带 `.git` —— 一个嵌套仓库，绝不能提交）。`node_modules/`、IDE 文件、系统缩略图同样忽略。
- 本仓库是在一个已有远程上初始化的，远端当时已有一个 `Initial commit`（MIT LICENSE，作者 `zgl_Embedded`）。本地历史是线性的：`0e33d67 Initial commit → <博客提交>`。那份 LICENSE 保留了 —— 不要覆盖或删除。
- 行尾：仓库里是 LF，Windows checkout 时 git 会警告 LF→CRLF（无害，是 `core.autocrlf` 默认行为）。

## 改动清单

- 改站点名 / 副标题 / 作者 / 默认主题 / `apiBase` → `js/config.js`。`apiBase` 留空 = 本地编辑模式；填 Worker 地址 = 在线登录与发布。
- 增删或重排文章 → `js/posts.js`（外加 `posts/` 里的 `.md` 文件）。每条带 `category`（主专栏）和 `tags`（数组）。
- 关于页内容 → `posts/about.md`。
- 颜色、间距、字体、组件 → `css/style.css` 顶部的 CSS 变量；单一强调色，锁定。
- 改了任何 JS 或 markdown 之后：用 HTTP 起服务，依次点开 首页 → 一篇文章 → 关于 → 编辑器 才算完成 —— `file://` 会掩盖回归。

## 编辑器与在线发布后端（`api/`）

网页写作由两个独立部分组成：

1. **前端编辑器**（`editor.html` + `js/editor.js` + `css/style.css` 里的「12. 编辑器」一节）：
   - 实时预览复用 `window.SimpleMarkdown.render()`（120ms debounce）—— 不要再写第二套解析器。
   - 多草稿存 localStorage，键 `blog:draft:<slug>`，含 `updatedAt`。
   - slug 由 `slugify()` 用 `\p{L}\p{N}` 生成，只允许小写字母数字连字符。
   - 粘贴截图：`apiBase` 为空 → `blob:` 本机预览；非空 → 客户端读成 data URL，单次 POST `/api/images/upload`，Worker 校验类型/大小/魔数后用 GitHub Contents API 提交到 `assets/images/<yyyy>/<mm>/<uuid>.<ext>`，返回站点根相对路径插入 Markdown。不走对象存储 / R2。
   - **正文里存的是仓库相对路径 `assets/images/...`**（发布到线上后正确），但本地工作副本里没有 Worker 刚提交的图，static server 会 404。`renderPreview()` 用 `rebaseImgSrc()` 把预览 DOM 里的 `<img src="assets/images/...">` 临时改写成 `cfg.gitRawBase`（`raw.githubusercontent.com/.../main` 直链，非密钥）显示——**只改预览 DOM 的 src，不改正文 textarea**，发布内容不受影响。`uploadImage()` 还会在上传前先用 `blob:` URL 在 `#pastePreview` 即时显示图，不等网络往返。改预览逻辑时记住这条「正文路径 ≠ 预览 src」的拆分，不要把 raw 直链写进正文。
   - 发布 POST `/api/posts/publish`，处理 401/409，返回 PR URL 与 Pages 部署延迟提示。已本地联调验证：发布成功会创建 PR（同时含 `posts/<slug>.md` 与 `js/posts.js` 两处变更），合并 PR 后 GitHub Pages 自动部署、线上可见。

2. **后端 Worker**（`api/src/`，与静态站点**不同域名**，独立部署）：
   - 路由与安全铁律见 `api/README.md` 和 `api/src/worker.js` 顶部注释。
   - 会话：自签 HS256 JWT（`api/src/lib/jwt.js`）放 `HttpOnly + Secure + SameSite=Lax` cookie。
   - 作者白名单：`ALLOWED_GH_IDS`（GitHub 数字 user id）。
   - 服务端校验：`api/src/lib/validate.js` —— slug/日期/标题/专栏/标签/Markdown 全部重校验，并 `sanitizeMarkdown` 拒绝原始 HTML 块与危险协议（与前端 `safeUrl()` 白名单一致）。
   - 发布：`api/src/lib/publish.js` 在 `publish/<slug>-<ts>` 分支同时提交 `posts/<slug>.md` 和 `js/posts.js`（在 `window.POSTS = [` 与 `];` 之间追加条目），再创建 PR。slug 冲突返回 409。**不直接写 main**。

**安全铁律（不可违反）：** GitHub PAT / OAuth Secret / SESSION_SECRET 只能来自 `wrangler secret put`，绝不写进 `wrangler.toml`、`js/`、HTML、localStorage 或日志。前端只持 HttpOnly cookie，永远拿不到 PAT。客户端校验仅为体验，服务端必须再校验一遍。改 Worker 代码后用 `npx wrangler dev` 本地验证，不要把 Secret 硬编码。
