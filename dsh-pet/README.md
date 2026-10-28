> **本文件继承自上游项目，其中「表情包 / 字体」相关的描述指**上游原版**。**
> 本发行版已移除随包字体（上首软糖体）与 27 张社区梗图，因此：
> 内置 `memes` 为空、`whisperImageEnabled` 与 `chatImageEnabled` 默认关闭、
> 字体走系统栈（预设 id 仍叫 `candy`）。配图**功能代码完整保留**，
> 你可自行放入拥有版权的图片后恢复。原因与完整清单见仓库根 `NOTICE.md`。

# dsh-pet 🐾 会陪玩的桌宠

<p align="center">
  <b>你打游戏，它在旁边看着，关键时刻自己开口说一句。</b><br>
  <sub>106 段透明动画 · 拖得动甩得飞 · 能看见你的屏幕 · 只在有话说的时候说话</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-pet"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-pet?label=npm&color=blue"></a>
  <a href="https://www.npmjs.com/package/dsh-pet"><img alt="npm monthly downloads" src="https://img.shields.io/npm/dm/dsh-pet?label=%E6%9C%88%E4%B8%8B%E8%BD%BD&color=brightgreen"></a>
  <a href="https://github.com/PC2005-cloud/dsh-pet"><img alt="upstream" src="https://img.shields.io/badge/upstream-PC2005--cloud%2Fdsh--pet-8A2BE2"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT%20AND%20CC--BY--NC--SA--4.0-orange">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows-0078D4">
  <img alt="assets" src="https://img.shields.io/badge/%E5%8A%A8%E7%94%BB-106%20%E6%AE%B5%20VP9--alpha-ff69b4">
  <img alt="tests" src="https://img.shields.io/badge/tests-1138%20passing-success">
</p>

> **不是「你点它才动」的桌宠，也不是「你问它才答」的助手。**
> 它在你旁边待着，自己看你玩，觉得有意思就开口——一局打完可能只说两三句，但每句都在点上。

一只 Windows 桌面宠物：**106 段透明动画**无缝衔接，能拖能甩能砸墙，会在屏幕上自己散步；
**能看见你的游戏画面**（只截前台那一个窗口），画面真变了才开口解说；
**能念出来**（系统语音，零成本、不联网）。

三种用法：**独立 exe（不装任何东西，双击就跑）** / DSH 插件 / 源码。
零模型成本起步——不主动打扰你的时候，一次 API 都不调。

---

## 🎮 它怎么陪玩

打开游戏，在设置页勾上「看见屏幕」和「陪玩解说」，然后该干嘛干嘛。

它会按你设的节奏（默认 30 秒）看一眼**当前前台窗口**，算出这帧的画面指纹；跟上一帧差得够多（≥30%）才算「场面变了」，才去问模型；模型觉得没什么可说的就闭嘴，觉得有话说就弹一句在它头顶，同时用系统语音念出来。

**几个刻意的设计**（都是实测之后改的，不是拍脑袋）：

| 设计                           | 为什么                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 30 秒看一眼，不是每帧          | 实测每次抓屏 0.6–1.2 秒（系统截屏的固定开销，与图大小无关）。12 秒一次会让游戏掉帧，30 秒是「看得到变化」和「不碍事」的平衡点 |
| 采样时只算指纹                 | 判断「变没变」只需要一个 64 位十六进制串，**画面连 helper 进程都不出**                                                        |
| 变化不到 30% 不打扰            | 走路、转视角、动鼠标都不算「场面变了」                                                                                        |
| 说完冷却 2 分钟                | 否则一句接一句，立刻变噪音                                                                                                    |
| 模型选择「不吭声」不算一次解说 | 免得一句正经话没说，冷却却被白白吃掉                                                                                          |
| 只截前台窗口                   | 桌面、任务栏、别的窗口、桌宠自己，都不在画面里                                                                                |

**实测**（2026-10，Windows 11 / RTX 4060 Laptop / 2560×1440 @1.25）：

| 游戏           | 画面模式    | 结果                                        |
| -------------- | ----------- | ------------------------------------------- |
| 崩坏：星穹铁道 | 无边框窗口  | ✅ 能读出「长乐天」「三月七」等具体文字     |
| 永劫无间       | 全屏（FSO） | ✅ 能读出「宁红夜」「一座幻造城市的拓扑学」 |

两次实测期间 NEAC 反作弊**全程无反应**——它不读游戏内存、不注入 DLL、不模拟键鼠，走的是系统级图形 API（Desktop Duplication / WGC），和录屏软件是同一条路。

> ⚠️ **独占全屏（真 Fullscreen Exclusive）尚未验证**。星铁和永劫走的都是 DWM 合成路径，鸣潮这类可能用真独占的游戏，有可能只拿到黑帧。

## 🔒 它看什么、不看什么

这一节请读完——这是唯一会把屏幕内容发出去的功能，**默认关闭**。

打开之后：

- 只截**前台窗口那块矩形**。桌面图标、任务栏、别的窗口、桌宠自己，都不在画面里
- 缩到半分辨率 JPEG（实测 40–120KB），传给**你自己配置的模型服务商**
- **不落盘**：截图只在内存里活一次请求的时间，日志里也不记内容
- 采样（判断「变没变」）时只算指纹，**画面连 helper 进程都不出**
- 关掉开关：立即丢弃缓存，下一次请求不会再带图

已知限制（诚实版）：

- **遮挡**：截的是「那块屏幕区域」，如果别的窗口盖在游戏上面，截到的是盖着的东西。已加一层修正（问系统「这个位置最上面是谁」），但只修得好中心点被盖的情况
- **多屏**：只支持主屏。游戏在副屏时那一次不截，**不会偷偷退回整屏**
- **独占全屏**：可能黑帧，未验证

成本：一屏图约 384 token。按 DeepSeek 当前计价，1000 张约 **0.17 美元**——30 秒一张、一场两小时的对局约 240 张，合**三毛钱**。

## 📦 装哪个版本

| 你是                    | 装这个            | 说明                                                                            |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------- |
| 只想双击就能用          | **独立版（exe）** | 不用装 Node，不用装 DSH。解压后双击 `dsh-pet.exe`，首次在设置页填模型地址与 Key |
| 已经在用 DSH            | **插件**          | 见下一节，一条命令                                                              |
| 想改代码 / 想自己造一只 | **源码**          | 见「完整项目」                                                                  |

**独立版怎么用**（第一版）：

