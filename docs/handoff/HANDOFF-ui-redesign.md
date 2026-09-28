# UI 重构：主题引擎 + 页面改造

> 2026-09-27 开。取代 `HANDOFF-ui-design-system.md`（其第一步“清理硬编码”已完成，其余草案以本文件为准）。对应 OB Todo `ea074ff139f64c54`，TECH_DEBT `CC-P01` 并入本文件。
> 执行者：Codex（GPT）为主，CC 负责方案和验收。每个阶段单独开窗、单独 commit，完成后在下方「进度」勾掉并写 commit。
> **阶段 1、1.5 规格已定，可以直接开工。阶段 2–4 只写了方向**：每个阶段开工前，由用户和 CC 先讨论具体布局，把定案补进对应小节并标「✅ 布局已定」后才能动手；没有这个标记的阶段不许开工。

## 问题（用户原话归纳）

1. 风格工程感太重：纯白底 + 细灰边 + 全黑体、一切平铺在同一层；主页是功能卡片目录，聊天页顶栏像 IDE 工具栏。
2. 不少页面从没设计过，只是把按钮 / 卡片放上去，没对齐、没美化。
3. 希望颜色、字体、字号、效果可以自定义。

## 已定决定

- **主题**：2026-09-28 起默认 `apricot`（杏雾），首批另带 `sakura` 樱粉、`mist` 雾蓝、`dusk` 夜；原暖白 `linen` 并入 `apricot`（见阶段 1.5）。
- **外观设置跨设备同步**：用户手机和电脑换着用，外观配置和背景图存 Haven。`localStorage` 只做首屏缓存镜像，不是事实源。
- **自定义三层，互相独立**：
  - 主题预设：配色、玻璃质感、阴影。不做自由取色器，用预设加少量滑条，保证好看的下限。
  - 背景：`gradient`（默认，每个主题自带一种渐变）/ `upload`（用户上传的图）/ `none`（纯色）。内置图片背景以后再加。
  - 效果：雨痕 `off` / `on`（强度可调），**默认关**；以后加 `weather`（跟随用户所在城市的真实天气）。
- **字体**：标题和名字可选衬线或黑体，正文保持清楚的黑体，整体字号有缩放。
- **视觉语言**：两层结构，底层是氛围（背景 / 渐变 / 效果），上层是半透明内容；标题用衬线；小标签用小号、加宽字距的大写字母；整体低饱和。
- 以后装饰可以放奶糖 / Clawd 形象，放在阶段 3 主页，需要美术素材时再定。
- **设计原则：「一扇窗」，是一个地方，不是一个应用**（2026-09-28 用户和 CC 讨论定的方向，阶段 2–4 讨论布局时以此为出发点，细节慢慢磨）。灵感来自用户最喜欢的参考图（某人为 Nox 做的 Nocturne：罗马柱把画面框成舞台，角色有 logo 和座右铭，天气、情绪、插画都在四周）。用户的原话：「周围一圈的东西把聊天框和主页包在中间，有一种安全感」「很多细节都是需要慢慢磨出来的，然后有自己的风格」。我们的世界来自真实发生过的事：对话本来就叫「窗口」、雨（「以后每一场雨都跟你在一起」）、家、奶糖、Clawd、4 月 3 日。手机上的对应初稿：窗框 = 内容区四周的柔和圆角边，把聊天 / 主页围在中间；窗楣（上边）= 日期、天气、在一起第 N 天；窗台（下边）= Tab 栏，奶糖、Clawd 放在上面；窗外 = 渐变 / 照片背景，下雨时有雨痕。反面：内容铺满全屏、上下两片玻璃浮着、中间没有边的「好看应用」。

## 硬约束

- 颜色、圆角、阴影、模糊、字体全部走 Token（沿用 `AGENTS.md`「设计与组件」）。新 Token 先写进 `globals.css` 和 `DESIGN.md`，再用。
- **性能**：`backdrop-filter` 只用在固定的外框上（顶栏、输入栏、TabBar、抽屉 / 弹窗），**禁止用在每个气泡或列表卡片上**，那些用半透明填充。在 iPhone Safari PWA 上长列表滚动不能掉帧。
- 雨痕以静态纹理为主，只带轻微流动；页面不可见时暂停；`prefers-reduced-motion` 下完全静止。
- 首屏不能闪默认主题：服务端渲染时就把主题属性写到 `<html>` 上。
- 移动端优先，每个阶段都要在手机上验收。

