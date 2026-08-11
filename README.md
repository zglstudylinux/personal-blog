# 嵌入式笔记 - 个人博客

一个面向嵌入式开发者的纯静态个人博客：文章列表、文章详情、关于页。
纯 HTML + CSS + JavaScript，零依赖、零构建步骤，内容用 Markdown 管理，可部署到 GitHub Pages 或 EdgeOne Pages。

**线上地址**：<https://zglstudylinux.github.io/personal-blog/>（GitHub Pages，`main` 分支根目录自动部署）

## 特性

- **纯静态**：HTML + CSS + 原生 JS，没有框架、没有构建步骤，复制文件即用。
- **Markdown 内容管理**：文章放在 `posts/` 目录，在 `js/posts.js` 登记后自动出现在列表。
- **深浅色主题**：跟随系统偏好，可手动切换，选择保存在 localStorage。
- **响应式**：桌面 / 平板 / 手机自适应，遵守 `prefers-reduced-motion`。
- **可部署**：GitHub Pages 或 EdgeOne Pages，纯静态无需后端。

## 目录结构

```
blog/
├── index.html              # 文章列表（首页）
├── post.html               # 文章详情页
├── about.html              # 关于页
├── css/
│   └── style.css           # 全部样式（含深浅色主题、代码高亮、响应式）
├── js/
│   ├── config.js           # 站点配置（名称、作者、默认主题）
│   ├── posts.js            # ★ 文章清单（新增文章在这里登记）
│   ├── markdown.js         # 零依赖 Markdown 解析器
│   ├── theme.js            # 深浅色切换
│   ├── main.js             # 页脚年份、导航高亮
│   ├── list.js             # 首页列表渲染 + 搜索 + 标签筛选
│   ├── post.js             # 详情页：加载并渲染 Markdown
│   └── about.js            # 关于页：加载 about.md
├── posts/
│   ├── rtos-priority-inversion.md
│   ├── adc-sampling-stm32.md
│   ├── uart-ring-buffer.md
│   └── about.md            # 关于页内容
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
  tags: ["STM32", "调试"],
  file: "posts/my-new-post.md"         // 可省略，默认就是 posts/<slug>.md
}
```

3. 刷新首页即可看到。

## 编辑「关于」页

直接改 [`posts/about.md`](posts/about.md)。

## 修改站点信息

改 [`js/config.js`](js/config.js)：站点名、副标题、作者、默认主题。

## 修改样式

改 [`css/style.css`](css/style.css) 顶部的 `:root` 和 `[data-theme="..."]` 里的 CSS 变量：
颜色在 `--accent`（强调色）、`--bg`（背景）等，改一处全站联动。

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
