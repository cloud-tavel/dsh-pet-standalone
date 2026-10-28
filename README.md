# dsh-pet-standalone

**把一只桌面宠物从「IDE 插件」拆成「双击即装的 Windows 程序」，并让它在键盘上跟着你一起按。**

> 上游：[`PC2005-cloud/dsh-pet`](https://github.com/PC2005-cloud/dsh-pet)（MIT）· 本项目是其独立发行衍生版
> 角色形象与全部动画素材来自上游，本项目不声称原创 ·
> 已移除的第三方素材与原因见 **[NOTICE.md](NOTICE.md)**

---

## 为什么会有这个项目

上游 dsh-pet 是一只住在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里的桌宠：
106 段透明动画、拖拽甩抛物理、屏幕漫游、AI 碎碎念、右键点播。它做得很完整，但有一个前提——
**你得先装一个 IDE**。

本项目把这条路拉直：一个 exe，装完就能用。

| | 上游 dsh-pet | 本项目 |
| --- | --- | --- |
| 前置条件 | 先装 DeepSeek Harness | **无** |
| 启动方式 | 插件随 IDE 加载 | **双击图标** |
| Electron | 运行时现场下载 | **打包内置** |
| 不填 API key 时 | 依赖 DSH 的模型 | **内置 L0 台词库，照样会说话** |
| 键盘 | 无 | **显示按了哪些键，宠物跟着一起按** |

---

## 三个差异点（按实现优先级）

### 1. 键盘联动

在桌宠旁边的独立浮层上显示你正在按的键（适合游戏常用键），宠物同时做「敲击」动作；
连击累积时切到更激烈的动画。

技术上用全局低级键盘钩子（`uiohook-napi`，N-API 免重编译，自带 win32-x64 预编译二进制），
不是 Electron 的 `globalShortcut`——后者只能注册热键，且会把按键从系统抢走。

> 竞品参考：`ayangweb/BongoCat`（Tauri，2.3 万 star）已占据「通用跟随打字」这个位置。
> 本项目不做通用版跟随打字，只做 **键帽可见 + 游戏键位预设 + 宠物连击反应**。

### 2. 零 key 也能说话

分四层能力，默认打开最底层，用户按需升级：

```
L0  内置台词库（同步、纯函数、零依赖、零 token）   ← 默认
L1  本机已装的模型服务自动探测（Ollama 等）
L2  本地小模型（可选，占磁盘）
L3  用户自己的 API key（OpenAI 兼容 / Anthropic）  ← 可选增强
```

**本项目不托管任何 API key。** 用户自带的 key 只存在本机。

### 3. MCP Server

让支持 MCP 的 AI 助手能控制这只宠物（让它走到某处、说一句话、播一段动画）。

---

## 当前状态

**开发中。** 仓库当前是「合规清场完成后的上游代码」，还没有可下载的安装包。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0 | 合规清场：移除商用字体与社区梗图、补 NOTICE、干净历史首发 | ✅ 完成 |
| 1 | L0 台词库 | 待开始 |
| 2 | AI provider 接线（上游 0.3.8 已内置 openai-compatible + anthropic） | 待开始 |
| 3 | 剥离 `@deepseek-ai/*` 依赖 | 待开始 |
| 4 | `electron-builder` 出 NSIS 安装包 + 打包瘦身 | 待开始 |
| 5 | 键盘联动模块 | 待开始 |
| 6 | MCP Server | 待开始 |

`dsh-pet/` 目录里的代码继承自上游，可直接按其 README 构建运行；
**独立发行所需的部分（打包、L0 台词、键盘模块）尚未落地**，所以现在还不能下载。

---

## 目录

```
dsh-pet/                  实际的项目包（结构继承上游）
  src/                    源码：client（渲染）/ host（服务）/ shared（两端共用）
  assets/webm/            106 段透明动画（VP9-alpha）
  assets/preview/         106 张 GIF，README 演示用
  runtime/electron-helper/  Electron 主进程（透明置顶窗、DPI、命中区、看门狗）
  scripts/                构建与打包脚本
prompts/  tools/  video/  上游的素材生成链：提示词 → 源视频 → 透明动画
README-UPSTREAM.md        上游原始 README（素材生成链说明在那里）
NOTICE.md                 素材归属与已移除清单
```

---

## 构建

```bash
cd dsh-pet
npm install --legacy-peer-deps   # 见下方说明
npm run bundle                   # 源码 → lib/（已验证通过）
npm run start:app                # 以独立应用方式启动（无需 DeepSeek Harness）
```

需要 Node.js 20+。首次启动会下载约 143 MB 的 Electron 运行时——
这正是阶段 4 要消除的东西（改为随安装包内置）。

> **已知问题：`npm run build` 会在「生成类型声明」这一步失败。**
> 上游代码 import 了 4 个 `@deepseek-ai/*` 包（`dsh-llm` / `dsh-home-paths` /
> `dsh-credentials` / `dsh-client-ui-primitives`），公共 npm 上只有 `0.0.1-rc.x`，
> 不满足项目声明的 `^0.2.0-rc.1`，因此 `npm install` 装不到它们，`tsc` 报
> `TS2307 Cannot find module`。
>
> 这不影响 `npm run bundle`（tsdown 已通过）与运行——只影响 `.d.ts` 生成。
> **剥离这 4 个依赖是阶段 3 的任务**，完成前请用上面的 `bundle` + `start:app`。
> ⚠️ 第一次双击会被 Windows SmartScreen 拦一下（exe 未签名）：点「更多信息」→「仍要运行」。
> 这不是病毒提示，是「没见过这个发布者」的例行警告。

---

## 许可

代码：[MIT](LICENSE)。

**素材不在 MIT 覆盖范围内**：角色形象与动画来自上游项目，本项目不声称对其拥有原创权；
上游随包的「上首软糖体」与 27 张社区梗图已从本仓库**移除**（前者协议禁止向第三方再分发，
后者原作者无版权可授）。完整说明见 [NOTICE.md](NOTICE.md)。