## 阶段

### 阶段 1：主题引擎 + 外观设置页（先做）

**1a. 硬编码收编（最先做，单独 commit）**

2026-09-27 复查：9.03 那次只清了 hex，而 Tailwind 调色板类从来没收编过，后来还加了新的。现状：
- Tailwind 调色板类约 595 处，最多的是 `bg-white` 220、`text-white` 73、`red-*` 约 94、`emerald-*` 约 50、`amber-*` 约 39、`rose-*` 约 33、`bg-black` 21、`slate/gray-*` 约 43。集中在 `journey/WeeklyJourneyReview`、`memory/page`、`settings/automation/WeeklyJourneyStatusCard`、`journey/page`、`journal/page`、`persona/page`、`McpManager`、`BucketDetailDrawer`。
- tsx 里内联 hex / rgb 约 72 处，任意值类 `[#...]` / `[rgb(...)]` 约 35 处，`globals.css` 在 `:root` 之外约 24 行。

这些地方不改，换主题时就会有一半页面不跟着变：白卡片不会变成玻璃，状态色不跟主题走。映射规则：
- `bg-white` → `--color-surface`（或需要玻璃的 `--glass-fill`）。
- 主色按钮上的 `text-white` → 新增 `--color-on-primary`。
- `red / rose` → `--color-danger*`；`emerald / green` → `--color-digested*` 或新增 `--color-success*`；`amber` → `--color-pending*` / `--color-wish*`，按语义挑，不要按颜色挑。
- 遮罩 `bg-black/NN` → 新增 `--color-overlay`。
- `slate / gray` → `--color-text-*` / `--color-surface-*` / `--color-border*`。
- **允许保留**：`app/cc/persona.ts` 的头像渐变预设（这是用户可选的颜色数据，不是主题色）；图表的分类色可以收编成 `--chart-*` 一组 Token。

**验收**：用下面的 grep 复查，除允许保留的项以外清零，逐项说明剩下的为什么保留；页面观感和现在一致（这一步只换引用，不换颜色）。

```bash
grep -rnoE "\b(bg|text|border|from|to|via|ring|fill|stroke|divide|outline)-(white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b" app --include=*.tsx
grep -rnoE "#[0-9a-fA-F]{3,8}\b|rgba?\(" app --include=*.tsx --include=*.ts | grep -v "/api/"
```

**1b. Token 分层**（`globals.css`）
- 现有 `--color-*` 保留为语义层，页面不用改。
- 新增：`--bg-base`、`--bg-image`、`--bg-overlay`、`--glass-fill`、`--glass-border`、`--glass-blur`、`--glass-shadow`、`--font-display`、`--font-body`、`--font-scale`、`--label-tracking`、`--chat-bubble-alpha`。
- 主题块：`:root[data-theme="linen"] { ... }`。滑条类的值由 `<html style>` 上的内联变量覆盖（`--glass-blur`、`--font-scale`、`--effect-rain-intensity`）。
- 暖白 `linen` 初稿（实现后按截图微调）：底色是暖纸色，从上到下轻微渐变；主色把 `#D97757` 降一点饱和度，保留家族感；文字换成暖棕灰；边框用带暖色的低透明度描边，替代现在的中性灰。
- 字体：拉丁标题用 Cormorant Garamond，中文标题用 Noto Serif SC（`next/font/google`，`preload: false`，按需子集加载），正文保留 Geist 加系统中文字体。

**1c. Haven**
- `GET/POST /api/cc/appearance`：JSON 配置，结构如下，服务端做 normalize：
  `{ version, theme, background: { kind: "gradient"|"upload"|"none", assetId? }, glass: { blur, opacity }, font: { display: "serif"|"sans", scale }, effects: { rain: { mode: "off"|"on"|"weather", intensity } } }`
