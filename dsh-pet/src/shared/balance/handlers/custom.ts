// custom 形态（第三方自定义节点树）：本文件不产生文案、也不决定长什么样 —— 它只把第三方交来的
// 树从视图里取出来。布局、字号、颜色、进度条全由对方在树里声明，两端渲染器按白名单画。
//
// 为什么 rows() 返回空数组：`BalanceBubbleRow[]` 是内置三种形态的展示语言，custom 走的是**节点树**
// 这条并行通道（views()）。空数组让"照旧取行数据"的调用方得到空气泡，而不是错乱的行；
// 两端渲染入口都先判 `state.shape === 'custom'` 再取树（见 client/bubble.ts 与 helper/sprite.js）。
//
// 校验不在这里：解析层（parse.ts 的 parseCustomNode）已经把 tag / 样式 / 容量裁过一遍，
// 到这里的数据是**已可信**的，渲染器不做第二次过滤。

import type { BalanceBubbleRow } from '../types';
import type { ShapeHandler } from './shape';

export const customHandler: ShapeHandler = {
  /** 百分比由第三方直接给（他才知道自己那套额度的分母）；没给 = 不播档位动画 */
  percent: (v) => v.custom?.percent,
  rows: (): BalanceBubbleRow[] => [],
  detail: (): BalanceBubbleRow[] => [],
  views: (v) => v.custom?.views,
};
