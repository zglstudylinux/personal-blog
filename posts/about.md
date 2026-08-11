# 关于

你好，我是一个嵌入式开发者，主要折腾 ARM Cortex-M 系列单片机和 RTOS。

## 这个博客写什么

- **调试记录**：实际项目里踩过的坑和定位过程，越具体越好。
- **外设笔记**：ADC、UART、SPI、定时器这些常用外设的配置和使用心得。
- **RTOS 笔记**：FreeRTOS、任务调度、同步原语相关。
- **硬件小实验**：偶尔做一些和传感器、电源、信号调理相关的硬件小东西。

不写宏大叙事，尽量每篇都带能复现的代码或明确的配置。

## 联系方式

- Email：hello@example.com
- GitHub：[github.com/yourname](https://github.com/yourname)

## 这个站点怎么搭的

纯 HTML + CSS + JavaScript，没有框架、没有构建步骤。文章用 Markdown 写，通过一个零依赖的小解析器在前端渲染。

- 内容入口：[`js/posts.js`](../js/posts.js)（文章清单配置）
- 文章源文件：[`posts/`](../) 目录下的 `.md` 文件
- 样式：[`css/style.css`](../css/style.css)

如果你想搭一个一样的，把这套文件复制过去，改 `posts.js` 和 `posts/` 里的 Markdown 就行。

## 致谢

感谢这些开源项目让嵌入式开发更顺手：

- [FreeRTOS](https://www.freertos.org/)
- [STM32Cube](https://www.st.com/en/development-tools/stm32cubeide.html)
- [libopencm3](https://libopencm3.org/)