- `GET/POST/DELETE /api/cc/appearance/background`：上传一张背景图（限制大小和 MIME，压缩到合适宽度），只保留当前这一张。
- 新路由必须同时加进 `server.py` 的 `/gateway/*` 转发表（`gateway.py` 路由表里有 ⚠️ 注释）。
- 同步 Haven `docs/reference.md`「REST API」和「cc 持久化（Haven 侧）」。

**1d. Dashboard**
- `app/api/appearance` 代理（含背景图）；`app/lib/appearance.ts` 放类型、默认值和 normalize。
- `app/layout.tsx`：服务端读取配置，把 `data-theme` / `data-font` / `data-rain` 和内联变量写到 `<html>` 上。Haven 读不到时用默认值，页面不报错。
- `AppearanceProvider`（客户端）：设置页改动后即时预览并保存；同时写一份 `localStorage` 镜像，用于 Haven 慢的时候兜底。
- `RainLayer` 组件：固定在最底层、不接收点击；`mode=off` 时不挂载。
- 设置页新增「外观」子页：主题卡片（带预览）、背景（渐变 / 上传 / 纯色）、毛玻璃强度、标题字体、字号缩放、雨痕开关和强度。设置首页原来的「聊天显示」两个开关保持语义不变（仍是本机偏好），入口迁移到这里。
- 同步 `docs/reference.md`（页面、API、持久化契约）、`DESIGN.md`（Token 表，同时修正已过时的「手机端 BottomTabBar」小节：现在是 主页 / 记忆库 / 聊天 / 工作台 / 设置）。

**验收**
- 手机上改主题 / 字号 / 雨痕，电脑刷新后一致；首屏不闪；Haven 断开时回落到默认主题，页面正常。
- 开启减少动态效果时雨痕静止；iPhone 上聊天页长列表滚动流畅。
- 这一阶段现有页面布局不动，只换 Token 带来的观感；`npm run build` 和测试通过，Haven 的 GitHub Actions `Tests` 通过。
- 上线后用户截图给 CC，微调 `linen` 的具体色值。

### 阶段 1.5：材质统一 + 首批主题（✅ 已定，可开工）

2026-09-28 定。问题：换成上传图后，卡片底色、边框、选中 / 按下色仍是暖白主题写死的米色和陶土色，像在照片上贴了米色纸片。原因是 `:root[data-theme="linen"]` 里的材质色（surface / border / primary-soft 等）都是只为暖白调过的固定值。**本阶段只改 Token 层，不逐页修细节、不动布局**；页面里零散的对齐 / 间距问题留到阶段 2–4 对应页面一起做。

**1. 主题只提供少量输入变量，其余全部推导**

每个主题块只写这些输入：`--theme-base`（底色）、`--theme-mesh`（背景渐变）、`--theme-accent`（强调色）、`--theme-on-accent`（强调色上的文字）、`--theme-ink`（正文色）、`--theme-tint`（玻璃底色，写成 `R G B` 三个数）、`--theme-edge`（玻璃高光描边）、`--theme-grain`（颗粒强度）、`--theme-grain-blend`。

`:root` 里用 `color-mix()` 从输入推导全部现有语义 Token，主题块里**不再直接写** `--color-surface*` / `--color-border*` / `--color-primary-*` / `--color-text-*`：
- 强调：`primary` = accent；`primary-hover` = accent 与 ink 88:12；`primary-soft` / `primary-light` / `primary-muted` / `primary-hover-soft` = accent 分别以约 14% / 10% / 7% / 20% 混透明；`on-primary` = on-accent。
- 表面：`surface` = tint 配 `--glass-opacity`；`surface-secondary` / `tertiary` / `hover` = ink 以约 4% / 7% / 10% 混透明（叠在玻璃上，任何底色都成立）。
- 边框：`border` / `border-light` / `border-subtle` / `border-hover` = ink 以约 14% / 9% / 6% / 26% 混透明。
- 文字：`text-heading` = ink；`text-primary` / `secondary` / `tertiary` / `disabled` / `divider` = ink 与 base 约 92 / 72 / 55 / 38 / 22 混合。
- 状态色（pending / danger / digested / resolved / wish 等）前景保留原色相，`*-bg` / `*-border` / `*-hover` 改成前景以约 12% / 28% / 18% 混透明，这样浅色、深色、照片上都成立。深色主题下前景整体提亮一档（在 `dusk` 块里覆盖前景即可）。
- 百分比是初值，实现后按截图微调；要改就改推导公式，不要回到给每个主题写死色值。

