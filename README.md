# depth-chart

一个基于 Canvas 的 React 深度图组件，用于展示订单簿买卖盘深度，适合交易终端、行情面板和本地交互调试场景。

## 特性

- 双层 Canvas 渲染，内容层和交互层分离
- 支持 hover tooltip、滚轮缩放、触摸缩放
- 支持深色 / 浅色主题和颜色配置覆盖
- 支持竞价参考价和中间价展示
- 支持通过 ref 执行命令式高亮和清空交互状态
- 内置本地调试 demo，可实时生成盘口样本

## 安装

```bash
npm install depth-chart
```

项目依赖以下 peer dependencies：

- react >= 17
- react-dom >= 17

## 快速开始

```tsx
import { DepthChart } from "depth-chart";
import type { OrderBookData } from "depth-chart";

const data: OrderBookData = {
  buy: [
    { price: 29900, volume: 1.5 },
    { price: 29800, volume: 2.2 },
    { price: 29700, volume: 4.1 },
  ],
  sell: [
    { price: 30100, volume: 1.2 },
    { price: 30200, volume: 2.8 },
    { price: 30300, volume: 4.7 },
  ],
};

export default function App() {
  return (
    <div style={{ width: 720, height: 420 }}>
      <DepthChart data={data} theme="dark" pairCode="BTC/USDT" />
    </div>
  );
}
```

## API

### DepthChartProps

- data: 订单簿数据，必填
- priceFormat: 价格格式化函数
- volumeFormat: 数量格式化函数
- indicativePrice: 竞价参考价，非 0 时启用竞价模式
- midPrice: 中间价
- notEnoughDataText: 数据不足时显示的内容
- theme: 主题，可选值为 dark 或 light
- pairCode: 交易对代码，变化时会重置缩放
- colorsConfig: 自定义颜色配置
- strokeWidth: 曲线宽度
- fillAlpha: 区域填充透明度

### 类型

```ts
type PriceLevel = {
  price: number;
  volume: number;
};

type OrderBookData = {
  buy: PriceLevel[];
  sell: PriceLevel[];
};

interface DepthChartHandle {
  update(price: number): void;
  clear(): void;
}
```

### 命令式调用

```tsx
import { useRef } from "react";
import { DepthChart } from "depth-chart";
import type { DepthChartHandle } from "depth-chart";

function Example() {
  const ref = useRef<DepthChartHandle>(null);

  return (
    <>
      <div style={{ width: 720, height: 420 }}>
        <DepthChart ref={ref} data={data} />
      </div>
      <button onClick={() => ref.current?.update(30050)}>高亮价格</button>
      <button onClick={() => ref.current?.clear()}>清除高亮</button>
    </>
  );
}
```

## 本地开发

```bash
npm install
```

### 脚本

```bash
npm run build
npm run build:types
npm run dev
npm run demo
npm run demo:build
```

说明：

- npm run build: 使用 Vite 进行库模式打包，并使用 TypeScript 生成声明文件
- npm run build:types: 仅生成类型声明
- npm run dev: 以 watch 模式执行 Vite 库构建
- npm run demo: 使用根目录 Vite 直接启动调试页，默认地址为 http://localhost:5173
- npm run demo:build: 复用同一份 Vite 配置构建调试页静态产物

## 调试 Demo

调试页不再单独维护一套 demo 工程，而是直接复用根目录 Vite，入口位于 src/demo。

它主要用于验证这些交互路径：

- 切换交易对时是否正确重置缩放
- 实时数据刷新时曲线、tooltip 和 hover 是否稳定
- 竞价模式下 indicativePrice 的绘制与交互
- imperative API 是否能正确高亮目标价格
- 浅色 / 深色主题以及自定义配色是否正常生效

启动方式：

```bash
npm run demo
```

调试页内置以下能力：

- 多交易对切换
- 实时盘口随机更新
- 买卖倾斜和档位数量控制
- 填充透明度调整
- 竞价模式开关
- 手动输入价格并触发 ref.update

## 项目结构

```text
src/
├── core.ts
├── DepthChart.css
├── DepthChart.tsx
├── demo/
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── drawAxes.ts
├── drawCurves.ts
├── index.ts
├── interaction.ts
├── renderer.ts
├── theme.ts
├── types.ts
└── utils.ts
```

## 构建产物

```text
dist/
├── index.js
├── index.esm.js
├── style.css
└── types/
```

## 许可证

MIT