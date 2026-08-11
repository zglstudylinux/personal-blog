# UART 接收：环形缓冲区 + 空闲中断的方案

串口收不定长数据是嵌入式里的高频需求。轮询太占 CPU，阻塞 `HAL_UART_Receive` 又卡住主循环，长度未知时还不好定 buffer 大小。

我比较喜欢的方案是 **DMA 接收 + 空闲中断（IDLE）+ 环形缓冲区**。它能处理不定长、不阻塞、不丢数据，CPU 几乎零负担。

## 整体思路

1. UART RX 接 DMA，DMA 设为循环模式，目标是一个固定大小的 buffer。
2. 开启 UART 的 IDLE 中断：一帧数据发完，总线空闲时触发。
3. IDLE 中断里，读 DMA 当前剩余量，算出"这一帧写到 buffer 的哪个位置"。
4. 把这帧数据从 DMA buffer 搬进一个环形缓冲区，应用层从环形缓冲区取完整帧。

这样 DMA 负责高效搬运，IDLE 中断负责"划界"，环形缓冲区负责"解耦收发速度"。

## DMA 初始化

```c
#define RX_DMA_LEN 256
static uint8_t rx_dma_buf[RX_DMA_LEN];

void uart_rx_start(void) {
    HAL_UARTEx_ReceiveToIdle_DMA(&huart1, rx_dma_buf, RX_DMA_LEN);
    // 关掉 DMA 半传输中断，我们只在 IDLE 时处理
    __HAL_DMA_DISABLE_IT(huart1.hdmarx, DMA_IT_HT);
}
```

`HAL_UARTEx_ReceiveToIdle_DMA` 是 HAL 库里现成的"收直到空闲"接口，比手写省事。

## IDLE 事件回调

HAL 提供 `HAL_UARTEx_RxEventCallback`，IDLE 或 DMA 满都会调它，`Size` 是本次收到字节数：

```c
void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart, uint16_t Size) {
    if (huart->Instance != USART1) return;

    // Size 是相对 rx_dma_buf 起始的偏移（这一段已收到）
    ringbuf_push(&rx_ring, rx_dma_buf, Size);

    // 重新启动下一轮 DMA 接收
    HAL_UARTEx_ReceiveToIdle_DMA(&huart1, rx_dma_buf, RX_DMA_LEN);
    __HAL_DMA_DISABLE_IT(huart1.hdmarx, DMA_IT_HT);
}
```

注意：每次回调后要**重新启动** DMA 接收，否则只收一帧就停了。

## 环形缓冲区

一份可以直接用的极简实现，单生产者（中断）单消费者（主循环），用 `volatile` 头尾索引避免临界区：

```c
#include <stdint.h>
#include <string.h>

#define RING_SIZE 1024   // 必须 2 的幂，方便掩码取模

typedef struct {
    uint8_t  buf[RING_SIZE];
    volatile uint16_t head;   // 写入位置（中断里更新）
    volatile uint16_t tail;   // 读取位置（主循环更新）
} ring_t;

static ring_t rx_ring;

static inline uint16_t ring_mask(uint16_t x) { return x & (RING_SIZE - 1); }

void ringbuf_push(ring_t *r, const uint8_t *data, uint16_t len) {
    for (uint16_t i = 0; i < len; i++) {
        r->buf[ring_mask(r->head)] = data[i];
        r->head = ring_mask(r->head + 1);
        // 满了就丢最旧数据（按需改策略）
        if (r->head == r->tail) r->tail = ring_mask(r->tail + 1);
    }
}

uint16_t ringbuf_pop(ring_t *r, uint8_t *out, uint16_t maxlen) {
    uint16_t n = 0;
    while (n < maxlen && r->head != r->tail) {
        out[n++] = r->buf[r->tail];
        r->tail = ring_mask(r->tail + 1);
    }
    return n;
}

uint16_t ringbuf_available(ring_t *r) {
    return (RING_SIZE + r->head - r->tail) & (RING_SIZE - 1);
}
```

`RING_SIZE` 设成 2 的幂，`& (SIZE - 1)` 代替取模，比 `%` 快很多，M0/M0+ 上尤其明显。

## 应用层取数据

主循环里非阻塞地取：

```c
void loop(void) {
    static uint8_t frame[256];
    uint16_t n = ringbuf_pop(&rx_ring, frame, sizeof(frame));
    if (n > 0) {
        // 按你的协议解析 frame[0..n-1]
        protocol_parse(frame, n);
    }
    // 其它工作...
}
```

## 几个注意点

**1. volatile 不等于原子**

单字节读写 + 头尾分别只在一边更新的场景下，`volatile` 够用。但如果你在多核或者有更复杂的共享结构，得上关中断或信号量。STM32 单核 + 中断/主循环这种 SPSC 模型，这套是安全的。

**2. 别在 IDLE 回调里做重活**

中断里只做"搬数据 + 重启 DMA"，解析全放主循环。在中断里调 `memcpy` 之外的解析、打印，容易把时序拖崩。

**3. 数据可能跨 DMA 边界**

如果一帧比 `RX_DMA_LEN` 还长，会被 DMA 拆成两段。要么保证帧长 < buffer，要么在应用层做"粘包拼接"。我的做法是 buffer 至少是最大帧长的 2 倍，IDLE 中断划界时基本不会跨边界。

**4. 关半传输中断**

`__HAL_DMA_DISABLE_IT(huart1.hdmarx, DMA_IT_HT)` 这行很关键。不开的话 DMA 半满也会进回调，`Size` 会是半满值而不是真实收到长度，容易把数据重复处理。

## 小结

这个方案的核心是各司其职：

| 模块 | 职责 |
| --- | --- |
| DMA | 高效搬运，不占 CPU |
| IDLE 中断 | 一帧结束划界 |
| 环形缓冲区 | 解耦收发速度，抗突发 |

配好之后，串口收发基本不用管，只在主循环里"有空就取一点"就行。比轮询和阻塞都干净。