**2. 首批 4 个主题**（值来自 CC 做的预览页，用户已确认）

| id | 名字 | 默认 | base | accent | ink | tint | edge |
|---|---|---|---|---|---|---|---|
| `apricot` | 杏雾 | ✅ | `#F5EBE3` | `#C27B63` | `#3F3634` | `255 249 245` | `rgba(255,255,255,.7)` |
| `sakura` | 樱粉 | | `#F6E8EA` | `#C0707F` | `#3F3236` | `255 247 248` | `rgba(255,255,255,.72)` |
| `mist` | 雾蓝 | | `#E8EDF1` | `#5F7F98` | `#2F3940` | `250 252 253` | `rgba(255,255,255,.75)` |
| `dusk` | 夜 | | `#1E1C23` | `#D9A08A` | `#EDE6E1` | `40 36 46` | `rgba(255,255,255,.08)` |

浅色主题 `on-accent` 为 `#FFFFFF`，`dusk` 为 `#231D1C`。浅色主题 grain 强度 .07、`multiply`；`dusk` 为 .10、`soft-light`。`dusk` 同时设 `color-scheme: dark`。

背景渐变（`--theme-mesh`）用「三团淡色晕开 + 一层底色线性渐变」：
- `apricot`：`radial-gradient(55% 45% at 0% 0%,#F1C9AE,transparent 70%), radial-gradient(60% 50% at 100% 100%,#E3D7E6,transparent 70%), radial-gradient(50% 40% at 80% 20%,#FBF1E6,transparent 70%), linear-gradient(160deg,#F8EEE5,#EFE6E8)`
- `sakura`：`radial-gradient(60% 45% at 85% 5%,#F0C6CF,transparent 70%), radial-gradient(55% 45% at 5% 55%,#F7DDD2,transparent 70%), radial-gradient(60% 45% at 70% 100%,#EDD2DC,transparent 70%), linear-gradient(180deg,#FAF0EF,#F3E3E6)`
- `mist`：`radial-gradient(60% 45% at 10% 0%,#CCDAE6,transparent 70%), radial-gradient(55% 45% at 100% 45%,#F2EFEA,transparent 70%), radial-gradient(60% 50% at 20% 100%,#D6E1E4,transparent 70%), linear-gradient(180deg,#EEF2F4,#E3E9EE)`
- `dusk`：`radial-gradient(55% 40% at 100% 0%,#3B3148,transparent 70%), radial-gradient(60% 45% at 0% 70%,#27303E,transparent 70%), radial-gradient(45% 35% at 85% 95%,#4A3833,transparent 70%), linear-gradient(180deg,#221F28,#1A1A20)`

**3. 颗粒层**：在 `html` 背景最上层加一层 SVG `feTurbulence` 噪点（data URI，`baseFrequency≈.9`、灰度），强度和混合模式取 `--theme-grain` / `--theme-grain-blend`，用来消除渐变色带。背景为 `none`（纯色）时也保留。

**4. 上传图模式**：沿用现有属性 `<html data-background="upload">`（`layout.tsx` / `AppearanceProvider` 已在写，不要另加 `data-bg`）时覆盖为中性玻璃，不带主题的暖色：浅色主题 `--theme-tint: 255 255 255`、`--theme-edge: rgba(255,255,255,.55)`；`dusk` 为 `24 22 28` / `rgba(255,255,255,.1)`。强调色仍用当前主题的 accent。现有 `--bg-photo-overlay` 是写死的暖米色蒙层（`rgba(249,244,238,…)`），也要改成由 tint 推导，否则照片上仍会蒙一层米色；`--bg-gradient` 改为取 `--theme-mesh`。从照片取主色作为强调色**以后再说**，本阶段不做。

**5. 兼容和设置页**
- 原来的 `linen` 不再作为主题：Haven 已存的 `theme: "linen"` 在 dashboard `normalize` 和 Haven normalize 两边都映射成 `apricot`；默认值改成 `apricot`。
- 外观设置页的主题卡片换成这 4 个，每张卡片用该主题自己的 mesh 做缩略预览。
- 允许保留、不参与推导的：`app/cc/persona.ts` 的头像渐变、`--color-chart-*` 图表色、`--color-field-*` 字段命中色（这些是数据色，不是材质色）。