1. 解压到任意目录（**不要放 `Program Files`**——它要往自己旁边写配置和日志）
2. 双击 `dsh-pet.exe`：桌宠落到桌面，托盘出现图标
3. 打开设置页：**右键桌宠 →「打开网站」**（独立版里这一项打开的就是 AI 设置页，地址带一次性访问令牌，不用记端口）
4. 设置页填：模型地址（默认 `https://api.deepseek.com`）、模型名（`deepseek-chat`）、API Key
5. 想让它陪玩：同一页往下勾「看见屏幕」+「陪玩解说」+「语音播报」

> ⚠️ **第一次双击会被 Windows 拦一下**（蓝色窗口写「Windows 已保护你的电脑」）——这是 SmartScreen 对**未签名程序**的例行提示，不是病毒报告。点「**更多信息**」→「**仍要运行**」即可。之所以没签名，是因为代码签名证书要按年付费，而这个项目因素材协议不能商用、也不收打赏。

> 端口**每次启动随机分配**（不占 3080，避免和你正在跑的 DSH 打架）。想看这次是哪个端口，看 `%USERPROFILE%\.dsh\dsh-pet\logs.txt` 里的 `本机服务 http://127.0.0.1:xxxxx`。
> 退出：右键托盘图标 →「退出」。

---

## 🚀 快速开始（安装插件）

**桌面应用（Electron 版）**：在应用内「插件管理」页的安装框里填 `dsh-pet`，不用开终端；需要在终端里操作时，用桌面应用自带的那份 CLI。

**`dsh web`**：

```sh
dsh plugin --profile web add dsh-pet
```

装完**重开桌面应用**（`dsh web` 用户则重启 `dsh web`）才生效。宠物出现在界面右上角（默认配置角落，可在设置页修改）——全部透明动画开箱即用，无需任何生成流程。

> 💡 格式自动适配：Chrome/Edge/Firefox 与桌面模式（Electron=Chromium）播 `.webm`（VP9-alpha）；macOS Safari/WKWebView 会自动改用 `.mov`（HEVC-with-Alpha）。把 mov 素材放进目录即生效，没放时自动退回 webm（黑底但动画正常播，不会白屏）。见下方「🖥️ macOS 使用 mov」。

> 💡 想自己造一只专属宠物？克隆 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 仓库，用内置素材链（AI 提示词 → 绿幕视频 → 透明动画，素材由豆包生成）从零生成，全流程可复现。

> 💡 不想每次都开着 DSH？**独立版**可以完全不打开 DSH 让桌宠住在桌面上——第一版直接给 exe（见上面「📦 装哪个版本」），也可以 `npx dsh-pet-standalone` 或从源码跑，详见「🧍 独立运行（完全不打开 DSH）」。

### 安装后你会看到什么

默认 `display: "both"`（浏览器与桌面都显示），重开 DSH 后两处会依次出现，不必手动开：

1. **浏览器端先出现**：宠物落在界面右上角（默认角落，设置页可改），此时桌面上还是空的。
2. **宿主自动补桌面运行时**：本机没有 Electron 时会自己下载一份（落在 `~/.dsh/electron`，同一版本只下一次），进度直接打在 DSH 的控制台里（`[dsh-pet] Electron not found …` → `downloading …` → `download complete …`）。这一步在**后台**进行，浏览器里的宠物照常可用，等多久取决于网速。
3. **桌面端随后出现**：解压完自动拉起桌面 Helper，同一只宠物以透明窗形式落到桌面上——**此时屏幕上一共两只**：浏览器里一只、桌面上那只，共用同一份配置与同一套动画。
4. **想只留一只**：设置页选中该宠物 →「显示位置」下拉框（仅浏览器 / 仅桌面 / 两者都显示 / 都不显示）；或在宠物上**右键 →「显示位置」**子菜单直接切换，不用回设置页。

> 已经装过 Electron（或设了 `DSH_PET_ELECTRON_PATH`）时第 2 步会跳过，桌面端几乎立刻出现；下载失败**只影响桌面模式**，浏览器里的宠物不受影响。探测顺序、手动触发与镜像/版本环境变量见下方「🪟 桌面模式（脱离浏览器，可选）」。

## 🖥️ macOS 使用 mov（Safari 透明播放）

> 本发行版**只发 Windows**，也没有随包发布 `.mov` 素材。这一节留给自行编译 / 想在 mac 上跑的人。

macOS 的 Safari/WKWebView 不认 webm 的 alpha 通道（会渲染黑底），需要用 `.mov`（HEVC-with-Alpha）。客户端会**自动识别 macOS Safari** 并优先请求 `.mov`，所以只需两步：

1. **下载 mov 素材**：<https://github.com/PC2005-cloud/dsh-pet/releases/tag/assets-mov>（保持最新，zip 解压后文件名与 webm 一一对应）
2. **放入素材目录**：把 `.mov` 文件放进 `$DSH_HOME/dsh-pet/main-animation/mov/`（pet pack 宠物则是 `pet/<种类名>-animation/mov/`）

放好后刷新页面即生效，不用重启 `dsh web`。

- **有 mov**：Safari 播 HEVC（真透明）；其他浏览器照旧用 webm，互不影响
- **没有 mov**：Safari 退回 webm（黑底，动画正常播，不会白屏）
- **桌面模式**（Electron=Chromium）始终用 webm，不受影响

## ✨ 功能特性

