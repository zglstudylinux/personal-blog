# 嵌入式笔记 - 个人博客

一个面向嵌入式开发者的纯静态个人博客：文章列表、文章详情、关于页。
纯 HTML + CSS + JavaScript，零依赖、零构建步骤，内容用 Markdown 管理，可部署到 GitHub Pages 或 EdgeOne Pages。

**线上地址**：<https://zglstudylinux.github.io/personal-blog/>（GitHub Pages，`main` 分支根目录自动部署）

## 特性

- **纯静态**：HTML + CSS + 原生 JS，没有框架、没有构建步骤，复制文件即用。
- **Markdown 内容管理**：文章放在 `posts/` 目录，在 `js/posts.js` 登记后自动出现在列表。
- **网页写作**：内置 Markdown 编辑器（`editor.html`），作者登录后实时预览、草稿、粘贴截图、专栏与标签、新建/编辑已发布文章、直接发布到 `main`。访客只看到登录入口，不能编辑。
- **专栏**：每篇文章一个主专栏（`category`）+ 多个标签（`tags`），首页可按专栏筛选，文章页有同专栏前后篇导航。
- **深浅色主题**：跟随系统偏好，可手动切换，选择保存在 localStorage。
- **Mermaid 图表 + 代码高亮**：` ```mermaid ` 围栏块在前端渲染成 SVG 图表，` ```js ` / ` ```c ` 等代码块自动语法高亮。库自托管（`vendor/`，固定版本，无 CDN 运行时依赖），库加载或单块渲染失败时优雅降级为原始可读代码。
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
│   ├── editor.js           # 编辑器：认证门禁/预览/草稿/粘贴/导出/登录/发布（create+update）
│   └── diagram-highlight.js # 渲染后增强：Mermaid 图表 + highlight.js 代码高亮
├── vendor/                 # ★ 自托管的第三方库（固定版本，无 CDN 运行时依赖）
│   ├── mermaid/            # Mermaid 9.4.3（mermaid.min.js + LICENSE + package.json）
│   └── highlight/          # highlight.js 11.9.0（highlight.min.js + 主题 CSS + LICENSE + package.json）
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

改 [`js/config.js`](js/config.js)：站点名、副标题、作者、默认主题。`apiBase` 留空时编辑器显示「尚未配置发布服务」提示，不进入编辑界面；填上 Worker 地址后启用作者 GitHub 登录、编辑与发布。

## 修改样式

改 [`css/style.css`](css/style.css) 顶部的 `:root` 和 `[data-theme="..."]` 里的 CSS 变量：
颜色在 `--accent`（强调色）、`--bg`（背景）等，改一处全站联动。

## 在线写作与发布

除了手工写 `.md` + 改 `posts.js`，也可以用网页编辑器完成整个流程。编辑器是**作者专用**的：默认只显示 GitHub 登录入口和「仅作者本人可编辑和发布」提示，登录成功后才显示编辑工作区。访客打开博客首页 / 文章页 / 关于页始终只有阅读体验，看不到编辑入口。

### 尚未配置后端（`apiBase` 为空）

打开 `editor.html` 只会看到「尚未配置发布服务」提示，不进入编辑界面。部署下面的 `api/` 后端并填好 `apiBase` 后，才能登录与发布。

### 在线发布（需部署 `api/` 后端）

要实现「网页里直接写 + 粘贴截图永久保存 + 一键发布」，需要部署 `api/` 里的 Cloudflare Worker：

1. 按 [`api/README.md`](api/README.md) 创建 Worker、OAuth App，并设置 Secret。
2. 把 Worker 地址填进 [`js/config.js`](js/config.js) 的 `apiBase`。
3. 在编辑器登录页用 GitHub 登录（只允许白名单内的 GitHub user id 登录，非白名单会被服务端拒绝）。
4. 粘贴的截图会提交到仓库的 `assets/images/`，Markdown 里保存的是站点根相对路径，随 GitHub Pages 一起部署。
5. 点「发布」后，Worker 在 `main` 分支同时提交 Markdown 正文和 `js/posts.js` 注册表条目，**直接写入 `main`，不再创建 PR**。GitHub Pages 自动部署，注意有缓存延迟。
6. 已发布文章可在编辑器的「已发布」下拉里选择并「载入编辑」，修改后再点发布即更新线上（`mode: update`）。也可以用 `editor.html?edit=<slug>` 直接打开某篇已发布文章编辑。

> 前端隐藏工作区只是体验，不是安全边界：Worker 的每个写接口（登录回调、图片上传、发布）都会校验会话与作者白名单，未登录或非作者无法绕过。

> 预览与正文路径的拆分：编辑器正文里存的是仓库相对路径 `assets/images/...`（发布到线上后正确），但本地工作副本里没有 Worker 刚提交的图，static server 会 404。编辑器预览会把 `<img src="assets/images/...">` 临时改写成 `raw.githubusercontent.com/.../main` 直链显示，只影响预览 DOM、不改正文，发布内容仍是正确的仓库相对路径。

安全要点：

- **GitHub Token / OAuth Secret 只存在 Worker Secret 里**，不写进 `wrangler.toml`、`js/`、HTML 或 localStorage。
- 前端只持 HttpOnly 会话 cookie，永远拿不到 PAT。
- 服务端重新校验 slug / 日期 / 标题 / 专栏 / 标签 / Markdown，不信任浏览器校验结果。
- 拒绝 `javascript:` / `vbscript:` / 危险 `data:` 协议，禁止原始 HTML 注入。
- 只写固定路径 `posts/<slug>.md` 与 `js/posts.js`，分支固定为 `main`，不接受客户端传的任意路径或分支。
- 发布前检测 slug 冲突（新建时 slug 已存在 → 409；更新时远程 SHA 冲突 → 409 提示重新载入）。

> 直接写 `main` 的代价与回滚：相比「发布为 PR 再合并」，少了人工审阅这一步，发布即上线。回滚方式是在仓库里对 `posts/<slug>.md` 或 `js/posts.js` 做 `git revert`，或用 GitHub Pages 的历史部署。生产环境务必保持 `GH_API_TOKEN` 权限最小（只授权目标仓库的 `contents:write`），并定期轮换。

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

围栏代码块按语言标记做渲染后增强：

- ` ```mermaid ` 渲染成 SVG 图表（流程图、时序图、类图、甘特图、git 图等）。
- ` ```js ` / ` ```c ` / ` ```json ` / ` ```cpp ` 等带语言标记的代码块做语法高亮。
- 没有语言标记的 ` ``` ` 保持普通代码块外观。

> 这套增强是「渲染后」机制：`SimpleMarkdown.render()` 仍输出经过 HTML 转义、带 `class="language-<lang>"` 的安全 `<pre><code>`，再由 `js/diagram-highlight.js` 在节点挂到 DOM 后扫描并替换。Mermaid 用 `securityLevel: "strict"` 且源码取 `textContent`（不解析 HTML），高亮走 `hljs.highlightElement`，二者都不引入新的未转义 HTML。Mermaid 9.4.3 与 highlight.js 11.9.0 都自托管在 `vendor/`，无 CDN 运行时依赖；库没加载或单块渲染失败时降级为原始可读代码。切主题时 Mermaid 会按新主题重渲染，highlight.js 的深浅主题 CSS 也会切换。

### 写 Mermaid 图表时的注意点

本站用的是 **Mermaid 9.4.3**（自托管，见 `vendor/mermaid/`），不是最新的 10+。它的渲染 API 是**同步回调式**（`mermaid.render(id, code, cb)`，回调里拿到 SVG 字符串再插入 DOM），不是 Promise 链。`js/diagram-highlight.js` 已按这套 API 实现，改这个文件时不要套用 Mermaid 10+ 的 `.then()` 写法（9.4.3 下返回的是字符串而非 Promise，`typeof ret.then === "function"` 恒为 false，会算出 SVG 后又丢弃，表现为「没报错也没图表」）。

**标签里有特殊字符要加双引号。** 9.4.3 的词法分析对节点标签里的下列字符比较敏感，不加双引号会同步抛错并降级为源码展示：

| 要双引号的字符 | 错误写法 | 正确写法 |
| --- | --- | --- |
| `#`（如 `#if`、`#define`） | `A[#if foo]` | `A["#if foo"]` |
| `:` `=` `<` `>` `;` | `B[sys_cb.x = 1]` | `B["sys_cb.x = 1"]` |
| 全角 `：`、箭头 `→` | `C[混合：A → B]` | `C["混合：A → B"]` |
| 斜杠 `/` | `D[a / b]` | `D["a / b"]` |
| 括号 `（ ）`、文件后缀如 `.xm` `.h` | `E[Output/bin/xcfg.xm]` | `E["Output/bin/xcfg.xm"]` |

经验法则：节点文本里只要出现上述任一字符，就用双引号把整个标签包起来（`X["..."]`）。这些图在 Typora（Mermaid 10+）里能正常显示，不等于在 9.4.3 里也能正常显示，本地预览时务必通过 HTTP 服务器打开文章页确认图表渲染成 SVG。

## License

MIT
