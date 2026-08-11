# 嵌入式笔记 - 个人博客

一个面向嵌入式开发者的纯静态个人博客：文章列表、文章详情、关于页。
纯 HTML + CSS + JavaScript，零依赖、零构建步骤，内容用 Markdown 管理，可部署到 GitHub Pages 或 EdgeOne Pages。

**线上地址**：<https://zglstudylinux.github.io/personal-blog/>（GitHub Pages，`main` 分支根目录自动部署）

## 特性

- **纯静态**：HTML + CSS + 原生 JS，没有框架、没有构建步骤，复制文件即用。
- **Markdown 内容管理**：文章放在 `posts/` 目录，在 `js/posts.js` 登记后自动出现在列表。
- **网页写作**：内置 Markdown 编辑器（`editor.html`），实时预览、草稿、粘贴截图、专栏与标签、在线发布。
- **专栏**：每篇文章一个主专栏（`category`）+ 多个标签（`tags`），首页可按专栏筛选，文章页有同专栏前后篇导航。
- **深浅色主题**：跟随系统偏好，可手动切换，选择保存在 localStorage。
- **响应式**：桌面 / 平板 / 手机自适应，遵守 `prefers-reduced-motion`。
- **可部署**：GitHub Pages 或 EdgeOne Pages，纯静态无需后端。

## 目录结构

```
blog/
├── index.html              # 文章列表（首页）
├── post.html               # 文章详情页
├── about.html              # 关于页
├── editor.html             # ★ 网页 Markdown 编辑器（写作/预览/草稿/粘贴/发布）
├── css/
│   └── style.css           # 全部样式（含深浅色主题、代码高亮、编辑器、专栏、响应式）
├── js/
│   ├── config.js           # 站点配置（名称、作者、默认主题、apiBase、图片限制）
│   ├── posts.js            # ★ 文章清单（新增文章在这里登记）
│   ├── markdown.js         # 零依赖 Markdown 解析器（带 URL 协议白名单）
│   ├── theme.js            # 深浅色切换
│   ├── main.js             # 页脚年份、导航高亮
│   ├── list.js             # 首页列表渲染 + 搜索 + 标签筛选 + 专栏筛选
│   ├── post.js             # 详情页：加载并渲染 Markdown、专栏导航
│   ├── about.js            # 关于页：加载 about.md
│   └── editor.js           # 编辑器：预览/草稿/粘贴/导出/登录/发布
├── posts/
│   ├── rtos-priority-inversion.md
│   ├── adc-sampling-stm32.md
│   ├── uart-ring-buffer.md
│   └── about.md            # 关于页内容
├── api/                    # ★ 在线发布后端（Cloudflare Worker），独立部署
│   ├── wrangler.toml
│   ├── package.json
│   ├── README.md           # 后端部署与 Secret 设置说明
│   └── src/                # worker.js + lib/{http,jwt,validate,github,publish,images}.js
└── assets/
    └── favicon.svg
```

## 本地预览

因为文章是用 `fetch()` 加载的，必须通过 HTTP 服务器打开，**不能直接双击 html 文件**。

任选一种：

```powershell
# Python（装了 Python 的话）
python -m http.server 8000

# Node（装了 Node 的话）
npx serve
```

然后浏览器访问 `http://localhost:8000`。

## 新增一篇文章

1. 在 `posts/` 目录放一个 `.md` 文件，例如 `my-new-post.md`。
2. 打开 [`js/posts.js`](js/posts.js)，在 `POSTS` 数组里加一条：

```js
{
  slug: "my-new-post",                 // 和文件名一致
  title: "我的新文章",
  date: "2026-08-10",
  excerpt: "一句话摘要，显示在列表页。",
  category: "STM32 外设",               // 主专栏（一篇文章只属于一个专栏，可留空）
  tags: ["STM32", "调试"],              // 标签数组，用于筛选
  file: "posts/my-new-post.md"         // 可省略，默认就是 posts/<slug>.md
}
```

3. 刷新首页即可看到。

> 也可以直接用网页编辑器写作并在 GitHub 登录后发布，编辑器会自动生成上面的 Markdown 文件和注册表条目（见下文「在线写作与发布」）。

## 编辑「关于」页

直接改 [`posts/about.md`](posts/about.md)。

## 修改站点信息

改 [`js/config.js`](js/config.js)：站点名、副标题、作者、默认主题。`apiBase` 留空时编辑器只提供本地草稿和导出；填上 Worker 地址后启用在线登录与发布。

