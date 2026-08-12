# blog-api — 博客在线发布后端（Cloudflare Worker）

这个目录是博客的**后端 API**，与静态站点部署在不同域名上。静态站点继续放在 GitHub Pages（`https://zglstudylinux.github.io/personal-blog/`），前端通过 `js/config.js` 里的 `apiBase` 指向本 Worker。

GitHub Pages 本身不能安全写回仓库，也不能保存 GitHub Token 或对象存储密钥。所以**真正安全的在线发布必须经过这个 Worker**。

> ⚠️ **机密只在 Worker Secret 里**。本目录下的代码、`wrangler.toml`、`.dev.vars` 都**绝不能**包含真实的 GitHub Token / OAuth Secret / R2 Secret。前端（`../js/`）更是永远拿不到这些。

## 它做什么

- **GitHub OAuth 登录**：`/api/auth/login` → GitHub 授权 → `/api/auth/callback` 签发会话。
- **会话**：自签 JWT 放在 `HttpOnly + Secure + SameSite` cookie 里，前端只持 cookie，拿不到 PAT。**生产**（静态站在 `github.io`、Worker 在 `workers.dev`，跨站）用 `SameSite=None; Secure`，否则跨站 `fetch(credentials:"include")` 不会带 cookie，登录门禁永远不通过；**本地** `localhost`（同站、http）用 `SameSite=Lax`。`setSessionCookie` / `clearSessionCookie` / OAuth `state` cookie 三处必须一致。
- **作者白名单**：只允许 `ALLOWED_GH_IDS` 里的 GitHub 数字 user id 发布。
- **图片上传**：`/api/images/upload` 校验类型/大小/魔数后，用 GitHub Contents API 把图片提交到 `assets/images/<yyyy>/<mm>/<uuid>.<ext>`，返回站点根相对路径，直接写进 Markdown。随 GitHub Pages 一起部署，无需对象存储。
- **发布**：`/api/posts/publish` 服务端校验后，作者登录后**直接写 `main` 分支**，同时提交 `posts/<slug>.md` 与 `js/posts.js` 注册表。`mode: "create"` 新建（slug 必须不存在），`mode: "update"` 用 SHA 更新已有文章并替换同 slug 的注册表条目。**不再创建 PR**，发布即上线。两次 Contents API 调用按「先正文后注册表」顺序，第二步失败返回 `partial: true`，不伪称成功。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/login` | 跳转 GitHub 授权页 |
| GET | `/api/auth/callback` | OAuth 回调，签发会话 cookie，跳回 `editor.html` |
| POST | `/api/auth/logout` | 清除会话 |
| GET | `/api/auth/me` | 返回 `{ login, name, id }` 或 `{ login: null }` |
| POST | `/api/images/upload` | `{ type, size, data }` → `{ ok, publicUrl }`（data 为 data URL 或纯 base64；提交到 Git 仓库 `assets/images/`） |
| POST | `/api/posts/validate` | dry-run 校验，不写仓 |
| POST | `/api/posts/publish` | 校验 + 直接写 `main`：`mode: "create"` 新建（slug 不存在）/ `mode: "update"` 更新（带 SHA）。成功返回 `{ ok, mode, slug, message }`；冲突 409，部分成功 500 带 `partial: true` |

## 部署步骤

1. 安装 Wrangler（Cloudflare CLI）：

```powershell
npm install
```

2. 设置 Secret（**不要写进 wrangler.toml**）：

```powershell
npx wrangler secret put GH_CLIENT_ID
npx wrangler secret put GH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET       # 至少 32 字节随机串
npx wrangler secret put ALLOWED_GH_IDS        # 逗号分隔的 GitHub 数字 user id
npx wrangler secret put GH_REPO               # 如 zglstudylinux/personal-blog
npx wrangler secret put GH_API_TOKEN          # PAT，需 contents:write
```

> 图片走「直接提交进 Git 仓库」方案，不需要 R2 / 对象存储 / `R2_PUBLIC_BASE`。
> 直接写 `main` 后不再需要 `pull_requests:write` 权限，PAT 只需 `contents:write`。

3. 本地开发：

```powershell
npx wrangler dev
```

把本地地址（例如 `http://localhost:8787`）临时填进 `../js/config.js` 的 `apiBase` 测试；并在 `wrangler.toml` 的 `LOCAL_ORIGIN` 里加上静态站点的本地地址（默认 `http://localhost:8000`）。

4. 发布 Worker：

```powershell
npx wrangler deploy
```