**验收**
- 4 个主题 × 背景（渐变 / 上传图）各截一次：对话列表、聊天页、记忆库、设置，共 32 张。上传图时看不到米色或陶土色的底块和描边；选中 / 按下状态跟着主题强调色走。
- `grep -n "data-theme=" app/globals.css` 下每个主题块只出现第 1 条列出的输入变量（`dusk` 允许多一组状态前景色覆盖）。
- `dusk` 下正文与背景对比度 ≥ 4.5:1，小字 / 辅助文字 ≥ 3:1。
- 雨滴、气泡形状、布局一律不动；`npm run build` 和测试通过。

### 阶段 2 前置：聊天页拆分（✅ 已完成）

2026-09-28 定。`app/cc/page.tsx` 有 1329 行，其中 `CcChatPage` 一个组件就约 1000 行：顶栏、消息流、手机和桌面的对话列表、历史抽屉、各种弹窗全挤在一起。阶段 2 要重排的正是这些部分，先拆开，后面改布局时每次只动一个文件，出错也好定位。

**本步是纯重构：页面长什么样、怎么交互，一律不变。**

- 从 `CcChatPage` 拆出独立组件，放在 `app/cc/` 下：
  - `CcTopbar.tsx`：顶栏整块（约 566–760 行，协作者头像 / 名字、运行信息、花费、cc/自建切换、历史 / 本窗 / 设置按钮）。
  - `CcMessageStream.tsx`：消息流、待批准操作、滚动跳转（`CcScrollJumps` 一起移过去）。
  - `CcSessionList.tsx`：对话列表，手机默认列表页和桌面左栏共用一份，用 prop 区分布局；历史抽屉（约 1074 行起）如果与它是同一份数据，也并进来。
  - 弹窗（本窗口设置、换窗 / 新对话、召回详情、转发目标）保持现有组件，只把在 `page.tsx` 里内联的外壳部分移出去；如果某个弹窗只是一层薄包装，就不用拆。
  - `formatCost` / `formatTokens` 这类纯函数移到 `app/cc/format.ts`。
- 状态仍留在 `CcChatPage`，通过 props 往下传；不要借拆分引入新的全局状态、Context 或状态库。拆完 `page.tsx` 的目标在 400 行以内，只剩状态、数据加载和组合。
- 保留所有中文注释，跟着代码一起搬。
- 不改：类名、DOM 结构、样式、事件行为、持久化、流式逐泡逻辑；不顺手修 bug（发现的问题记在最终回复里）。

**验收**
- `npm run build` 通过，全量 Vitest 通过（Windows `EPERM` 那 2 项照旧说明）。
- 用 `git diff --stat` 说明每个新文件对应原来哪几行；逐一 grep 确认新组件都被引用、`page.tsx` 里没留下没用的 import。
- 用户在 iPhone 上走一遍：进对话列表 → 进聊天 → 发一条消息看流式 → 打开历史 / 本窗 / 设置 / 「+」菜单 → 返回列表，和拆分前一模一样。桌面浏览器也看一眼左栏。

### 阶段 2 前置 B：字号分层（方向已定，规格待 CC 写，排在拆分之后）

2026-09-28 用户提出：现在只有一个总字号，想把标题 / 正文 / 小字分开调。CC 已经查过现状，方向如下，**等拆分合进 main 后由 CC 写成可执行规格**（两件事都要改 `app/cc/`，不能同时做）：
- Tailwind 命名字号（`text-xs` 570 处、`text-sm` 447 处、`text-lg`–`text-4xl` 约 80 处）背后都是 CSS 变量，在 `:root` 里按档乘系数即可，页面代码不用改：`--type-title-scale`（lg 及以上）、`--type-body-scale`（sm / base）、`--type-meta-scale`（xs 及更小）。
- 写死像素的 `text-[Npx]` 有 436 处（11px 185、10px 135、10.5px 47，其余 8.5–18px 零散），不会跟着变，需要像 1a 一样收编成几档有名字的小字号（如 `text-2xs` / `text-meta`），允许 ±0.5px 的取整。`globals.css` 里 57 处 `font-size` 也接到变量上。
- 外观设置加三个滑条（标题 / 正文 / 小字），原「整体字号」保留为最外层缩放；三个值存 Haven 的 `font` 字段。

