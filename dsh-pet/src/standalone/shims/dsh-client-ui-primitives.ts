/**
 * `@deepseek-ai/dsh-client-ui-primitives` 的**类型替身**（独立模式 / 离线类型检查用）。
 *
 * 为什么需要它：这个包是 DSH web 前端的「平台种子模块」，与 react / cordis 并列，
 * 由宿主前端壳注入（`require('@deepseek-ai/dsh-client-ui-primitives')`），公共 npm
 * 上没有可供独立安装的等价物。而 `src/client/app.ts` 与 `src/client/command-faces.ts`
 * 对它是**静态 import type**，`tsc` 必须能解析这个模块名，否则整个类型检查在第一步
 * 就失败（TS2307），连带 `lib/types` 的声明产物也生成不出来。
 *
 * 它和另外三个 shim 的性质不同，**请注意区分**：
 * - `dsh-llm` / `dsh-home-paths` / `dsh-credentials` 的替身会被 `tsdown.config.mjs`
 *   用 alias **换进独立模式产物**，它们的实现会真的执行，必须与真实契约逐处对齐。
 * - 本文件**永不进产物**：`tsdown.config.mjs` 三份配置都把这个包名按 `@deepseek-ai/*`
 *   整族外部化（浏览器半侧由 DSH 壳提供，独立模式压根没有这半侧）。所以这里只负责
 *   "让类型空间成立"，实现一律是安全的空降级。
 *
 * 契约来源：`src/` 里实际用到的面只有 5 个符号 —— `IconProps`（类型）与 4 个图标组件
 * （`IconQueueOutlineRegular` / `IconUsersOutlineRegular` / `IconGaugeOutlineRegular` /
 * `IconSlidersTwoOutlineMedium`）。图标在 DSH 侧是 94 个内置图标里的 4 个，本文件不复制
 * 那批图标资源（无版权、且体积不值），只声明形状。
 *
 * **维护约束**：新增对 primitives 的引用时，必须同步在这里补声明；否则 `tsc` 会报
 * "不存在的导出"——这正是想要的效果，它会逼着你确认那个符号在 DSH 上真的存在。
 */
import type { ComponentType } from 'react';

/**
 * DSH 图标组件的公共 props。
 *
 * DSH 的图标格固定尺寸渲染，调用方通常只传 `size`（本插件两处都是 `{ size: 16 }`
 * 与默认尺寸），其余字段保持开放以免与宿主的真实定义漂移。
 */
export interface IconProps {
  /** 边长（px）。DSH 图标是单色 SVG，宽高一致。 */
  size?: number;
  /** 附加类名（宿主内部用于配色）。 */
  className?: string;
  /** 内联样式（宿主内部用于尺寸微调）。 */
  style?: Record<string, string | number>;
}

/** 不渲染任何内容的图标：只在「本文件被误打进产物」时兜底，正常路径下永不执行。 */
const noopIcon: ComponentType<IconProps> = () => null;

/** 对话气泡（DSH 内置图标：唯一的纯对话气泡，用于 `/chat` 命令行）。 */
export const IconQueueOutlineRegular = noopIcon;

/** 双人形（用于 `/pet` 命令行：多只桌宠里挑一只）。 */
export const IconUsersOutlineRegular = noopIcon;

/** 仪表盘（用于 `/balance` 命令行：额度 / 用量）。 */
export const IconGaugeOutlineRegular = noopIcon;

/** 滑杆（设置页导航里「桌宠配置」那一行的图标）。 */
export const IconSlidersTwoOutlineMedium = noopIcon;