- **纯粹的桌宠**：不掺业务功能——没有天气查询、系统监控、Agent 状态感知，就一件事：陪你（外加可选的余额展示、系统通知、碎碎念与对话，见配置节）。零核心改动；**默认零模型成本**——只有主动开启碎碎念（`pets[].whisperEnabled`）或主动发起对话时才会调用当前会话所用的模型，其余功能运行时零 LLM/API 调用
- **透明动画**：待机呼吸、打瞌睡、玩魔方、哼歌、炸毛、吐泡泡、玩水枪、小提琴演奏、蓝鲸现世、吃白饭、照镜子、三支舞、写代码、四季动作（放风筝、堆雪人、吃冰淇淋、放烟花……）全部无缝衔接
- **永不停止的动画链**：每段动画播完立即按权重选下一个（默认 idle 10 / turn 5 / move 5，剩余 80% 归随机动作分类）
- **屏幕漫游**：朝 facing 方向行走，自动检查空间、不走出屏幕（多屏时默认可骑缝跨屏；设置页「锁定在当前屏幕」开启后只在当前所在那块屏内走）
- **点击 / 拖拽（弹簧跟手 + 甩抛反弹 + Q 弹）**：点击有随机回应动画（开心 / 害羞 / 傲娇）并「**Q 弹**」挤压回弹（垂直压扁 55% → easeOutBack 回弹过冲，贴地锚定）；拖拽为**过阻尼弹簧跟手**（不抖不飘、无 overshoot）；松手按最后轨迹估速（停顿/慢速 = 温柔放下原地停住）——**用力甩出即沿抛物线飞行：撞屏幕边缘按恢复系数反弹、落地摩擦减速至停，每次落地按冲击速度 Q 弹（轻落 0.8 ~ 重砸 0.55）**；物理与挤压曲线纯函数在 `src/shared/physics.ts`，浏览器与桌面严格同一手感（`prefers-reduced-motion` 时跳过挤压）
- **物理参数化（0.2.5）**：拖拽抛掷手感全部由配置 `physics` 段驱动——重力（`gravity`，**0 = 无重力漂浮**）/ 碰壁恢复系数（`restitution`）/ 地面摩擦（`groundFriction`，0 = 冰面）/ 顶部反弹开关（`ceilingBounce`）/ 总力度（`throwPower`）/ 多宠物碰撞开关（`petCollision`），所有宠物共用（**全局默认**：设置页改一次对含 pet pack 的全部宠物生效；种类文件顶层可覆盖，见配置节）；**设置页「物理」区可图形化编辑**（6 个控件，与四个全局开关同一套语义：改完点「保存」整包写入用户配置，非法值就地红字提示、宿主也会拒绝）
- **点击积分（0.2.5）**：飞行中的宠物被**按下**（速度 ≥ 400px/s）→ 点击处爆开粒子 + 弹出积分卡片；分数 = 速度/100 × 462/大小（线性，越快/越小分越高——小宠物目标小、更难命中，奖励更高）；静止/慢速点击维持普通点击回应动画（`prefers-reduced-motion` 时跳过粒子）
- **多宠物碰撞（0.2.5）**：`petCollision: true` 开启后，飞行中的宠物撞到其它宠物按**动量守恒 + 恢复系数 0.995** 弹开（质量 ∝ size²，被撞方从落点以新初速抛出去），浏览器与桌面跨窗口同语义（默认关闭）
- **🎮 陪玩解说（默认关闭）**：你玩游戏，它自己看、自己在关键时刻开口——每 30 秒采一帧，画面变化 ≥30% 才算「换场面」，说完冷却 2 分钟；模型判断没什么可说时保持沉默，**且不消耗冷却**。不念屏幕（不会跟你说「画面里有血条和敌人」），只说你此刻该在意的事。实测星铁与永劫无间都能读出画面里的具体文字，详见「🎮 它怎么陪玩」
- **👁 看见屏幕（默认关闭）**：对话时可把当前**前台窗口**的截图一起发给模型——它看着你的画面说话，不是瞎猜。只截前台窗口那块矩形，桌面、任务栏、别的窗口都不进画面；采样判断「变没变」时只算 64 位指纹，**画面连 helper 进程都不出**。详见「🔒 它看什么、不看什么」
- **🔊 语音播报（默认关闭）**：说的同时念出来。默认用 Windows 自带语音合成——不联网、不花钱、100ms 出声；也可切到自建本地 TTS 服务（`POST /say` 或 `GET /tts`），任何一步失败自动回退系统语音，不会突然变哑巴
- **碎碎念**：宠物时不时自己冒一句——按 `eventsRefreshSec.whisper` 周期（默认 300 秒）调用当前会话所用的模型生成（人设 = **该宠物自己的** `whisperPrompt`，没写就回落到所属条目的那份；另追加一句名字声明与时间背景），气泡展示 10 秒；右键菜单「碎碎念」可立即催一句（绕过节流，同一实例的多端一起看到）。**默认开启**，按宠物可关（`pets[].whisperEnabled`）
- **对话**：右键「对话」弹窗跟宠物聊天，也能用 `/chat <消息>` 命令（留空 = 催一句碎碎念）——记忆持久化在 `$DSH_HOME/dsh-pet/memory.json`（**全存不删**，每次请求只带最近 `chatMemoryRounds` 轮），浏览器与桌面共享同一份记忆；对话目标为 `/pet` 选中的那只，未选则取列表第一只
- **表情包配图（0.2.9）**：气泡可以带一张表情包——碎碎念**随机抽 1 张**（`whisperImageEnabled`：只是把这张图的描述加进同一次请求，约 +100 字符 / ≈60 token，增量可忽略）；对话把**整张清单**交给模型按语境选（`chatImageEnabled`：每条消息约 +1.1k 字符 / ≈650 token，约碎碎念配图的 11 倍，随图片数量线性增长）。图片与描述的映射在 `memes`（键 = 表情包目录里的 `<键>.png`；素材归属与动画同一套，见「高级自定义」），两个开关默认都开
- **右键级联菜单**：右键宠物弹出（桌面与浏览器共用同一份组件，`src/shared/menu.ts`）——桌面端根项「**打开网站** / **查看余额** / **回到初始位置** / **重载配置** + **动作**」、浏览器端「**回到初始位置** + **动作**」；「打开网站」用**系统默认浏览器**打开 DSH 网站（等效网页里 Ctrl+点击链接）；「查看余额」立即拉余额弹气泡播档位动画（与周期触发同一展示路径）；「回到初始位置」停漫游回配置角落；「重载配置」（桌面专属）请宿主重启桌面 Helper——**全部桌面宠物窗口按最新配置重建**，改完配置文件不必回设置页点保存（与保存同一条重启路径：等旧进程退出再起新的；代价是会话内拖拽落点清空、回配置角落）；**动作 → 分类 → 具体动画**（分类 = 待机/转向/拖拽/点击回应/移动/随机动作分类/余额档位；**点播「移动」分类动画会真实行走一段**——边界检查/随机距离/起停时段与随机移动完全一致；noMirror 文字类朝右时自动强制朝左）——浏览器端只在宠物命中区拦截右键（`preventDefault`），完全不进入/改动 DSH 页面自己的菜单。**「打开网站」按宿主自动分派**：宿主是 DSH 桌面应用时该项自动变「**打开软件**」，用应用自注册的 `dsh://open` 协议把桌面应用主窗口唤到前台（已运行前置 / 未运行拉起）；`dsh web` 与独立模式仍是系统默认浏览器打开站点
- **左右朝向**：所有动画 CSS 镜像，人物可朝左 / 朝右
- **落地对齐**：动画统一脚底线，宠物始终站在"地面"上
- **流畅切换**：双缓冲 video 交叉淡入，切换零空白帧
- **无障碍友好**：支持 `prefers-reduced-motion`
- **多开**：可配置多个宠物同屏，每只独立的 id/大小/位置/余额开关/显示位置（设置页「桌宠配置」添加/删除）
- **桌面模式（可选）**：可脱离浏览器住上桌面——透明置顶局部小窗，与浏览器严格同行为（见下节）
- **余额展示**：实时显示余额/额度，按档位播动画 + 头顶联想气泡，每只宠物可独立开关
- **额外宠物种类（pet pack）**：在 `pet/` 自建「种类」（独立动画池 + 自己的素材），多实例共享，与主宠物严格隔离（见配置节）
- **自定义动画**：`main-animation/webm/` 放 VP9-Alpha `.webm` 即作为新动画，优先于包内素材（macOS Safari 可再放一份同名 `.mov` 到 `main-animation/mov/`，会被自动优先使用）

