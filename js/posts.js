/* ============================================================
   posts.js - 文章清单（内容管理的唯一入口）
   ------------------------------------------------------------
   新增文章只需：
     1. 在 posts/ 目录放一篇 .md 文件
     2. 在下面 POSTS 数组里加一条配置
   字段说明：
     slug     : Markdown 文件名（不含扩展名），也是 URL 参数 (?p=slug)
     title    : 文章标题
     date     : 发布日期，格式 YYYY-MM-DD
     excerpt  : 列表页摘要（一两句，纯文本）
     category : 主专栏名（一篇文章只属于一个专栏，留空则归入「未分类」）
     tags     : 标签数组，用于筛选（一篇文章可有多个标签）
     file     : Markdown 文件路径（相对站点根，默认 posts/<slug>.md）
   ============================================================ */
window.POSTS = [
    
  
  {
    slug: "uart-ring-buffer",
    title: "UART 接收：环形缓冲区 + 空闲中断的方案",
    date: "2026-06-25",
    excerpt: "串口收不定长数据时，环形缓冲区配合空闲中断比轮询和阻塞都好用。附一份可直接用的 C 实现。",
    category: "串口通信",
    tags: ["UART", "C", "裸机"]
  },
  {
    slug: "ab5766-le-mic",
    title: "AB5766 LE Mic 音频算法调用链与测试快速入门",
    date: "2026-08-11",
    excerpt: "AB5766",
    category: "AB5766",
    tags: ["AB5766"],
    file: "posts/ab5766-le-mic.md"
  },
  {
    slug: "slug-test01",
    title: "AB5766 LE Mic 音频算法调用链与测试快速入门",
    date: "2026-08-12",
    excerpt: "",
    category: "AB5766",
    tags: [],
    file: "posts/slug-test01.md"
  },
  {
    slug: "slug-image",
    title: "图片测试",
    date: "2026-08-12",
    excerpt: "",
    category: "",
    tags: [],
    file: "posts/slug-image.md"
  }
];