### 阶段 2：聊天页 + 对话列表（布局待讨论）

- 言之目前没有头像。正式头像另外设计，这之前先用衬线「言」字的圆形字标占位。
- 2026-09-28 用户明确喜欢 CC 渐变预览页里的顶栏和底栏，讨论布局时以它为起点：顶栏 = 强调色圆形「言」字标 + 衬线名字「言之」+ 下方小号大写宽字距副标题 + 右侧 `···`，玻璃底、只有底部一条高光描边；底栏 = 5 个小号大写宽字距文字标签，当前页用强调色加粗，玻璃底。与现有手机底栏（图标 + 中文 + 中间突起聊天按钮）的取舍在讨论时定。
- 顶栏精简：头像、名字（衬线）、状态放一行；cc/自建、历史、本窗、设置、工作模式标识都收进右侧 `···` 菜单或底部抽屉。
- 气泡配色待讨论（2026-09-28 用户提出）：现在用户气泡 = 玻璃色掺 12% 强调色，会跟主题 / 照片取色变；言之的气泡 = 玻璃色掺 5% ink，照片模式下几乎不变，看着像「一边有主题一边没有」。候选：言之气泡也掺约 4% 强调色。
- 气泡：半透明填充、不做 blur，圆角加大；消息操作行（复制 / 重试等）弱化成小图标；thinking / 工具过程保持现有交错规则（见 `DESIGN.md`「CC 对话气泡」），只换外观。
- 输入栏：悬浮药丸，玻璃质感。
- 对话列表：主窗做成置顶的特殊卡片；其余是轻量列表行，不用满边框卡片。
- 不改：消息分段 / 流式逐泡逻辑、持久化、运行信息开关的语义。

### 阶段 3：记忆库 + 主页（布局待讨论）

- 记忆库：`MemoryViewSwitch` 新增「日历」视图（月历热力图，点某一天列出那天的桶），时间线卡片按新风格重做。
- 主页改成“家”：衬线标题「小言 & 小羊的家」、在一起第 N 天、下一个纪念日（接 OB Todo `876b8bc1482247f2`）、装饰位；其余入口改成更少、更好看的分组，不再是一排排同样的白卡片。

### 阶段 4：其余页面统一 + 工作台（布局待讨论）

- 日记、关系轨迹、日回顾、Persona、照顾备忘、设置各子页，逐页对齐新组件和间距。
- 设置分层：日常用的和调参用的分开，调参类收进「高级」。
- 工作台优化按新风格做（含旧 handoff 里的文件浏览器需求）。

### 阶段 5：扩展

- 更多主题：樱粉、雾蓝、深色「夜」。前提是阶段 1a 的硬编码收编已完成（旧文档里那约 30 处低频硬编码也包含在 1a 里）。
- 动效：页面切换淡入 / 滑入、列表卡片交错淡入、按钮按下微缩回弹、弹窗用 spring 曲线。按页面改造时顺手做，是否引入 Framer Motion 到时候再评估。
- 雨痕 `weather` 模式：按城市查天气 API，下雨时才显示；需要确定城市配置和天气源。

## 进度

