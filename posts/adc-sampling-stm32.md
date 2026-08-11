# STM32 ADC 多通道采样与 DMA 配置笔记

需求很简单：采 4 路模拟信号（两路电压、一路温度传感器、一路电位器），采样率不用很高，每路 1kHz 足够。一开始我用轮询逐通道读，CPU 占用挺高，而且时序抖动大。后来改成 DMA 一次搬一批，省心很多。

记录一下 CubeMX 里的配置和踩过的坑。

## CubeMX 配置

ADC1 选 4 个通道，模式设为 **Scan Conversion Mode = Enable**，这样会按通道顺序依次转换。

关键参数：

- **Continuous Conversion Mode = Enable**：转完一轮自动开始下一轮，不用软件触发。
- **DMA Circular Mode**：DMA 循环模式，缓冲区写满后从头继续写，配合 ADC 连续转换正好。
- **Number Of Conversion = 4**：对应 4 个通道。
- **Sampling Time**：我选了 71.5 cycles，温度传感器要求最低采样时间 10us，按 72MHz 时钟算大概够。

DMA 配置：

- 模式：Circular
- 数据宽度：外设 16-bit，存储器 16-bit（ADC 数据寄存器是 12 位，用 16 位搬就行）
- 优先级：Medium

## 缓冲区设计

开一个双倍长度的缓冲区，DMA 写满一半触发半传输中断，写满触发完成中断，刚好可以在另一边被写的时候安全处理这一边：

```c
#define ADC_CHANNELS 4
#define ADC_BUF_LEN  (ADC_CHANNELS * 8)   // 每通道 8 个样本，一轮

volatile uint16_t adc_buf[ADC_BUF_LEN];

// 启动
HAL_ADC_Start_DMA(&hadc1, (uint32_t*)adc_buf, ADC_BUF_LEN);

// 半传输完成中断：前半段已填满，可处理 adc_buf[0 .. half-1]
void HAL_ADC_ConvHalfCpltCallback(ADC_HandleTypeDef* h) {
    process_samples(&adc_buf[0], ADC_BUF_LEN / 2);
}

// 传输完成中断：后半段已填满，可处理 adc_buf[half .. end-1]
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef* h) {
    process_samples(&adc_buf[ADC_BUF_LEN / 2], ADC_BUF_LEN / 2);
}
```

这样处理和数据采集可以并行，不会互相覆盖。

## 踩过的坑

**坑 1：DMA 不启动**

忘了调 `HAL_ADC_Start_DMA`，或者 DMA 中断没在 NVIC 里使能。CubeMX 勾了 DMA 不等于自动启动，还得代码里 `Start`。

**坑 2：读到的值顺序对不上**

Scan 模式下，通道转换顺序由 ADC 的 `SQR` 寄存器决定，不是看你引脚号。CubeMX 里 **Rank** 这一列就是转换顺序，buffer 里第 0 个值对应 Rank1，第 1 个对应 Rank2。通道号和 Rank 不一致很常见，别按通道号读数组。

**坑 3：温度传感器通道忘了开 VREF / VBAT**

STM32 内部温度传感器、VREFINT、VBAT 共用一些使能位。温度通道通常还要使能 `TSVREFE` 之类的位（不同型号叫法不同），不然读出来是 0 或者满量程。

**坑 4：数据对齐**

默认右对齐，12 位结果在 `0..4095`。如果选了左对齐，16 位寄存器里高位是有效位，直接按 0..4095 算会算错。确认 `DR` 寄存器的对齐方式再算电压。

## 电压换算

参考电压 3.3V，12 位 ADC：

```c
float to_voltage(uint16_t raw) {
    return (raw * 3.3f) / 4095.0f;
}
```

温度传感器有专门的公式（看参考手册里的 `TS_CAL1` / `TS_CAL2` 校准值），别用线性比例硬算，误差挺大。

## 小结

多通道 ADC 配 DMA 的核心就三件事：**Scan 模式 + 连续转换 + DMA 循环**。配通了之后 CPU 几乎不用管，定时去缓冲区拿数据就行。最坑的是通道顺序和数据对齐，调试时先拿逻辑分析仪或打印确认每个 buffer 元素对应哪一路，再往后算。