## 🪟 桌面模式（脱离浏览器，可选）

默认情况下宠物住在 DSH 网页里（浏览器 overlay）。安装后还会**自动拉起一个脱离浏览器的桌面形态**：

- **独立透明置顶窗口**：为**每只桌面宠物**各开一个**局部小窗口**（尺寸 = 宠物包围盒 + 四周外扩余量，为气泡/弹窗预留空间；透明、置顶、跳过任务栏），窗口跟随宠物移动；窗口**永不铺满屏幕**（全屏透明置顶窗会触发 Windows DWM 视频合成黑屏：需「透明置顶 + 非点击穿透 + 可聚焦且已聚焦 + 完整盖住视频窗」四项齐备，与窗口尺寸无关，详见 `runtime/electron-helper/main.js` 文件头注释；桌宠悬停时会翻成可交互、`show()` 也会聚焦，故全屏画布形态仍不做）。与浏览器一致，只有宠物**身体命中区**可交互，窗口内其余透明像素与窗口外一律**点击穿透**到下层应用（`setIgnoreMouseEvents` + 悬停命中翻转）
- **与浏览器严格同行为**（同一份源码两个外壳）：宠物功能/文案完全对齐——多开宠物同屏显示、角落+边距定位、同一动画链/点击/拖拽/余额档位动画与富余额气泡；**页面配置的显示位置由 `display` 字段决定，两端宠物内容只可能一致，不会出现"一个有另一个没有"**。系统通知是独立于宠物的能力（见配置节 `notificationsEnabled`），不在此列
- **共享纯逻辑**：待机选择 / 移动几何 / 余额折算 / 配置校验 / 通知映射都在 `src/shared/`，浏览器 bundle 与桌面 `shared-core.js`（构建产物，`window.PetShared`）共用同一份源码，只有最外层的渲染壳不同（React vs 纯 DOM）

### 桌面模式怎么装 / 关

- **插件安装**：桌面版在应用内「插件管理」页装 `dsh-pet`（见上方「快速开始（安装插件）」）
- **依赖 Electron**：首次拉起时自动探测（`DSH_PET_ELECTRON_PATH` 环境变量 → 本机 electron 包 → `~/.dsh/electron/` 落地路径），找不到会通过官方 @electron/get 自动下载到 `~/.dsh/electron/`（`npm run ensure:electron` 可手动触发）；Electron 不可用时仅日志告警，**不影响浏览器形态**
- **开关 = 每只宠物的 `display` 字段（pets 必填，四个值）**：
  - `web` = 仅浏览器 overlay / `desktop` = 仅桌面模式 / `both` = 两者都显示 / `none` = 都不显示
  - 桌面模式渲染 `display` 含 `desktop` 的**全部**宠物（多开同屏，与浏览器一致）；大小/位置各自读自己的配置
  - 在 DSH 设置页「桌宠配置」编辑，保存即时生效；`display` 缺失/非法即配置错误，**代码不做兜底**
- 桌面与浏览器是**同一套动画素材**（`/dsh-pet-7340/thumb/<前缀>/<name>.webm`：main 用用户 `main-animation/` 目录优先 + 包内素材；额外宠物只查自己的 `pet/<前缀>-animation/`，同种类多实例共享）；**配图（表情包）共用同一套素材归属**（`/dsh-pet-7340/pic/memes/<前缀>/<名>.png`：`pet/<前缀>-memes/` 独占 → 用户 `memes/` → 包内 `assets/memes/`）；配置加载失败会**大声报错**（红色错误条 + 每 5 秒自动重试），绝不静默兜底

## 🧍 独立运行（完全不打开 DSH）

上面的桌面形态由 DSH 宿主拉起。独立模式让它**不需要 DSH 在跑**：把插件自己的宿主半边
（`src/host/index.ts` 的 `apply`）跑在一个最小的伪 ctx 上，再起一个本机 HTTP 服务接管路由 ——
**路由表仍然只有插件那一份**（同一个 handler 同时服务 HTTP 与桌面助手的 bridge 管道）。

```sh
npm install -g dsh-pet        # 必须 npm 装；dsh plugin add 装进 profile，bin 不在 PATH 上
dsh-pet-standalone            # http://127.0.0.1:3080/dsh-pet-7340/（占用则顺延）
dsh-pet-standalone --check    # 只体检
dsh-pet-standalone --port 3100

npm run build && npm run standalone   # 仓库里（先构建）
```

- **能用**：动画链、点击/拖拽/甩抛、右键菜单、多开、自定义动画、pet pack，以及**碎碎念、对话、余额、系统通知、看见屏幕、陪玩解说、语音播报**——这些原先只有 DSH 宿主能给，现在独立模式自己实现了一份。
- **不可用**：`/pet` `/chat` `/balance` 斜杠命令（那是 DSH 输入框的入口）、浏览器 overlay（独立模式只有桌面窗）。
- **设置页**：`http://127.0.0.1:3080/standalone-ai/` —— 模型连接、定时碎碎念、看见屏幕、陪玩解说、语音播报，全在这一页。
- **AI 配置**：`$DSH_HOME/standalone-ai.json`（不含明文 Key）；`$DSH_HOME/dsh-pet/main-config.jsonc` 仍是宠物本体配置（位置、大小、物理、动画）。
- **只显示 `display` 含 `desktop`/`both` 的实例**；端口默认 3080；`Ctrl+C` 或 `POST /shutdown` 退出。
- **与 DSH 内运行可同时开**，但共用 `%APPDATA%\dsh-pet-electron-helper`，可能互相踩缓存（仅告警）。
- **多开**：端口被占会自动顺延到下一个，**不是单实例锁**——双击两次会起两个完整实例（两份采样计时器、两份 AI 调用）。

## ⌨️ 斜杠命令