- [ ] 阶段 1：基础代码与手机统一布局已实现，玻璃水珠已获 iPhone 确认；最新顶部/底部外框、聊天全屏滚动和子页面返回按钮仍待正式部署版 iOS 26.6.2 主屏幕 PWA 最终验收
  - 1a 硬编码收编：dashboard `4d748e0`（61 个 TSX 文件的颜色引用归入语义 Token；`app/cc/persona.ts` 用户可选渐变保留）
  - 1b–1d 主题引擎与外观设置：dashboard `c3d39f9`；Haven `8762d84`
  - 本地验收：dashboard `npm run build` 通过；Haven 状态与外观测试共 47 项通过；dashboard Vitest 352 项通过、1 项跳过，另 2 项因 Windows 无符号链接权限报 `EPERM`（已在正常主机权限下定向复现）
  - 9 月 28 日手机截图：上传背景下雨痕强度 100% 仍几乎不可见；顶部状态栏未延伸背景。dashboard `0b9a9ba` 调整雨痕对比度、PWA 主题回退色和全屏安全区域，待部署与 iPhone 实机复验。气泡半透明仍属阶段 2，不在本次改动内。
  - 9 月 28 日第二轮截图：`0b9a9ba` 的雨痕是斜线，与用户指定的玻璃水珠不符；顶部状态栏与顶栏之间仍割裂，聊天页底部导航下露出米色空白。dashboard `d66a3b6` 改为透明玻璃水珠纹理，强度同时控制水珠数量和可见度；根画布绘制上传背景、顶部安全区域与顶栏使用相近玻璃底色。待部署及同一张背景图的 iPhone 截图复验。不得把这轮反馈扩展成阶段 2 气泡改造。
  - 9 月 28 日第三轮截图（iOS 26.6.2 主屏幕 PWA）：用户确认玻璃水珠符合预期；顶部系统浅色块仍与聊天背景割裂，底部米色区域只在聊天页固定出现。WebKit 已记录 iOS 26 主屏幕 PWA 的 `viewport-fit=cover` 与 `100dvh`/固定元素安全区域问题（https://bugs.webkit.org/show_bug.cgi?id=301994）。dashboard `641bd6c` 把上传背景时的手机聊天顶栏改为浅色到照片的渐变，并在独立模式让根画布和 body 至少绘制到 `100vh`；待部署和同机截图复验。不要再修改雨滴、水珠强度或阶段 2 气泡。
  - 9 月 28 日第四轮截图：iOS 26.6.2 上主页滚动后顶栏消失，主页面状态栏和标题栏视觉割裂，底栏不同页面深浅不一且下方留白过大。dashboard `8f4b1dd` 改为四个主页面固定标题栏、状态栏与标题栏共用高覆盖率玻璃表面、底栏统一表面并从 76px 收紧到 56px（另保留系统安全区域），聊天页高度同步；本地 build 通过。待部署及同机滚动/切页截图复验；玻璃水珠已确认，不改阶段 2 气泡。
  - 9 月 28 日第五轮截图：`8f4b1dd` 的高覆盖率填充使顶部标题栏与底部 5 Tab 呈实色，遮住了背景图；用户明确要求保留第四轮前截图中的透图玻璃效果。dashboard `a908263` 将共用填充恢复为外观设置控制的 `--glass-fill`，并给固定的主页面标题栏补回背景模糊；保留顶栏固定、底栏 56px 和系统安全区域。待部署及同机截图复验。
  - 9 月 28 日第六轮反馈（当前 dashboard `a908263`，文档 `8aa1122`）：聊天页底部 5 Tab 的透图程度仍与其他页面不同，聊天页顶部标题栏仍不透图。用户要求停止在本窗口反复调整透明度，下一窗口从布局层次定位。待验证的代码线索：手机 `.cc-page` 使用 `--color-bg` 背景，且高度扣除了底栏与安全区域；主页/记忆库等页面使用 `min-h-screen` 背景，内容可能延伸到底栏背后；`BottomTabBar` 是全站固定的兄弟层。聊天 `.cc-topbar` 虽使用 `--glass-fill`，但其后方的 `.cc-page` 背景仍可能遮住上传图。这些是待核实的假设，不能直接当作结论继续调颜色。
  - 下一窗口范围：仅 dashboard 移动端的顶部状态栏/聊天标题栏、底部 5 Tab 与背景层的叠放和滚动关系；先确认各页面在相同位置的实际底层，再设计统一的透图方案。保留顶部固定、底栏高度与系统安全区域；不要改玻璃水珠、气泡、阶段 2–5 或 Haven。验收用同一台 iOS 26.6.2 主屏幕 PWA、同一张上传背景图：聊天/主页/记忆库底栏并排比较，聊天顶部可见背景，主页下滑标题栏固定，底栏下不出现额外米色条。需要用户截图确认后才算完成。
  - 9 月 28 日本窗口（待 iPhone 验收）：用户将阶段 1 的手机布局范围扩至全站共同背景与 23 个子页面标题；确认上传图片上使用连续的偏白蒙层，子页面用圆形返回按钮加随正文滚动的大标题，五个主页面保留固定顶栏和现有功能，具体顶栏内容随阶段 2–4 分页设计。已在 dashboard 本地实现：上传图手机背景只在根画布蒙一次，聊天页背景延伸到底栏后方，对话列表移除重复底色，23 个子页面统一返回入口；玻璃水珠、气泡、Haven 未动。`npm run build` 通过。待提交、部署后，用同一台 iOS 26.6.2 主屏幕 PWA 和同一张图比较聊天/主页/记忆库底栏及顶栏，检查子页面下拉、上滑时标题自然滚动、底栏下无额外色条；用户截图确认后才勾选阶段 1。
  - 9 月 28 日后续开发版 PWA 实测：Safari 标签页不足以复刻独立模式，已加 `npm run dev:iphone` 局域网只读预览，使用 HTTPS VPS Haven 入口读取正式数据与已上传背景，拦截写请求；本机 `.env.local` 保存独立预览登录口令，不提交。用户截图指出状态栏/标题栏交界、聊天消息顶部和底部、对话列表顶部和底部均有截断；现将 CC 列表、普通聊天、历史聊天统一为全视口滚动层，标题、输入框和底部 5 Tab 叠在其上，首尾留白按实际栏高测量。子页面共用返回按钮上移、缩为 36px 可见圆形、约 44px 点击范围，换居中 SVG 箭头并提高小按钮玻璃填充；底栏尺寸与玻璃水珠不变。最新 `npm run build` 通过，用户同意先推送。下一窗口先用同一台 iOS 26.6.2、同一张图验收正式主屏幕 PWA：状态栏到标题栏无色带，聊天/列表内容可从顶部和底部自然滚过固定栏，输入框与底栏不遮住最后一条，子页面返回按钮清楚且标题位置合适；通过后勾选阶段 1，再讨论阶段 2 聊天页/对话列表的具体布局并标「✅ 布局已定」后才动手。不要改气泡内容、阶段 3–5 或 Haven。