然后把 Worker 的正式地址填进 `../js/config.js` 的 `apiBase`，例如 `https://blog-api.<你>.workers.dev`。

## GitHub OAuth App 配置

在 GitHub → Settings → Developer settings → OAuth Apps 新建一个 OAuth App：

- **Homepage URL**：`https://zglstudylinux.github.io/personal-blog/`
- **Authorization callback URL**：`https://<你的 Worker 域名>/api/auth/callback`

把生成的 Client ID / Client Secret 分别设为 `GH_CLIENT_ID` / `GH_CLIENT_SECRET`。

> OAuth 回调成功后，Worker 会 302 跳回 `SITE_ORIGIN + SITE_PATH + "/editor.html"`（生产即 `https://zglstudylinux.github.io/personal-blog/editor.html`）。`SITE_PATH` 在 `wrangler.toml` 里配 `"/personal-blog"`，对应 GitHub Pages 子路径；漏配会跳到 `https://zglstudylinux.github.io/editor.html`（GitHub 返回 404）。

## GitHub App / PAT 权限

`GH_API_TOKEN` 需要的最小权限：

- Repository → Contents：Read and write（提交 `posts/*.md` 与 `js/posts.js`）
- 只授权目标仓库（`zglstudylinux/personal-blog`），不要给所有仓库。
- 直接写 `main` 不再需要 Pull requests 权限。

## 安全要点（必须遵守）

- **永远不要**把 `GH_CLIENT_SECRET`、`GH_API_TOKEN`、`SESSION_SECRET`、R2 Secret 写进 `wrangler.toml`、`js/`、HTML 或 localStorage。
- 前端只持 HttpOnly cookie；Token 只在 Worker 内使用，**不会**出现在响应、日志或前端源码里。
- 服务端重新校验 slug / 日期 / 标题 / 专栏 / 标签 / Markdown（见 `src/lib/validate.js`），不信任浏览器校验结果。
- 拒绝 `javascript:` / `vbscript:` / `file:` / 危险 `data:` 协议；禁止原始 `<script>` / `<iframe>` 等块。
- 只写固定路径 `posts/<slug>.md` 与 `js/posts.js`，分支固定为 `main`（服务端常量），不接受客户端传的任意路径或分支。
- 发布前检测 slug 冲突：新建时 Markdown 已存在 → 409；更新时远程 SHA 冲突 → 409 提示重新载入，避免并发覆盖。
- 两次 Contents API 调用非原子：先写正文、再写注册表；第二步失败返回 `partial: true`，不伪称成功。
- Origin / CORS 白名单 + 请求体大小限制 + 简单频率限制。

## 直接写 main 的风险与回滚

相比「发布为 PR 再合并」，直接写 `main` 少了人工审阅这一步，发布即上线，误操作或内容问题会立刻公开。缓解措施：

- 作者白名单 + 服务端重校验是唯一的安全边界，前端的登录门禁只是体验，不要当作安全控制。
- `GH_API_TOKEN` 权限最小，只授权目标仓库的 `contents:write`，定期轮换。
- 回滚：在仓库里对 `posts/<slug>.md` 或 `js/posts.js` 做 `git revert`，或用 GitHub Pages 的历史部署还原。
- 并发编辑由 SHA 冲突保护：两人同时改同一篇会有一方收到 409，需重新载入后再发布。
- 若要恢复人工审阅，可把 `publish.js` 改回创建发布分支 + PR 的旧流程（保留 `findEntryRange` / `updateRegistryEntry` 仍可复用）。

## 目录结构

```
api/
├── wrangler.toml          # Worker 配置（只含变量名，不含值）
├── package.json
└── src/
    ├── worker.js          # 入口 + 路由
    └── lib/
        ├── http.js        # 响应 / CORS / 频率限制
        ├── jwt.js         # 极简 HS256 会话 token
        ├── validate.js    # 服务端内容校验与 Markdown 净化
        ├── github.js      # OAuth 换 token + REST API 调用
        ├── publish.js     # 直接写 main：create / update + 注册表条目
        └── images.js      # 图片提交到 Git 仓库 assets/images/
```

## MVP 边界

第一版只做：单作者 GitHub 登录、会话、图片直接提交进 Git 仓库 `assets/images/`、发布直接写 `main`（create / update）、服务端校验与基础安全防护。

暂不做：多作者权限、云端草稿同步、定时发布、孤儿图片清理、自动合并冲突编辑器、生产级频率限制（当前是 Worker 内存计数，跨实例不共享，生产建议用 KV / Durable Object）。