在 DSH 输入框里以 `/` 触发（与其它插件命令同一入口，命令面板可搜）：

| 命令               | 说明                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/pet [id 或名字]` | 选择「当前桌宠」——也就是 `/chat` 的对话目标。留空查看当前选中的是谁；浏览器端支持命令面板的选择框，也可手输 id 或名字（名字重名时必须用 id，报错会列出候选 id）                            |
| `/chat [消息]`     | 与当前桌宠对话：**留空 = 立刻催一句碎碎念**（绕过节流，等价于右键菜单「碎碎念」）；输入消息 = 正常对话。回复会写进记忆，并以气泡出现在宠物头顶（浏览器与桌面两端都能看到，配图随回复一起） |
| `/balance`         | 手动触发余额显示并立即弹出气泡（与到点自动触发同一条展示路径）：服务商有余额/额度接口 = 档位动画 + 余额气泡；未登记接口 / 缺凭证 / 抓取失败 = 文字说明气泡（绝不静默无反应）               |

> 没选过 `/pet` 时，命令作用于**有效宠物列表的第一只**（列表 = `config.jsonc` 的 `pets` + `pet/` 目录的种类文件，同屏多开则按顺序取首只）。配图开关见配置节 `whisperImageEnabled` / `chatImageEnabled`。

## ⚙️ 配置

| 配置项                         | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设置页「桌宠配置」             | DSH 设置 → 桌宠配置：图形化编辑**大小 / 位置 / 边距**，支持**多开**（添加/删除宠物，每只独立配置）；全局开关也在设置页——系统通知（点保存才写入）、碎碎念配图 / 对话配图 / 锁定在当前屏幕（随「保存」一起写入）；保存**即时生效**，「同步」把项目内置的 `config.jsonc`（原文，含注释与全部高级字段）整份写入用户配置，既是恢复默认又留下一份可直接编辑的完整配置                                                                                                                                    |
| `pets`（config.jsonc）         | 默认宠物列表：`[{ "id", "name", "size", "balanceEnabled", "whisperEnabled", "workStatusEnabled", "display", "position": { "corner", "marginX", "marginY" }, "whisperPrompt"? }]`；`display` 为 web/desktop/both/none（必填，缺失即配置错误）；`whisperEnabled` / `workStatusEnabled` = 碎碎念 / 工作状态气泡开关（默认：true）；`whisperPrompt` 可选 = **这只宠物自己的人设**（见下一行）；多只即多开，`display` 含 desktop 的宠物出现在桌面窗口（与浏览器同屏渲染），首只为「添加宠物」的默认模板 |
| `whisperPrompt`                | 碎碎念与对话共用的**人设系统提示词**：写在 `pets[]` 条目里 = 该宠物专属，写了就**取代**所属条目顶层那份；写在条目顶层（或种类文件顶层）= 该条目的默认人设。设置页「桌宠配置」每只宠物都有「人设」输入框（留空 = 跟随条目）。只写正文：实际发出的 system = 它 + 自动追加的一句「你的名字是“<宠物名>”。」+ 一行时间背景（日期/星期/时刻/时段/工作日或周末/节日），**没有长度上限**，也别在里面重复写名字和日期                                                                                       |
| `chatMemoryRounds`             | 每次对话请求携带的最近历史轮数（默认 5；1 轮 = 1 问 1 答；0 = 不带历史）：`memory.json` **全存不删**，此值只决定截取多少进上下文。**全局默认**（设置页「AI 模型与对话上下文」区一个数字输入框，改一次对所有宠物生效，含 pet pack；种类文件顶层可覆盖）                                                                                                                                                                                                                                             |
| `whisperModel` / `chatModel`   | 碎碎念 / 对话各自用哪个**服务商 + 模型**（**全局默认**：设置页改一次对所有宠物生效，含 pet pack；种类文件顶层可覆盖。设置页「AI 模型」每项一个下拉框，与 DSH 对话框右下角的模型选择器同款：搜索 + 按服务商分组的清单，选项同源）。`provider` 与 `model` **都留空 = 跟随当前对话的模型**（默认）；只填一半即配置错误。填了但调用失败（凭据被删 / 模型下架）会自动回落到当前对话的模型重试一次                                                                                                       |
| `whisperImageEnabled`（0.2.9） | 碎碎念配图开关（布尔，默认开；**全局默认**，pet pack 可在种类文件里覆盖）：开启后每次碎碎念从 `memes` 池**随机抽 1 张**，连同那句话一起显示。token：碎碎念本来就每次生成都要调一次模型，配图只多约 100 字符（≈60 token），增量可忽略                                                                                                                                                                                                                                                               |
| `chatImageEnabled`（0.2.9）    | 对话配图开关（布尔，默认开；**全局默认**，pet pack 可在种类文件里覆盖）：开启后把**整张** `memes` 清单交给模型**按语境选 1 张**（可不选；选了池外名称视为没选，标记会原样留在正文里）。token：每条消息约 1.1k 字符（≈650 token），随图片数量线性增长                                                                                                                                                                                                                                               |
| `chatImageLimit`               | 对话配图**张数上限**（非负整数，默认 10，0 = 不限制；**全局默认**，pet pack 可在种类文件里覆盖）：对话时只把 `memes` 清单的**前 N 张**（= 配置里写在前面的那 N 条，想优先发哪几张就往前写）交给模型选图。原因：整张清单是**每条消息都要附**的，token 随张数线性增长（27 张约 1.1k 字符 ≈ 650 token），限制成前 N 张即可给配图开销封顶。设置页「AI 模型与对话上下文」区可改。只影响对话选图——碎碎念只带抽中的那一张                                                                                 |
| `memes`（0.2.9）               | 表情包映射：键 = 表情包目录里的 `<键>.png` 文件名（不含扩展名），值 = 该图内容的简要描述（模型据此选图/配文）。图片按**素材归属**查找（种类独占 `pet/<前缀>-memes/` → 用户目录 `memes/` → 包内 `assets/memes/`，与动画同规矩）；配置里写了但哪个目录都没有该文件的条目**自动失效**（删图不必同步改配置）；删掉某个键即停用该图                                                                                                                                                                     |
| `notificationsEnabled`         | 系统通知总开关（布尔，默认开）：对话完成 / 生成失败 / 输出截断 / 权限申请 / 用户选择，在窗口失焦时弹系统级通知（桌面右下角）                                                                                                                                                                                                                                                                                                                                                                       |
| `physics`（0.2.5）             | 拖拽抛掷物理参数（**全局默认**，所有宠物共用；种类文件顶层可覆盖）：`gravity` 重力 / `restitution` 碰壁恢复系数（0~1）/ `groundFriction` 地面摩擦 / `ceilingBounce` 顶部反弹 / `throwPower` 总力度 / `petCollision` 多宠物碰撞开关；缺省取内置默认（1400 / 0.78 / 2.5 / true / 1.0 / false）；`gravity=0` 为无重力，`petCollision=true` 开启多宠物碰撞                                                                                                                                             |

> 说明：插件安装即用，配置均为可选；设置页保存的用户覆盖写入 `$DSH_HOME/dsh-pet/main-config.jsonc`（用户层，优先于包内默认）。

### 📄 高级自定义（直接编辑配置文件）

用户数据统一收敛在 `$DSH_HOME/dsh-pet/`：

| 层                   | 路径                                  | 作用                                                                                                                                                   |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 默认配置（只读）     | 包内 `assets/config.jsonc`            | 完整结构参考：宠物列表 / 动画池（idle/turn/drag/clicks/moves/categories）/ 播放权重                                                                    |
| 用户配置             | `$DSH_HOME/dsh-pet/main-config.jsonc` | 覆盖片段：可整体覆盖 `pets` / `animations` / `animationWeights`，缺省字段回落默认                                                                      |
| 对话记忆（自动生成） | `$DSH_HOME/dsh-pet/memory.json`       | 对话历史（user/assistant 正文，**全存不删**；每次请求只取最近 `chatMemoryRounds` 轮）。删掉即清空记忆                                                  |
| 用户动画（可选）     | `$DSH_HOME/dsh-pet/main-animation/`   | 放入 `.webm`（VP9-Alpha）即可作为动画播放，**优先于包内素材**（`main-animation/webm/` 子目录；macOS Safari 的 `.mov` 放 `main-animation/mov/` 子目录） |
| 用户表情包（可选）   | `$DSH_HOME/dsh-pet/memes/`            | 放入 `.png` 即可作为配图，**优先于包内素材**；键（文件名去扩展名）与描述仍需写进配置的 `memes`                                                         |

- 设置页底部「高级配置」显示这些路径；「卸载与存储」列出插件的全部存储位置与卸载命令
- 自定义动画：把 `xxx.webm` 放进 `main-animation/webm/`，在动画池/分类里写 `"xxx"`，**刷新页面**即可（无需重启 DSH）
- 格式：`.webm` 需 **VP9 Alpha** 编码（Chrome/Edge/Firefox），与包内素材同规范，普通编码会有黑底。macOS Safari 用的同名 `.mov`（HEVC-with-Alpha）放 `main-animation/mov/`，会被**自动优先**使用；缺 mov 时自动退回 webm（黑底，不会白屏）
- 修改用户配置后同样**刷新页面**生效
- 动画名请对照默认配置填写，避免引用不存在的动画
- 表情包图片按**素材归属**查找（与动画同一套）：`pet/<前缀>-memes/`（种类独占，见下节）→ 用户目录 `$DSH_HOME/dsh-pet/memes/` → 包内 `assets/memes/`。往用户目录放 `xxx.png`，再在 config 的 `memes` 里写 `"xxx": "这张图的描述"`，**刷新页面**即可用（加图/换图不必再改包内目录，也就不会被 `add`/更新覆盖）；只想去掉某张图，删 config 里对应的键即可（不用动图片文件）

### 🐾 额外宠物（pet pack）——添加新「种类」

默认只能调整主宠物（`config.jsonc` / `main-config.jsonc` 的 `pets`）。要添加**全新种类的宠物**（独立动画池 + 自己的素材），在用户数据根下建 `pet/` 目录：

```
$DSH_HOME/dsh-pet/pet/
├─ pig-config.json        ← 额外宠物 pig 的配置（命名词干 = 种类名，实例 id 任意）
├─ pig-animation/         ← pig 自己的动画素材（直接平铺 .webm，仿 main-animation）
│  ├─ 待机.webm
│  └─ 打滚.webm
└─ pig-memes/             ← 可选：pig 自己的表情包（直接平铺 .png，仿用户 memes/）
   └─ 吃白饭的大肥鱼.png