## 修改样式

改 [`css/style.css`](css/style.css) 顶部的 `:root` 和 `[data-theme="..."]` 里的 CSS 变量：
颜色在 `--accent`（强调色）、`--bg`（背景）等，改一处全站联动。

## 在线写作与发布

除了手工写 `.md` + 改 `posts.js`，也可以用网页编辑器完成整个流程。

### 本地模式（开箱即用，无需后端）

打开 `editor.html`：

- 实时预览（复用文章详情页的 Markdown 解析器）。
- 标题 / slug / 日期 / 专栏 / 标签 / 摘要 元数据编辑。
- 草稿保存在浏览器 localStorage，刷新可恢复，支持多草稿。
- 粘贴截图（Ctrl/⌘+V）插入图片。本地模式下图片是 `blob:` 预览，只在本机可见。
- 导出 `.md` 文件，手工放进 `posts/` 并登记到 `posts.js`。

### 在线发布（需部署 `api/` 后端）

要实现「网页里直接写 + 粘贴截图永久保存 + 一键发布」，需要部署 `api/` 里的 Cloudflare Worker：

1. 按 [`api/README.md`](api/README.md) 创建 Worker、OAuth App，并设置 Secret。
2. 把 Worker 地址填进 [`js/config.js`](js/config.js) 的 `apiBase`。
3. 在编辑器里用 GitHub 登录（只允许白名单内的 GitHub user id 发布）。
4. 粘贴的截图会提交到仓库的 `assets/images/`，Markdown 里保存的是站点根相对路径，随 GitHub Pages 一起部署。
5. 点「发布」后，Worker 会在 `publish/<slug>-<时间戳>` 分支同时提交 Markdown 正文和 `js/posts.js` 注册表，并创建 Pull Request。合并 PR 后 GitHub Pages 自动部署。

> 预览与正文路径的拆分：编辑器正文里存的是仓库相对路径 `assets/images/...`（发布到线上后正确），但本地工作副本里没有 Worker 刚提交的图，static server 会 404。编辑器预览会把 `<img src="assets/images/...">` 临时改写成 `raw.githubusercontent.com/.../main` 直链显示，只影响预览 DOM、不改正文，发布内容仍是正确的仓库相对路径。

安全要点：

- **GitHub Token / OAuth Secret 只存在 Worker Secret 里**，不写进 `wrangler.toml`、`js/`、HTML 或 localStorage。
- 前端只持 HttpOnly 会话 cookie，永远拿不到 PAT。
- 服务端重新校验 slug / 日期 / 标题 / 专栏 / 标签 / Markdown，不信任浏览器校验结果。
- 拒绝 `javascript:` / `vbscript:` / 危险 `data:` 协议，禁止原始 HTML 注入。
- 发布前检测 slug 冲突，分支名由服务端生成，不接受客户端传的任意路径。

## 部署到 GitHub Pages

1. 在 GitHub 建一个仓库，把整个 `blog/` 目录推上去。
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支选 `main`，目录选 `/`（根）或你放站点的子目录。
3. 保存后等一两分钟，GitHub 会给你一个 `https://<用户名>.github.io/<仓库名>/` 的网址。

> 本仓库已部署到 GitHub Pages，地址见顶部。配置：Source = `Deploy from a branch`，分支 `main`，目录 `/`（根）。每次推送到 `main` 会自动触发重新部署。

> 如果你的站点在仓库的子目录（比如仓库根有别的文件，博客在 `blog/`），GitHub Pages 的 Source 要选那个子目录，或者在仓库根放一个 `.nojekyll` 文件避免下划线开头的文件被忽略（本站没用到这类文件，影响不大）。

## 部署到 EdgeOne Pages

1. 登录腾讯云 EdgeOne 控制台，进入 Pages。
2. 新建项目，选择「从 Git 导入」绑定 GitHub/GitLab 仓库，或直接上传站点压缩包。
3. 构建命令留空（纯静态无需构建），输出目录填 `.`（或你放站点的目录）。
4. 部署完成后会拿到一个 `*.edgeone.app` 的域名，可绑定自定义域名。

## Markdown 支持的语法

标题、段落、加粗 `**`、斜体 `*`、删除线 `~~`、行内代码 `` ` ``、代码块 ` ``` `、
引用 `>`、有序/无序列表、链接 `[text](url)`、图片 `![alt](src)`、分隔线 `---`、表格。

## License

MIT
