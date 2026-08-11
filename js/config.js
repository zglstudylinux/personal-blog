/* ============================================================
   config.js - 全站配置
   修改这里即可调整站点信息，不用动其它 JS。
   ============================================================ */
window.SITE_CONFIG = {
  // 站点名称（显示在页头）
  name: "嵌入式笔记",
  // 站点副标题 / 一句话描述
  description: "记录嵌入式开发里的调试心得、RTOS 笔记和硬件小实验。",
  // 作者名（显示在文章 meta 与关于页）
  author: "佚名",
  // 默认主题：dark / light / auto（auto 跟随系统）
  defaultTheme: "dark",
  // 文章 Markdown 所在目录（相对于站点根）
  postsDir: "posts",

  // ---- 在线编辑/发布相关（公开配置，不含任何密钥）----
  // 发布后端 API 基础地址。留空表示尚未启用在线发布，
  // 编辑器将只显示「尚未配置发布服务」提示，不进入编辑界面。
  // 填上 Worker 地址后启用作者 GitHub 登录、编辑与发布。
  apiBase: "https://blog-api.zglstudylinux.workers.dev",
  // 允许调用 API 的来源（CORS / Origin 校验在服务端进行）
  siteOrigin: "https://zglstudylinux.github.io",
  // 仓库已提交图片的 raw 直链前缀（公开仓库，非密钥）。仅用于编辑器预览：
  // 正文里存的是仓库相对路径 assets/images/...，本地无该文件时预览改写成此直链，
  // 避免本地 404。不影响发布内容（发布仍是仓库相对路径）。
  gitRawBase: "https://raw.githubusercontent.com/zglstudylinux/personal-blog/main",
  // 图片上传限制（前端预校验，服务端仍会再校验一次）
  imageMaxBytes: 5 * 1024 * 1024, // 5 MB
  imageTypes: ["image/png", "image/jpeg", "image/webp"]
};