```

每只额外宠物 = 一个 `-config.json`（配置）+ 一个 `-animation/` 目录（素材），同前缀配对，扫描 `pet/` 自动发现（浏览器与桌面同时生效，无需重启）；`-memes/` 目录可选，有则**独占**该种类的配图（见下节）。

配置文件**与 `main-config.jsonc` / `config.jsonc` 完全同构**——直接复制一份 main 配置、换成自己的动画池，就是一只新宠物。一个 `-config.json` 定义**一个「种类」**（动画池 + 素材目录），`pets` 数组可放该种类的**任意多只实例**（每只独立 size/位置，共享动画池与素材）：

```jsonc
// pet/pig-config.json —— 与 main-config.jsonc 同构的完整配置；animations / animationWeights 必填（不回落全局）
{
  "notificationsEnabled": true,
  "pets": [
    {
      "id": "pig1", // 实例 id（可多只；不必等于文件名前缀）
      "size": 420,
      "balanceEnabled": true,
      "display": "both", // web / desktop / both / none
      "position": { "corner": "top-right", "marginX": 24, "marginY": 100 },
    },
    {
      "id": "pig2",
      "size": 360,
      "balanceEnabled": false,
      "display": "web",
      "position": { "corner": "top-left", "marginX": 24, "marginY": 100 },
    },
  ],
  "animations": {
    "idle": ["待机"],
    "turn": [],
    "drag": [],
    "clicks": ["打滚"],
    "moves": { "default": { "minDist": 80, "maxDist": 360, "margin": 20, "leadSec": 2, "tailSec": 2 }, "actions": [] },
    "categories": [],
    "events": {
      "balance": ["余额-钱袋满溢", "余额-金袋叮当", "余额-钱袋如常", "余额-数金皱眉", "余额-袋空如洗", "余额-分文不剩"],
    },
  },
  "animationWeights": { "idle": 80, "turn": 0, "move": 0 },
  "eventsRefreshSec": { "balance": 1800 },
}
```

规则（与主宠物严格隔离，绝不混用）：

- **素材只查自己的**：素材目录名 = 文件名前缀（`pet/pig-config.json` → `pet/pig-animation/`），该种类所有实例共用；动画 URL 为 `/thumb/<前缀>/<名>.webm`，查不到即 404 报错——**绝不落到 `main-animation` 或包内素材**。配图同理：`pet/<前缀>-memes/` 存在时**只查它**（`/pic/memes/<前缀>/<名>.png` 查不到即 404），绝不回落到用户 `memes/` 或包内 `assets/memes/`
- **动画池不回落全局**：`animations` / `animationWeights` 是该种类的（结构校验与主配置同一套规则）
- `pets` 数组非空、每只字段（id/size/balanceEnabled/display/position）完整合法、数组内 id 唯一——**id 随意写、数量随意**，与主配置完全一致
- **用户层的「全局默认」会生效**：`physics` / `confineToScreen` / `whisperImageEnabled` / `chatImageEnabled` / `chatImageLimit` / `chatMemoryRounds` / `whisperModel` / `chatModel` / `eventsRefreshSec` 这 9 个是**用户级成本 / 偏好 / 环境 / 节奏**参数——用户在设置页（写进 `main-config.jsonc`）改一次就对该种类生效；种类文件顶层写了则用自己那份
- **所有顶层字段都是整段替换**：写了就整段用自己的，缺的子键不会从内置默认补回来（消费端各自兜底：余额周期读不到按 1800、碎碎念按 300）
- `notificationsEnabled` 是**全局**（只读 `main` 条目那份）：种类文件里写了**不生效**（不报错）
- `eventsRefreshSec` 内部两个键的**消费端**不同：`.whisper` 按宠物所属条目读（种类文件顶层可覆盖）；`.balance` 只读 `main` 条目（余额是一个账号一份数据，host 只有一个刷新定时器）
- 配置非法 / 缺少 `-animation/` 目录 / 实例 id 与主宠物冲突 → 加载时显式报错并跳过该宠物（不影响其他宠物）
- 设置页**不列出**文件宠物（改文件即生效，刷新可见）；设置页保存/同步不会把它们写进 `main-config.jsonc`
- 添加/修改/删除 → 刷新页面（浏览器）或重启 Helper（桌面）生效

## 🗑️ 卸载

**独立版（exe）**：删掉解压出来的整个目录就行——不写注册表、不装服务、不加开机自启。用户数据在 `$DSH_HOME/`（默认 `%USERPROFILE%\.dsh\`）下，想彻底清干净就连同 `dsh-pet\`、`standalone-ai.json`、`standalone-runtime.json` 一起删。

**插件版**：

```sh
# dsh web：--profile 填 web
dsh plugin --profile web remove dsh-pet
```

桌面应用（Electron 版）在应用内「插件管理」页卸载。

插件在本机落下的全部位置（设置页「卸载与存储」区块也列出这些，且路径按你的机器实时解析）：

- `$DSH_HOME/dsh-pet/` —— 插件用户数据：自定义配置 `main-config.jsonc`、对话记忆 `memory.json`、自定义动画素材 `main-animation/`、自定义表情包 `memes/`、文件宠物 `pet/`
- `$DSH_HOME/electron/` —— 桌面宠物用的 Electron 运行时（体积较大；删除后下次启用桌面模式会自动重新下载）
- `%APPDATA%\dsh-pet-electron-helper\` —— 桌面宠物窗口缓存与主屏缩放缓存（macOS：`~/Library/Application Support/`；Linux：`$XDG_CONFIG_HOME` 或 `~/.config/`；可删，会自动重建）
- `%LOCALAPPDATA%\electron\Cache\` —— Electron 安装包下载缓存（macOS：`~/Library/Caches/electron`；Linux：`$XDG_CACHE_HOME` 或 `~/.cache/`；可删，需要时会重新下载）
- 插件本体 —— 由 DSH 管理，用上面的命令移除，不要手删

删之前先退出 DSH（桌面宠物随之退出）。缓存类删了无影响；`$DSH_HOME/dsh-pet/` 删了会丢配置与对话记忆（想保留就先备份 `main-config.jsonc`）。

## 🖥️ 运行效果

宠物实际运行在 DSH Web 界面中的样子：

<p>
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/assets/screenshots/dsh-pet-running-1.png" width="380" alt="dsh-pet running in DSH Web UI 1" title="dsh-pet running in DSH Web UI 1">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/assets/screenshots/dsh-pet-running-2.png" width="380" alt="dsh-pet running in DSH Web UI 2" title="dsh-pet running in DSH Web UI 2">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/assets/screenshots/dsh-pet-running-7.png" width="380" alt="dsh-pet running in DSH Web UI 7" title="dsh-pet running in DSH Web UI 7">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/assets/screenshots/dsh-pet-running-8.png" width="380" alt="dsh-pet running in DSH Web UI 8" title="dsh-pet running in DSH Web UI 8">
</p>

## 🎬 效果预览

> 动画为透明背景；GIF 预览中透明部分显示为页面底色，实际播放为透明。

<p>
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/daiji-huxi-xiuxian.gif" width="160" alt="待机呼吸休闲" title="待机呼吸休闲">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/dongzhangxiwang.gif" width="160" alt="东张西望" title="东张西望">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/yuandi-piaofu-tabu.gif" width="160" alt="原地漂浮踏步" title="原地漂浮踏步">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/yuandi-xiaoqi-chenmian.gif" width="160" alt="原地小憩沉眠" title="原地小憩沉眠">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/dianji-huiying-kaixin-yuedong.gif" width="160" alt="点击回应 - 开心跃动" title="点击回应 - 开心跃动">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/beishubiao-tuozhuai-xuankong-fankui.gif" width="160" alt="被鼠标拖拽悬空反馈" title="被鼠标拖拽悬空反馈">
</p>

全部动画见仓库：`dsh-pet/assets/webm/`（VP9-alpha，包内唯一发布的格式）。macOS 的 HEVC-alpha `.mov` 单独发布在 [assets-mov](https://github.com/PC2005-cloud/dsh-pet/releases/tag/assets-mov)，按「🖥️ macOS 使用 mov」两步放好即自动生效。

## 🛠 自己打包

```sh
npm ci
npm run build          # tsdown 出 lib/ + 生成类型 + 收敛 package.json 的 files
node scripts/dist.mjs  # 出 dist-app\win-unpacked\（只出解包目录，不做 NSIS）
```

产物约 **404MB**（Electron 本体 225MB + `app.asar` 58MB，其中动画素材占 53MB），压成 zip 大约 150–180MB。启动 2–3 秒。

三个必须知道的坑（都是这次踩出来的）：

1. **Electron 必须 28+**。`lib/app.js` 是 ESM 且用了顶层 await；Electron 24 会**静默卡死**——不报错、无窗口、进程稳定占 39MB 不动。`electron-builder.yml` 里 `electronVersion: 43.3.0` 与 `scripts/dist.mjs` 传入的 `electronDist` **必须指向同一个版本**，electron-builder 不会替你校验这件事。
2. **测 exe 前先清掉 `ELECTRON_RUN_AS_NODE`**。这个变量存在时（部分 Node/Electron 工具链会设），exe 会退化成纯 Node 进程，表现就是「双击没反应」。判断方法：`./dsh-pet.exe --version` 正常应打印 `v43.3.0`；若打印 `v24.x`（那是内置 Node 的版本号），就是被污染了，用 `env -u ELECTRON_RUN_AS_NODE ./dsh-pet.exe` 再试。
3. **`npm run build` 偶发在生成类型那步失败**（`[prepare] 类型声明生成失败`）。原因是 `tsc` 与刚写完 `lib/` 的 tsdown 抢文件句柄，重跑一次即可；`lib/` 里的 JS 产物本身是全的。

验证产物是否真能跑，别只看进程在不在：

```sh
curl http://127.0.0.1:<端口>/health   # 应返回 name=dsh-pet-app、pets 清单
```

端口在 `%USERPROFILE%\.dsh\dsh-pet\logs.txt` 的 `本机服务 http://127.0.0.1:xxxxx` 那行。

