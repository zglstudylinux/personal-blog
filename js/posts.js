/* ============================================================
   posts.js - 文章清单（内容管理的唯一入口）
   ------------------------------------------------------------
   新增文章只需：
     1. 在 posts/ 目录放一篇 .md 文件
     2. 在下面 POSTS 数组里加一条配置
   字段说明：
     slug    : Markdown 文件名（不含扩展名），也是 URL 参数 (?p=slug)
     title   : 文章标题
     date    : 发布日期，格式 YYYY-MM-DD
     excerpt : 列表页摘要（一两句，纯文本）
     tags    : 标签数组，用于筛选
     file    : Markdown 文件路径（相对站点根，默认 posts/<slug>.md）
   ============================================================ */
window.POSTS = [
{
    slug: "rtos-priority-inversion",
    title: "RTOS 里的优先级反转：一次调试记录",
    date: "2026-08-03",
    excerpt: "高优先级任务被低优先级任务卡死，背后是一个互斥锁。从现象到定位，再到优先级继承的修复过程。",
    tags: ["RTOS", "调试", "FreeRTOS"],
    file: "posts/rtos-priority-inversion.md"
  },
  {
    slug: "adc-sampling-stm32",
    title: "STM32 ADC 多通道采样与 DMA 配置笔记",
    date: "2026-07-18",
    excerpt: "用 DMA 做多通道 ADC 采集，省 CPU 又不掉采样率。记录 CubeMX 配置和踩过的几个坑。",
    tags: ["STM32", "ADC", "DMA", "硬件"]
  },
  {
    slug: "uart-ring-buffer",
    title: "UART 接收：环形缓冲区 + 空闲中断的方案",
    date: "2026-06-25",
    excerpt: "串口收不定长数据时，环形缓冲区配合空闲中断比轮询和阻塞都好用。附一份可直接用的 C 实现。",
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
  }
];
