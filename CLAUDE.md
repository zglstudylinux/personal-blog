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

脚本加载顺序是真实的依赖链，不是装饰：`config.js` 设置 `window.SITE_CONFIG`，`posts.js` 设置 `window.POSTS`，`markdown.js` 设置 `window.SimpleMarkdown`；页面专属脚本（list/post/about）消费它需要的那些。调换顺序或删掉某个 `<script>` 标签会让页面失效。

### 内容管理：靠注册表，不靠 frontmatter

**没有 frontmatter，也不会自动扫描文件**。`js/posts.js` 是唯一的内容来源 —— 一个手工维护的 `window.POSTS` 数组。新增文章：把 `.md` 放进 `posts/`，然后往 `POSTS` 里加一条，字段包括 `slug`（和文件名一致）、`title`、`date`（YYYY-MM-DD）、`excerpt`、`tags`，以及可选的 `file`（默认 `posts/<slug>.md`）。没有登记的 `.md` 文件对站点不可见。

唯一例外是 `posts/about.md` —— 它由 `about.js` 直接按固定路径 `"posts/about.md"` 拉取，不走 `POSTS` 注册表。

### 路由

- 文章：`post.html?p=<slug>` —— `post.js` 读 `URLSearchParams`，在 `POSTS` 里按 `slug` 查条目，拉取对应 markdown，渲染进 `#postBody`。未知 slug → 内联错误提示。上一篇/下一篇导航按注册表索引计算。
- 关于：静态的 `about.html`，直接拉取固定路径 `posts/about.md`。

### Markdown 渲染（`js/markdown.js`）

`window.SimpleMarkdown.render(md)` —— 一个零依赖解析器，覆盖标题、段落、加粗/斜体/删除线、行内代码、围栏代码块、引用、有序/无序列表、表格、分隔线、链接、图片。输入做 HTML 转义（防 XSS）。

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

- 改站点名 / 副标题 / 作者 / 默认主题 → `js/config.js`。
- 增删或重排文章 → `js/posts.js`（外加 `posts/` 里的 `.md` 文件）。
- 关于页内容 → `posts/about.md`。
- 颜色、间距、字体、组件 → `css/style.css` 顶部的 CSS 变量；单一强调色，锁定。
- 改了任何 JS 或 markdown 之后：用 HTTP 起服务，依次点开三个页面（列表、一篇文章、关于）才算完成 —— `file://` 会掩盖回归。