## 📚 完整项目（不止是插件）

这是**完整的三件套项目**，任何人 clone 仓库都可以从零生成自己的桌面宠物：

```
① 提示词（配方）    →  ② 素材生成链（引擎）  →  ③ 插件（成品）
AI 生成动画的配方     源视频 → 透明动画的管线    运行在 DSH 里的宠物
```

- 仓库：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- 素材生成提示词：[prompts/](https://github.com/PC2005-cloud/dsh-pet/tree/main/prompts)（10 秒动作提示词 + 系统通知图标提示词，可直接喂给豆包）

## ⚠️ 第一版的已知问题

写在这里，不藏着：

| 问题                                  | 影响                                                                         | 现状                                               |
| ------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| **独占全屏可能黑帧**                  | 少数用真 Fullscreen Exclusive 的游戏，截到的是黑屏                           | 星铁（无边框）、永劫（FSO）都正常；鸣潮未验证      |
| **CLI 独立模式右键「显示位置」失效**  | `node lib/standalone.js` 起的服务里，这个菜单点了没反应（POST 缺令牌被 403） | exe 版走单进程自带鉴权，**不受影响**；CLI 模式待修 |
| **多开不设防**                        | 双击两次 exe 会起两个实例（各自的采样计时器、各自的 API 调用）               | 端口会自动顺延所以不会崩，但不是单实例锁           |
| **只支持主屏**                        | 游戏在副屏时那一次不截（**不会**偷偷退回整屏）                               | 会跳过这一拍，不报错                               |
| **本地 TTS 引擎没有能直接对上的服务** | 设置页可以选「本地 TTS 服务」，但要自己按 `tools/tts-local/server.py` 起服务 | 系统语音这条主路径一直可用                         |
| **只发 Windows**                      | macOS / Linux 没有安装包                                                     | 源码层面支持，未打包未验证                         |

## 🆚 和别的桌宠项目比

「AI 桌宠」这个赛道已经很挤了。2026 年 10 月把 GitHub 上叫得出名字的都看了一遍：

| 项目                                               | ★    | 它是什么                                                      | 和本项目的差别                                                                                  |
| -------------------------------------------------- | ---- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [OpenPets](https://github.com/OpenPetsHQ/openpets) | 1.3k | 桌宠插件平台，给 Claude Code / Cursor 这类 agent 当可视化配角 | AI 是**被 agent 驱动**的（agent 让它动它才动），不看屏幕、不陪玩；强在插件 SDK 与沙箱           |
| [xiaokeai](https://github.com/liupig/xiaokeai)     | 233  | 3D 伴侣（VRM/MMD），语音、口型、跳舞                          | 不截屏、不陪玩；强在 3D 表现                                                                    |
| [Miru](https://github.com/kiyotakali/Miru)         | 187  | 长期记忆 + 主动陪伴                                           | 不看屏幕、不陪玩；强在记忆与跨设备同步                                                          |
| [Live2DPet](https://github.com/x380kkm/Live2DPet)  | 90   | Live2D 桌宠 + VOICEVOX 日语音色                               | 不看屏幕；强在 Live2D 模型生态                                                                  |
| [dsh-game-pet](https://github.com/bigk5780/dsh)    | —    | 同属 DSH 生态，同样「自动截屏 → 出建议」                      | **思路最接近的一个**。10 段动画、无完整桌宠交互（无物理拖拽/漫游/pet pack）、2026-10 之后未更新 |
| **本项目**                                         | —    | **106 段动画的真桌宠 + 看前台窗口 + 主动陪玩 + 语音**         | —                                                                                               |

说白了：通用 AI 桌宠已经不缺，缺的是**「它主动看你玩，而且真的有话说」**这一件。这也是第一版只押这一个点的原因。

两句诚实的话：

- 上面几个项目的**完成度、跨平台、社区**大概率比本项目好——本项目目前只支持 Windows，且刚刚准备第一次发版。
- 「陪玩」没有成熟参照，**好不好用取决于模型能不能看懂你这款游戏**。星铁、永劫实测可用；冷门游戏它可能说得像个外行。

## 🔎 发现更多 DSH 插件

- 社区插件目录：[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)
- DSH 官方仓库：[deepseek-ai/DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness)

## 📄 许可

**代码：MIT** —— 可商用、可再分发。
上游：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（`Copyright (c) 2026 PC2005-cloud`）；本独立版的改作同样以 MIT 发布。

**动画素材与宠物形象：CC BY-NC-SA 4.0**（署名 · **非商业** · 相同方式共享）—— 这一条覆盖整个项目。

- 形象出处：宠物形象是社区二创的 DeepSeek「大肥鱼」（鲸鱼娘），**非 DeepSeek 官方形象**。原型「溟月」出自 B 站 @上善无形；DeepSeek 版（女仆鲸鱼娘）设计出自 B 站 @ZipZipPipe
- 授权原文：「大肥鱼是遵守 CC BY-NC-SA 4.0 协议的形象，不可以以任何形式商业化。」
- 因此 **本项目整体不可用于任何商业用途**（含付费分发、打赏、广告、带货）
- 基于本项目的衍生 / 改版 / 换皮作品，在 GitHub、产品官网等公开渠道发布时**必须附上原作者仓库地址**：<https://github.com/PC2005-cloud/dsh-pet>
- 提示词与源视频同属上述条款；改过的素材须以同样协议共享

完整判定过程（含三条硬要求与证据链）见仓库根 `LICENSE-AUDIT.md`。