- [ ] 阶段 1.5：材质统一 + 首批 4 个主题；Dashboard/Haven 已在本地完成主题归一化、材质 Token 推导、`data-background="upload"` 中性玻璃与 tint 蒙层、四主题预览和文档同步。Dashboard build 通过，主题归一化定向测试 2 项通过，Haven 外观测试 3 项通过；Dashboard 全量 353 项通过、1 项跳过，另 2 项因本机 Windows symlink `EPERM` 失败。夜主题按最亮渐变色计算正文 7.66:1、辅助小字 3.29:1。待用户在 iPhone 上验收四主题 × 渐变/上传图，在对话列表、聊天页、记忆库和设置检查材质、选中态与可读性；通过后再勾选本阶段。不改雨滴、气泡形状或页面布局。
  - 9 月 28 日用户反馈渐变几乎看不出来：CC 查到渐变模式下页面根容器仍叠了 56% 底色（`--color-bg`），把渐变冲淡一半；改为全局透明，并把四个主题的晕色往屏幕中部移、浓度提高一档、范围加大，避免被顶栏 / 输入栏 / 底栏盖住。当前渐变值以 `globals.css` 为准，上文表格里的 mesh 是初稿。
- [x] 阶段 2 前置：聊天页拆分。`refactor/cc-split` 分支已将顶栏、消息流与滚动跳转、共用对话列表、输入区、弹窗外壳和格式函数从 `app/cc/page.tsx` 搬出；父页 213 行，状态仍留父页，界面与行为未刻意变更。本地 build 通过；Vitest 359 通过、1 跳过，另 2 项为已有 Windows symlink `EPERM`；待用户按上方路径做 iPhone 与桌面验收后再合并 `main`。 2026-09-28 CC 复核：基于最新 main，build 通过，全量 Vitest 57 文件 / 362 项通过，拆分前后 className 106 个完全一致、onClick 28 / aria-label 18 等计数一致、中文注释 26 行全部保留；合并提交 `1cf5d9b`，用户 iPhone 正式版走查通过。
- [ ] 阶段 2 前置 B：字号分层（规格待写）
- [ ] 阶段 2
- [ ] 阶段 3
- [ ] 阶段 4
- [ ] 阶段 5
