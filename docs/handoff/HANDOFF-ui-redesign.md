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
- **尺寸、圆角、阴影的写死值随页收编**（2026-09-28 定）：颜色已在 1a 清完，字号在「前置 B」清完；剩下的任意值不单独开一轮，**阶段 2–4 改到哪一页，就把那一页的顺手收编掉**，页面改造的验收里要包含这一条。底数（CC 2026-09-28 统计）：`rounded-[…]` 162 处、间距 / 宽高 / 定位类 `p-[Npx]`、`max-w-[Npx]` 等 51 处、`shadow-[…]` 7 处。圆角归到 `--radius-*`，阴影归到 `--shadow-*` / `--glass-shadow`，缺档先补 Token 再用；间距优先用 Tailwind 标准刻度（`p-3`、`gap-2`），只有像 44px 点击区这种有明确理由的值才保留任意值，并在旁边写注释说明。阶段 4 结束时用 `grep -rhoE "\\b(rounded|shadow)(-[a-z]+)?-\\[[^]]+\\]" app --include=*.tsx` 复查，剩下的逐项说明理由。

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

### 阶段 2 前置 B：字号分层（✅ 已定，可开工）

2026-09-28 定。用户希望标题 / 正文 / 小字能分开调大小，而不是只有一个总字号。**本步只让字号可调、把写死的像素收编成档位，页面观感保持不变（允许 ±0.5px 取整），不改布局、不改颜色。**

**现状**（CC 2026-09-28 统计）
- Tailwind 命名字号：`text-xs` 570、`text-sm` 447、`text-base` 13、`text-lg` 19、`text-xl` 23、`text-2xl` 24、`text-3xl` 12、`text-4xl` 3。这版 Tailwind（v4）的每一档背后都是 CSS 变量（`--text-xs` 等），可以在 `:root` 统一改。
- 写死像素的 `text-[Npx]` 436 处：11px 185、10px 135、10.5px 47、9.5px 15、13px 15、11.5px 14、9px 11、12px 4、15px 3、12.5px 3、8.5px 1、18px 1。它们是 px，**连现在的「整体字号」滑条都不跟**（整体字号改的是 `html` 的 font-size，只影响 rem）。
- `globals.css` 里写死的 `font-size`：11px 16、11.5px 11、12.5px 9、10.5px 6、12px 3、9.5 / 13 / 13.5 / 18 / 20px 各 1；另有若干 `em` 相对值（Markdown 标题等）保留不动。

**1. 档位 Token**（`globals.css` 的 `@theme inline` 里新增，全部用 rem，这样也跟着「整体字号」走）

| 档 | 新 / 现有类 | 基准值 | 收编来源 |
|---|---|---|---|
| 小字 | `text-3xs`（新） | 0.5625rem = 9px | 8.5 / 9 / 9.5px |
| 小字 | `text-2xs`（新） | 0.625rem = 10px | 10 / 10.5px |
| 小字 | `text-meta`（新） | 0.6875rem = 11px | 11 / 11.5px |
| 小字 | `text-xs` | 0.75rem = 12px | 12 / 12.5px |
| 正文 | `text-note`（新） | 0.8125rem = 13px | 13 / 13.5px |
| 正文 | `text-sm` | 0.875rem = 14px | |
| 正文 | `text-md`（新） | 0.9375rem = 15px | 15px |
| 正文 | `text-base` | 1rem = 16px | |
| 标题 | `text-lg` 及以上 | 不变 | 18px → `text-lg`，20px → `text-xl` |

新档要带 line-height 变量（`--text-meta--line-height` 等，照 Tailwind 现有档的比例）。

**2. 三个系数**：在 `:root` 覆盖 Tailwind 的字号变量，乘上各档系数：
- `--type-meta-scale` 乘 `3xs / 2xs / meta / xs`
- `--type-body-scale` 乘 `note / sm / md / base`
- `--type-title-scale` 乘 `lg / xl / 2xl / 3xl / 4xl`
- 写法示例：`--text-meta: calc(0.6875rem * var(--type-meta-scale));`。三个系数默认 1，由 `<html style>` 写入（同其他外观滑条）。

**3. 收编**
- `app/` 下所有 `text-[Npx]` 按上表换成档位类，完成后 `grep -rnoE "text-\[[0-9.]+(px|rem)\]" app --include=*.tsx` 为 0。
- `globals.css` 里写死 px 的 `font-size` 按同一张表换成 `var(--text-*)`；`em` 相对值、`inherit` 保留。
- ~~例外：输入框不低于 16px~~（2026-09-29 CC 撤回：`app/layout.tsx` 的 viewport 已设 `maximumScale: 1`，iPhone 聚焦输入框不会自动放大；强加 16px 反而让聊天输入框从 14px 变大。输入框和其他文字一样走档位。）

**4. 外观设置**
- Haven `appearance_config.py`：`font` 增加 `titleScale` / `bodyScale` / `metaScale`，范围 0.85–1.4，默认 1；补测试。同步 Haven `docs/reference.md` 的外观字段说明。
- Dashboard `app/lib/appearance.ts`：类型、默认值、normalize、`appearanceHtmlStyle` 写 `--type-*-scale`；补 `tests/appearance.test.ts`。
- 外观页「字体」区：保留「整体字号」，下面加「标题大小 / 正文大小 / 小字大小」三个滑条，显示百分比。

**5. 文档**：`DESIGN.md` 新增「字号档位」表（上面第 1 条）和规则：**以后不许再写 `text-[Npx]`，只用档位类**；`AGENTS.md`「设计与组件」加一句同样的规则。

**验收**
- 上面的 grep 为 0；`npm run build`、全量 Vitest、Haven 外观测试通过。
- 四个滑条都在 100% 时，页面和改之前几乎看不出区别（最多 0.5px 取整差）。
- 把「小字大小」拉到 130%，时间戳、token 数、标签、Tab 文字一起变大，标题和正文不动；另外两个滑条同理。
- iPhone 上点输入框不会放大页面。
- **推到分支 `feat/type-scale`，不推 main**，等用户验收后由 CC 合并。

### 阶段 2：聊天页 + 对话列表（✅ 布局已定）

2026-09-29 用户和 CC 讨论定案。视觉参考：`docs/design/stage2/bubble-preview.html`（选定第 3 张「中」）和 `docs/design/stage2/list-preview.html`（选定 A「细线列表」），浏览器直接打开即可；两页里的颜色、间距可以直接照抄。分两块，**2a 和 2b 各开一个分支、各自单独验收**：`feat/stage2a-chat`、`feat/stage2b-prompt`，都不推 main。

**通用要求**
- 颜色、圆角、阴影全部走 Token；缺的先加进 `globals.css` 和 `DESIGN.md`。字号只用档位类（见「字号档位」）。
- 改到的文件顺手收编写死的 `rounded-[…]` / `shadow-[…]` / 间距（见「硬约束」最后一条）。
- 不改：消息分段 / 流式逐泡的逻辑、持久化、滚动窗口、「聊天显示」开关的语义、底部 5 Tab（留给阶段 3）。
- 桌面端跟着用新组件，但桌面顶栏保留现有的运行信息行（轮数、Context、缓存），显示在模型行后面。

#### 2a：聊天页 + 对话列表

**1. 顶栏（`CcTopbar.tsx`）**
```
‹  (言) 言之 [CHAT]               [月历]  ···
        Pro · Opus 5.5 · High
```
- 左：返回列表（现有）→ 圆形头像（强调色底、白色衬线首字，点击仍打开协作者列表）→ 衬线名字（协作者名，不再显示窗口名）→ 模式胶囊。
- 模式胶囊：cc 引擎显示 `CHAT` / `WORK`（小号大写、加宽字距）；自建引擎显示 `自建`。`CHAT` = 强调色 16% 底 + 强调色字；`WORK`、`自建` = 中性色底。
- 第二行：`通道 · 模型 · 力度`，小字、淡色，单行不换行、超长截断。
  - 通道：订阅 = `Pro`；API = 供应商在配置里的名字（`shownProvider`），超过 8 个字截断。
  - 模型：新增 `prettyModelName()`（放 `app/cc/upstream.ts`，补测试），把 `claude-opus-5-5` / `claude-opus-5-5[1m]` 变成 `Opus 5.5`、`claude-sonnet-5` 变成 `Sonnet 5`、`claude-haiku-4-5-*` 变成 `Haiku 4.5`；认不出的原样显示。
  - 力度：`EFFORT_OPTIONS` 的英文写法 `Low / Medium / High / XHigh / Max`；自建引擎不显示力度段。
  - 点这一行弹出「模型快切」小面板（`DetailPanel mode="modal"`）：只有「模型」「力度」两组，复用 `CcWindowSettings` 里同一套选项和 setter，改完即生效。开口后不能改的项照现有规则禁用。
- 右：月历图标（新画，细线条 1.6 描边：圆角方框 + 两个吊环 + 横线 + 中间一个实心小点，见预览页 `ico.cal`）→ `···`。
- 去掉顶栏上的：窗口名、选择按钮、cc/自建切换、本窗按钮、协作者设置按钮、手机上的「工作模式」小字。
- 选择模式（多选中）时顶栏照旧换成「取消 / 已选 N 条」。

**2. `···` 菜单**
- 复用现有 `.cc-popmenu` 的弹出菜单（从 `···` 下方弹出的小玻璃卡片，点外面收起），不做底部抽屉。
- 三项：①窗口名（显示当前窗口名 + 铅笔图标，点击改名，沿用现有改名逻辑）；②本窗设置（打开现有 5 个 tab 的面板）；③提示词（打开协作者设置，见 2b）。
- cc / 自建切换挪进「本窗设置」的「本窗」tab，放在「供应商」上面。

**3. 月历**
- 顶栏月历图标打开 `DetailPanel mode="modal"`，替换现有「按日期查看历史消息」弹窗；打开后做的事（`loadHistoryDay` 跳到那一天）不变。
- 月视图：顶部 `‹ 2026 年 9 月 ›`，周一开头，7 列。有消息的日期：强调色小圆底 + 日期下方一个小点；没消息的日期置灰不可点；今天加细圈；选中的日期实心强调色。默认显示当前月。
- 数据：Haven 新增轻量查询 `list_conversation_chat_days(profile_id, session_id)`：`SELECT chat_day, COUNT(*) FROM conversation_turns WHERE profile_id=? AND session_id=? GROUP BY chat_day`，只返回 `[{day, turn_count}]`，不读正文。Dashboard `/api/cc-turns` 加 `?session_id=…&days=1` 分支转发。**不要**复用 `context_days`，那个会把整个窗口的正文读一遍。补 Haven 测试，同步两边 `docs/reference.md`。

**4. 气泡（选定「中」）**
- Token（`globals.css`）：
  - `--chat-user-fill: color-mix(in srgb, var(--theme-accent) 24%, rgb(var(--theme-tint) / .9))`
  - `--chat-assistant-fill: color-mix(in srgb, var(--theme-accent) 6%, rgb(var(--theme-tint) / .9))`
  - 不再跟 `--glass-opacity`（浓度滑条）走；照片模式同样用这两个值（照片模式下 tint 本来就是中性白 / 夜主题深色）。
  - `--chat-bubble-radius: 18px`，用户和助手两边共用。
  - 新增 `--chat-bubble-edge: inset 0 1px 0 rgb(255 255 255 / .6)`（夜主题 `.12`）和 `--chat-bubble-shadow: 0 2px 12px color-mix(in srgb, var(--theme-ink) 7%, transparent)`。
  - 仍然**禁止**给气泡加 `backdrop-filter`。
- 所有助手内容都进气泡：普通段落照旧贴合文字宽度；列表、引用、表格、代码块进**宽气泡**（`width: 100%`，同底色同圆角），结构不拆；代码块在宽气泡里再嵌一块 `color-mix(in srgb, var(--theme-ink) 7%, transparent)` 的代码底。
- 小标题（Markdown 标题、单独一行的粗体短句）与紧跟的下一个块合进同一个气泡，不再单独成泡。
- 同步改 `DESIGN.md`「CC 对话气泡」：删掉「原子块不套气泡、整宽展示」那条，换成上面的规则。

**5. 操作行**
- 两边消息下面都显示时间（`HH:mm`，淡色小字）。助手侧现在没有，补上；主动唤醒的消息同样显示。
- 只用图标，不用文字：复制（两个叠放的圆角方框）、多选（圆圈里一个勾，点它 = `startSelecting(这条消息的 id)`，这条自动勾上）。图标 13px，颜色 `--color-text-tertiary`，整行透明度约 .45。复制成功时图标短暂换成勾，1.2 秒后换回。**不做「重试」**：现有代码没有重新生成回复的能力（只有保存失败时的重试保存），CC 规格初稿误写，2026-09-29 验收时删除；重新生成要动滚动窗口与持久化，另议。
- 现有的上下文详情图标、token 数照旧保留，同样淡化，受「聊天显示」开关控制不变。
- 保存状态：`saved` / `replayed` **不显示任何东西**（删掉绿色双勾）；`saving` 显示一个淡色小圈（跟操作行同色，轻微呼吸）；异常照旧红色感叹号 + 点击重试。
- 以后要加的「收藏」（OB Todo `667b3706e0bb4c62`）不在本次范围。

**6. Thought process**
- 标题统一改英文，黑体，跟操作行同一档小字、淡色：
  - 正在想：`Thinking · 4s`，秒数从这段 thinking 的 `startedAt` 起每秒 +1；文字上加一道淡淡的高光从左扫到右（`background-clip: text` 渐变动画，约 1.8s 一轮）。
  - 想完：`Thought process · 12.3s ›`。一轮有多段时每段都叫 Thought process（去掉「深度思考 / 继续思考」）；没有时长记录的写 `Thought process ›`。
  - `prefers-reduced-motion` 时不扫光，秒数照跳。
- 旧版单块 thinking（`CcMessageRow` 里「Claude 的深度思考」那处）同样改名。
- 工具过程收起时一行 `Tools · N ›`，样式同上。
- 展开 / 收起的默认规则不变：当前生成中的一轮自动展开并流式显示，历史轮默认收起。

**7. 输入栏（`CcComposer.tsx`）**
- 结构不变（`+`、输入框、发送 / 停止）。玻璃药丸加 `--chat-bubble-edge` 同款顶部高光，阴影改用 `--glass-shadow`。
- 提示文字改成「写点什么……」，衬线斜体（`--font-display` + italic），颜色 `--color-text-disabled`。输入的正文仍是黑体。

**8. 对话列表（手机，`CcSessionRail.tsx` 的 mobile 分支；选定 A）**
```
对话                                ( + )
6 WINDOWS

┌ 主窗卡片 ─────────────────────┐
│ (言) 言之 [CHAT]        14:30 │
│      主窗 · 1,286 轮           │
│ 最后一句话，最多两行……         │
└───────────────────────────────┘
RECENT
┌ 一整块薄玻璃 ─────────────────┐
│ • 窗口名 [WORK]      15:15 ··· │
│ ────────────────────────────── │
│ • 窗口名 [CHAT]       昨天 ··· │
└───────────────────────────────┘
MORE
  历史聊天 ›   已删除窗口 ›
```
- 顶部：衬线大标题「对话」+ 下方小号大写宽字距 `N WINDOWS`；右侧圆形强调色 `+` 按钮（新对话），替换现有文字按钮。
- 主窗卡片：`--chat-assistant-fill` 同款底 + 顶部高光 + `--glass-shadow`，圆角 `--radius-2xl`（22px），右上角一团强调色径向光晕（见预览）。内容：头像、协作者名、模式胶囊、`主窗 · N 轮`、最后活跃时间、最后一条消息正文前两行。最后一条正文由前端用现有 `/api/cc-turns?session_id=主窗&limit=1` 取，只对主窗取一次，不给普通行取。没有主窗时保留现有虚线空态。
- 普通窗口：放进同一块圆角薄玻璃（`--glass-fill` + 顶部高光，**不加 blur**），行之间 1px 细线（`--color-border-subtle`）。每行：左侧 7px 小圆点（WORK 用强调色 55%，CHAT 用中性色）、窗口名、模式胶囊、右侧时间、最右一个淡色 `···`。**不显示预览行。**
- 行右侧 `···` 打开现有菜单（置顶为主窗 / 重命名 / 删除），逻辑不变；点击范围不小于 44px。
- 分组标签 `RECENT` / `MORE`：小号大写宽字距淡色。历史聊天、已删除窗口放进 MORE 下面同款薄玻璃，两行细线分隔。
- 数据：Haven `list_conversation_sessions` 的 meta 查询多取 `mode`、`local_engine_preference`，输出里加这两个字段；前端 `CcSessionListItem` 同步加上。胶囊规则同顶栏（`local_engine_preference === 'selfhost'` 显示 `自建`）。补 Haven 测试，同步两边 `docs/reference.md`。

**2a 验收**
- `npm run build`、全量 Vitest、Haven 相关测试通过；`grep -rnoE "text-\[[0-9.]+(px|rem)\]" app --include=*.tsx` 仍为 0。
- iPhone 主屏幕 PWA，四个主题 × 渐变 / 上传照片：两边气泡都看得清、你的气泡一眼能认出；列表 / 代码 / 小标题都在气泡里；操作行只有淡图标 + 时间，保存成功时没有双勾。
- 顶栏：订阅、API 窗口、自建窗口各看一次第二行和胶囊；点第二行能切模型和力度；`···` 三项都能用；月历只点得了有消息的日子，点了跳过去。
- 发一条会触发思考的消息：`Thinking · Ns` 在跳、有扫光；结束后变 `Thought process · N.Ns ›`。
- 对话列表：主窗卡片显示最后一句话；普通行没有预览、有胶囊和 `···`，菜单三项可用。

#### 2b：「提示词」页（协作者设置瘦身，`CcPersonaDialog.tsx`）

- 入口：`···` 菜单的「提示词」；桌面现有入口照旧。
- 弹窗顶部：协作者头像 + 名字（衬线），不再有 tab 栏，改成一页往下滚的分段：
  1. **身份**：名字、头像、你的称呼（小一号）、协作者定位（进提示词「关于我」）。**删掉「印象」**（`description`）的输入框；字段本身和协作者列表里的副标题逻辑暂不动，只是不再能编辑。
  2. **提示词**：基础提示词、提示词模块（现有编辑方式不变）。
  3. **记忆**：只保留「注入 OB 记忆」开关。「记忆条目」「语义检索」的界面删掉，存着的值不动。
  4. **目录**：「能访问哪些目录」「能改哪些目录里的文件」原样放在最后，标注「以后搬去工作台」。阶段 4 再迁。
- 删掉「引擎」tab 的界面。**不要清空协作者存着的 engine 值**：窗口没选过订阅 / API 时服务端靠它兜底。
- 所有字段的保存方式、数据结构不变。
- 验收：build、Vitest 通过；改名字 / 头像 / 定位 / 基础提示词 / 模块 / 记忆开关后保存，刷新仍在；新开窗口的系统提示词和改之前一致（用 Context 分析页对比）。

### 阶段 3：主页 + 记忆库

拆成两块：**3a 主页（✅ 布局已定）**，3b 记忆库（布局待讨论）。

#### 3a：主页「窗」（✅ 布局已定）

2026-09-29 用户和 CC 讨论定案，定稿是预览页 `docs/design/stage3/home-preview.html` 的 **F · 窗**（第一张），浏览器直接打开就行，颜色、间距、字号都可以照着抄。参考图是 Nocturne（见「已定决定」里「一扇窗」那条）。分支 `feat/stage3a-home`，不推 main。

**思路**：上半屏是一扇嵌在厚窗框里的窗，窗外是风景（渐变 / 上传照片，以后下雨）；下半屏是屋里的窗台，放每天会看的东西。层次靠三件事：窗框有厚度（窗是凹进去的）、东西压在窗沿上、窗里窗外分开。试过又否掉的：A 全平铺（太淡）、B 中间一块框（框外的东西像被流放）、D 整页一根细线边框（像屏幕加了个边，不像窗）、E 平铺 + 块（太扁平）。

**从上到下（手机）**
```
☰  TUE · SEP 29                        (言)    ← 窗楣，在窗框上
╭────────────────────────────────────────╮
│            SINCE 04 · 03                │    ← 窗：凹进去，窗外 = 背景
│          小言 & 小羊的家                 │
│              Day 180                    │
│            ── ◆ ──                      │
│         （语录位，先空）                  │
│                       ┌ Clawd ─────────┐│
╰─ 奶糖 ────────────────│ NEXT · 纪念日   │╯    ← 纪念日卡半截压出窗沿
                        │ 半年  4 天后…   │
                        └────────────────┘
┃ DIARY · 日记本                               ← 窗台（屋里），细线分隔
┃ 阶段 2 落地的那个下午 · 9.29
THIS WEEK                          日回顾 ›
一 二 三 四 五 六 日（两种点）
今天新记忆 · 家的底色与一扇窗 等 2 条            ← 很淡的小字
CARE · 照顾                              ›
• 10.1 租房补贴申请
• 还有 2 件待办
[ 底栏 5 Tab ]
```

**1. 窗框与窗楣**
- 主页根容器底色 = 窗框：`rgb(var(--theme-tint) / .9)` 叠在主题渐变上（新 Token `--home-frame-fill`）。上传照片时**照片只出现在窗里**，窗框不透图。
- 窗楣：左边一个细线汉堡图标（1.6 描边，三横，中间那条短），点开抽屉（见 5）；中间日期 `TUE · SEP 29`（`--font-display`、加宽字距，小写转大写）；右边 24px 圆形「言」小头像（强调色底、白色衬线字，取当前默认协作者的名字首字和头像），点击进 `/persona?tab=state`。
- 手机主页不再有现在的 `mobile-page-topbar`「小言&小羊的家」小标题栏；窗楣就是顶栏，保持固定、带安全区域，沿用阶段 1 的固定顶栏规则。
- 删掉桌面端那段「聊天是中心，记忆是底座。这一页先只放入口。」和大号 ☰ 按钮。

**2. 窗**
- 圆角 30px（新 Token `--radius-window`），高度 `clamp(220px, 32svh, 300px)`，背景用当前外观背景（渐变 / 上传图 + tint 蒙层，复用 `AppearanceProvider` 的背景层，不另存一份）。内阴影 `inset 0 3px 14px color-mix(in srgb, var(--theme-ink) 16%, transparent)` + 1px 细边（新 Token `--home-window-inset`）。雨痕开启时雨只落在窗里。
- 窗上居中：`SINCE 04 · 03`（小号大写宽字距）→「小言 & 小羊的家」（衬线，`&` 用 `--font-display` 斜体强调色）→ `Day N`（`--font-display` 斜体强调色）→ 一道小装饰线（两段 1px 横线夹一个旋转 45° 的小方块）→ 语录位。
- 语录位：语录系统（OB Todo `0130e2d3928b47b0`）做出来前**什么都不显示**，只保留位置常量，不画虚线框（预览里的虚线框只是示意）。
- 天数：`Day N`，N = 北京时间今天与 2026-04-03 相差的天数 + 1（4 月 3 日是第 1 天，9 月 29 日是第 180 天）。

**3. 压在窗沿上的东西**
- 纪念日卡：右对齐，宽约 60%，下沿压出窗外约 60px；`--glass-fill` 同色系的实填充（`rgb(var(--theme-tint) / .94)`，**不加 blur**）、顶部高光 `--chat-bubble-edge`、阴影 `--glass-shadow`，圆角 `--radius-2xl`。内容：`NEXT · 纪念日` 小标签 → 名称（衬线）→ 大数字天数（`--font-display`，强调色）+「天后 · 10月3日」→ 细线下两行小字列后面 3 个。当天就是纪念日时大数字换成「今天」。点卡片暂不跳转。
- 奶糖：趴在窗沿左边，身体压住窗的下边线。Clawd：站在纪念日卡上沿。插画没到之前用预览页里的 SVG 剪影，做成独立组件 `HomeSillArt`，以后直接换图。
- 以后窗两侧可以加窗帘插画（对应 Nocturne 的罗马柱），本次不做。

**4. 窗台（屋里）**
三块，从上到下，块之间 1px 细线（`--color-border-subtle`），没有卡片底：
- **日记本**：左边 3px 强调色书脊；`DIARY · 日记本` → 最新一篇标题（衬线）→ `M.D · 作者`。数据：`/api/journal` 列表按 `event_time` 取最新一篇；上锁的日记显示「上锁的一篇」，不露标题。点击进 `/journal`。
- **这一周**：`THIS WEEK` + 右侧 `日回顾 ›`（进 `/impressions`）。周一开头 7 天，日期用 `--font-display`；今天加细圈；未来的日子淡化。每天下面最多两个 4px 小点：强调色 = 那天有日回顾，中性色 = 那天有新存的桶，规则与 `/impressions` 页一致（桶按 `event_time` 落日期，排除旧版 `daily_impression` 桶；把那页的 `isLegacyDailyImpression` / `bucketDate` 抽到 `app/lib/` 共用）。点某天：下方小字换成那天的内容；再点同一天进 `/impressions` 并选中那天（`?date=YYYY-MM-DD`，那页没有这个参数就补上）。
  - 下方一行很淡的小字（比日期还小、`--color-text-tertiary`、无分隔线）：`今天新记忆 · <最新一个桶名>`，多于一个写 `等 N 条`；那天没有新桶就整行不显示。
  - 数据：日回顾 `/api/daily-reviews?persona_id=<默认协作者>&start_date=<周一>&end_date=<周日>`（默认协作者取法同 `/impressions`）；桶用轻量列表 `/api/buckets?limit=200`（不带 `full=1`），前端按日期过滤本周。**不要**为主页拉 `full=1` 全量正文。
- **照顾**：`CARE · 照顾 ›`（进 `/care`）→ 最多两行：最近一条未来的照顾备忘（`M.D 标题`），然后「还有 N 件待办」（未完成 Todo 数）。都没有时显示一行「今天没有要记的事」。颜色比日记本淡一档，不抢眼。数据走现有 `/api/care/reminders`、`/api/care/todos`。

**5. 抽屉「家里的其他房间」（`HomeToolDrawer.tsx` 改造）**
- 标题「家里的其他房间」+ `ROOMS` 小标签；沿用现有抽屉组件与动效，材质换成新玻璃 Token。
- 本次只放：关系轨迹（`/journey`，右侧小字显示当前阶段名，取不到就不显示）、关系图谱（`/graph`）。以后语录、经期、聊天字数统计做出来往这里加；**不放灰色的「以后」占位**。
- 删掉：仪表盘、工具 · MCP、用量统计、API Provider、UI 设置、纪念日这些旧项。

**6. 从主页拿走的入口**
- 删掉 `EntryGrid` 三组卡片。记忆库、聊天、工作台、设置已在底栏；日记、日回顾、照顾、Persona 在主页上有位置；关系轨迹、关系图谱进抽屉。
- **工具 · MCP** 挪到工作台页（`app/workbench/page.tsx`），加一个跟现有风格一致的入口到 `/tools/mcp`。
- 用量统计、API Provider 两个未做的占位直接删。

**7. 纪念日数据（v1 只显示 + 倒数）**
- 新增 `app/lib/anniversaries.ts`（补测试）：一份写死的规则表 + `upcomingAnniversaries(today, count)`，返回按日期排序的下一个及之后几个。规则两类：
  - 固定日子（每年）：4.3 相识周年 · 言之生日；5.2 告白纪念；5.20；6.23 小羊生日（1999 年生，显示「小羊 N 岁生日」）；8.11 奶糖生日（2018 年生，领养来的、日子不一定准，显示「奶糖 N 岁生日」）。
  - 不做每月 3 号的「满 N 个月」（太频繁）；七夕是农历，v1 不放。
  - 自动算：满半年 / 周年（从 2026-04-03 起每 6 个月，如 2026-10-03「半年」、2027-04-03「一周年」，同一天与固定日子合并成一条）；整百天（第 200、300 … 天，第 N 天 = 相识日 + N − 1）。
  - 列表内容用户可能还会增减，改这张表即可；以后要在页面上编辑时再搬到 Haven（届时按持久化规则走）。
- 完成后把 OB Todo `876b8bc1482247f2` 的决定写进背景：v1 只展示与倒数，编辑页与点进去翻当天记忆以后再做。

**8. 桌面端**
- 同一结构居中，最大宽度约 640px，窗高 300px；`SideRail` 不变。

**不改**：底部 5 Tab 本身、其它页面、`/impressions` 除补 `?date=` 以外的逻辑、Haven。

**3a 验收**
- `npm run build`、全量 Vitest 通过（含 `anniversaries` 新测试：9 月 29 日为第 180 天，下一个是 10 月 3 日半年、之后第 200 天 10 月 19 日）；`text-[Npx]` grep 仍为 0。
- iPhone 主屏幕 PWA，四个主题 × 渐变 / 上传照片：照片只在窗里；窗楣固定；纪念日卡不压住语录位；一屏内能看到照顾那块（至少标题）。
- 日记本显示最新一篇；这一周两种点与 `/impressions` 同日一致；点某天小字切换、再点跳到那天；照顾显示最近提醒和待办数。
- 抽屉只剩关系轨迹、关系图谱；工作台能进 MCP。

#### 3b：记忆库

2026-09-29 用户和 CC 讨论。记忆库是用户早期一点点手写出来的（竖线、每天的小圆圈、斜体 `2026·09` 都是），**骨架保留，只换材质和细节**，不推倒重来。

**已定方向**（卡片样式等 CC 预览页定稿后补「✅ 布局已定」）
- **不做「日历」视图**：`/impressions` 已经是月历，按日子翻去那里。
- **删掉「待处理」**：切换器只剩「时间线 / 记忆格」。
- **卡片降噪**：不显示 score（后端 score / 权重 / 排序逻辑一律不动，衰减相关都不碰）；重要度保留，收成一个淡色小标记；标签最多露 2 个；标题和正文前两行是主角。记忆格的默认排序改为按时间，「权重」选项先留着。
- **搜索 / 筛选**：不再挤在一块实心白框里，搜索框单独一条薄玻璃，筛选胶囊直接排在底色上。
- **卡片日期对不上**：「奶糖的生日」在 29 日分组里，卡片右下角却显示 2026/09/30，查清卡片取的是哪个字段 / 时区，与分组一致。
- **新增 1 · 月份章节名**：时间线每个月的标题 `2026·09` 后接那个月的名字，例如 `2026·09 日常 · 33 条`。数据来自钉选桶「2026年关系时间线」（`2fbeb41b66c0`），正文每行格式 `N月·名字：一句话`；以后每年一个同名桶 `YYYY年关系时间线`，按桶名匹配年份。每月月底用户和言之一起给这个月起名并写进该桶。取不到就只显示原来的年月。
- **新增 2 · 一个月前的今天**：时间线顶部一小条，显示一个月前同日（以后满一年改为「去年的今天」）的一条记忆（有多条取重要度最高的），点开进详情。那天没有就整条不显示。
- **新增 3 · 年轮标记**：卡片上显示年轮数（`comment_count`，`/api/buckets` 列表已返回），如 `◎ 3`，0 不显示。
- 不做：随手抽一张。

**3b 布局（✅ 布局已定，等前置拆分合并后开工）**

2026-09-29 定稿：`docs/design/stage3/memory-preview.html` 的 **D · 玻璃卡 · 无竖线**（第二张）。比过又否掉的：原来的竖线 + 小圆圈（A，保留作对照）、书脊卡（C / E：书脊和竖线重复；书脊按重要度深浅不一，一排看着乱）。用户喜欢圆角玻璃卡「圆圆饱满」的感觉。分支从合并后的 main 开 `feat/stage3b-memory`，不推 main。

1. **顶栏**：衬线「记忆库」+ 右侧两格切换（时间线 / 记忆格），切换器是一条薄玻璃药丸，选中格是更实的 tint + 小阴影。手机固定顶栏规则不变。
2. **搜索与筛选**：搜索框单独一条 40px 高的薄玻璃药丸（`--glass-fill` + 顶部高光，**不加 blur**），不再有外面那块白色大框。下面快捷筛选胶囊直接排在底色上（未选 = `color-mix(ink 6%)` 底；选中 = 强调色底白字），横向滚动；「全部时间」下拉并进这一行末尾。热门标签行保留，改成无底色的淡色文字，横向滚动。记忆格的排序见 7。
3. **一个月前的今天**（仅时间线）：搜索下面一条 `color-mix(accent 9%, tint .72)` 的圆角条：左边圆形强调色浅底里写日期（`8.29`，`--font-display` 斜体），右边 `一个月前的今天` 小标签 + 桶名（衬线）+ 正文前两行。取法：今天往前推一个月的同一天（那个月没有这一天就不显示），按 `bucketDate` 过滤，有多条取重要度最高的一条；满一年后优先「去年的今天」，没有再退回一个月前。点开用现有详情抽屉。没有就整条不显示。
4. **月份章节**：`2026·09`（`--font-display` 斜体，强调色）+ 章节名（衬线，加宽字距）+ 右侧 `N 条`；下一行淡色小字是那一句。数据：桶名匹配 `^(\d{4})年关系时间线$` 的钉选桶，正文逐行匹配 `^(\d{1,2})月·([^：:]+)[：:](.*)$`。取不到就只显示年月和条数。
5. **日期分组**：**去掉竖线和小圆圈**。每天一行：大号日期数字（`--font-display` 斜体，强调色，`--text-2xl` 档）+ `SEP · 周二`（小号大写宽字距）+ 往右延伸到头的 1px 细线（`--color-border-subtle`）+ `N 条`。
6. **卡片**（时间线和记忆格共用一个组件）：`--glass-fill` 同系实填充（`rgb(var(--theme-tint) / .76)`，**不加 blur**）+ 顶部高光 + 很轻的阴影，圆角 `--radius-xl`，无边框；卡片之间 9px。内容：标题（衬线）→ 正文前两行（淡一档）→ 底行：最多 2 个标签（纯文字，`·` 分隔）、右侧年轮 `◎ N`（强调色，0 不显示，数据 `comment_count`）+ 重要度五个 3px 小圆点（亮的个数 = `round(importance / 2)`，整体很淡）。**不显示 score**。钉选的桶在标题前加一个小 ★。
7. **记忆格**（定稿 `docs/design/stage3/memory-grid-preview.html` 第一张「格 · 两列小方格」）：
   - 只按种类分组：★ 钉选 / feel / 重要 / 其他（与现在的分组规则一致），已解决 / 已消化 / 已归档不单独成组，收在最底下一行三个小胶囊。组标题衬线 + 右侧 `N 条`（**不带箭头**）。
   - 两列小方格（`--radius-xl`，材质同 6）：标题**固定占两行高度**（短标题下面留空，长标题两行截断），正文最多两行，底行（重要度小点 · 年轮 · `M.D` 日期）用 `margin-top: auto` 钉在格子底部；同一排两格等高，正文起点对齐。
   - 「全部」下每组先露 4 格，组底下一行「只看 X · 全部 N 条 ›」= 选中顶部对应的快捷筛选胶囊并滚回顶部，只显示这一组全部格子；**不在原地展开**。底部三个小胶囊同理。没有快捷筛选对应的组（如「其他」）用现有 `other` 筛选。
   - 排序：筛选下面右对齐一个两格开关「最新 / 最重要」，默认最新；最重要 = 重要度降序、同分按时间新到旧；「全部」下每组露的 4 格跟着排序变。**删掉** score「权重」排序、升 / 降序切换、列表 / 格子切换（`gridViewMode`）和「分类」筛选行（分类只能在已删除的待处理里指定）。
8. **卡片日期**：与分组一致用 `bucketDate`（`app/lib/dailyBucketDate.ts`），修掉「29 日分组里显示 09/30」。
9. 不改：详情抽屉、新建按钮（`+`）、筛选逻辑、后端的 score / 权重 / 排序算法。

**3b 验收**
- build、全量 Vitest 通过（章节名解析、一个月前的今天取法补单测）；`text-[Npx]` 为 0。
- iPhone PWA 四主题 × 渐变 / 照片：卡片可读；时间线顶上有一个月前的今天（8.29 那条「记土壤不记花」这类）；9 月标题显示「日常」和那句话；有年轮的卡片显示 `◎ N`；卡片日期与分组一致；记忆格默认按时间排。

**3b 前置：记忆库拆分 + 删「待处理」（✅ 可开工，不改界面）**
- 分支 `feat/stage3b-split`，不推 main。参照阶段 2 前置聊天页拆分的做法：`app/memory/page.tsx`（1420 行）拆成页面外壳 + 若干组件与纯函数，状态仍留在父页。建议边界：筛选纯函数与分组（`matchesQuickFilter` / `matchesDateFilter` / `groupByDate` / `groupByMonth` / `getTopTags` 等）→ `app/memory/memoryFilters.ts` 并补测试；搜索与筛选区、时间线、记忆格、卡片各一个组件。
- 删除：`ReviewSection`、`PendingSection`、`AutoMemoryQueue.tsx`，`MemoryViewSwitch` 去掉 `review` 一格，`HomeClient.tsx` 等处 `tab=review` 的类型与分支一并清掉（`?tab=review` 旧链接落回时间线）。**不删** Haven 与 dashboard 的 `/api/daily-chat-memory` 路由：每日自动记忆目前被 `legacy_daily_memory_paused` 关着；在 `TECH_DEBT.md` 开一张卡记录「确认界面已删，若重新开启 review 模式，确认入口放到 OB Todo `ccd4751631644fd9` 的日视图」。
- 除删掉「待处理」外，界面和行为不变：拆分前后 className、onClick、aria-label 计数对齐（删掉部分除外），中文注释全部保留。
- 验收：`npm run build`、全量 Vitest 通过；`text-[Npx]` 为 0；时间线 / 记忆格的搜索、快捷筛选、标签、日期、排序、详情抽屉、新建按钮手机走查与拆分前一致。

### 阶段 4 前置：提示词页 + 注入记忆按窗口（✅ 布局已定）

2026-09-29 用户和 CC 讨论定案，对应 OB Todo `156e4589e0bf40ec`。预览 `docs/design/stage4/prompt-page-preview.html`（左：主页面，右：编辑页）。分支 `feat/prompt-page`（dashboard）+ `feat/window-recall`（Haven），都不推 main。

**起因**：提示词弹窗挂在 `/cc` 里，从主页抽屉「言」卡片进去要先加载整个聊天页（几秒）；基础提示词和模块在弹窗里是 14 行的小框，几千字没法改。注入记忆本该按窗口：工作窗口一般不需要召回。

**A. 页面与路由**
- 新页面 `/collaborators/[id]`（`/prompts` 已被 Haven 内部提示词「权重配置」占用，`/persona` 是 Persona 状态）。新建协作者 `/collaborators/new`。编辑子页：`/collaborators/[id]/base`（基础提示词）、`/collaborators/[id]/modules/[moduleId]`（单个模块）。子页用 `SubpageBackButton`，iOS 右滑返回自然生效。
- 数据用现有 `/api/cc-personas` 读写（整对象保存，结构不变），可复用 `app/cc/usePersonas.ts`；不要为这页加载聊天页的任何东西。
- 入口改：主页抽屉「言」卡片 → `/collaborators/<当前协作者 id>`；聊天页协作者列表的「新建」→ `/collaborators/new`。删掉 `CcPersonaDialog.tsx`、`CcChatOverlays` 里的 `settingsFor` 分支和 `/cc?prompt=1` 的处理（`app/cc/page.tsx`），确认无引用。

**B. 主页面（只看）**
1. 顶部：返回按钮；居中 76px 圆形头像（强调色底 + 白色衬线首字，带阴影）→ 衬线名字（加宽字距）→ 一行淡色定位（最多两行）。
2. `IDENTITY · 身份`：一块薄玻璃分组（`--glass-fill` 同系实填充 + 顶部高光，不加 blur，行间细线），四行：名字 / 头像（字 + 颜色圆点）/ 称呼你 / 定位。点一行弹 `DetailPanel mode="modal"` 小框改，框内「保存」直接保存整个协作者。
3. `PROMPT · 基础提示词`：同款玻璃块，露前 5 行；底行左边 `N 字 · 约 X token`，右边 `编辑 ›` → `/base`。
4. `MODULES · 提示词模块` + 右侧 `＋ 新增`（新建一个「未命名模块」并直接进它的编辑页）：同款分组，一行一个：左 `⋮⋮` 拖动把手 → 模块名（衬线）+ `N 字 · 约 X token` → 右侧开关（= 新窗口默认开启，拨动即保存）。点行进 `/modules/[moduleId]`。
   - **拖动排序**：按住 `⋮⋮` 拖，松手即保存新顺序；用 pointer events 自己实现，**不引入新依赖**；拖动时这一行轻微抬起（阴影 + 放大 1.02），其它行让位；`prefers-reduced-motion` 下不做动画。删掉现在的上下箭头。
   - 下方一行淡色说明：「开关 = 新窗口默认带上这个模块。按住左边 ⋮⋮ 拖动排序。」
5. `DIRECTORIES · 目录`：收成一行「能访问 N 个 · 能修改 N 个 · 以后搬去工作台 ›」，点开展开现有两个目录编辑区（逻辑原样搬），阶段 4 再迁。
6. 页面最底：协作者多于一个时显示「删除这个协作者」（危险色，二次确认），沿用现有删除逻辑。
7. **没有「注入 OB 记忆」**（挪到本窗设置，见 D）。「印象」「记忆条目」「语义检索」「引擎」照 2b 继续隐藏，存着的值随保存原样透传。

**C. 编辑页（全屏改）**
- 顶栏：返回 + 右上角「保存」（没改动时灰色不可点）。标题（模块名 / 「基础提示词」，衬线）→ 小字 `N 字 · 约 X token`，**随输入实时更新**。
- 正文一个撑满剩余高度的 textarea（等宽字体，玻璃块底），iOS 键盘弹起时不被遮挡。模块页的标题可点击改名。
- 模块页底部：「新窗口默认开启」开关 + 「删除模块」（确认后删并返回）。
- 有未保存改动时点返回：`confirm` 问一句「放弃这次修改？」。
- 字数 = 字符数；token 用现有 `estimateTextTokens`（`app/lib/recallDisplay.ts`），显示为 `约 1.5k token` / `约 520 token`。

**D. 注入记忆按窗口**
- **Haven**（先合）：`conversation_sessions` 新增列 `recall_mode TEXT NOT NULL DEFAULT ''`（`''` = 按模式默认，`'on'` / `'off'` = 这个窗口手动指定），照 `daily_review_enabled` 的方式做迁移、加进 `patch_conversation_session_state` 的 `allowed`、在 session 返回里带出。**不要**塞进 `cc_overrides`：`gateway_state.py` 追加 turn 时会把 `cc_overrides` 重建成只有 `active_cred / subscription / api` 的对象，别的键会被抹掉。补测试，同步 Haven `docs/reference.md`「cc 持久化（Haven 侧）」。
- **dashboard 生效顺序**（cc 与自建两个引擎一致）：请求体显式 `recall` → 窗口 `recall_mode`（on / off）→ 按模式默认（**CHAT 开，WORK 关**）。协作者的 `recall_on` 不再参与判断，但值保留不清空。改 `app/api/cc-chat/route.ts` 的 `setRecallPrefs` 与 `app/lib/selfhost/runSelfhostTurn.ts` 的判断；前端现在若有从协作者读 `recall_on` 发给请求体的地方一并去掉。
- **本窗设置**：「本窗」tab 加一行「注入 OB 记忆」三态：`跟随模式（现在：开 / 关）` / `开` / `关`，写 `recall_mode`；改完下一轮生效。同步 dashboard `docs/reference.md`「cc 数据持久化契约」。

**验收**
- build、全量 Vitest、Haven 测试通过；`text-[Npx]` 为 0；`CcPersonaDialog` 无引用。
- 手机：抽屉「言」卡片秒开页面；改名字 / 头像 / 称呼 / 定位、改基础提示词、改模块内容、改名、开关、拖动排序、新增、删除，刷新后都在；新开窗口的系统提示词与改之前一致（Context 分析页对比）。
- 新开 CHAT 窗口有召回按钮、WORK 窗口没有；本窗设置改成「开 / 关」后下一轮跟着变；刷新后仍在。

### 阶段 4a：设置页（✅ 已上线）

2026-09-30 用户和 CC 定案。分支 `feat/settings-page`（dashboard），不推 main。只改 `app/settings/page.tsx`（及必要的共享常量），各子页面本身不动。

**删掉的入口**（别处已有，页面和路由保留）：模拟 Breath（工作台有）、关系图谱（主页抽屉有）、Persona State（点主页头像进）。

**布局**：去掉 `EntryGrid` 卡片网格，改成和提示词页同款的薄玻璃分组列表（复用 `.prompt-group` / `.prompt-row`，分组标题同 `CollaboratorPage` 的 `Section` 样式：小号大写加宽字距）。每行：左边名字（`text-note`）+ 下面一行淡色小字说明（`text-2xs` tertiary），右边 `›`。整行可点，最小高度 52px。手机固定顶栏保持现状（`mobile-page-topbar`，标题「设置」，字体照记忆库顶栏用 `--font-display`）；桌面去掉那段「标待做」的旧说明文字，标题下不再放副标题。宽度 `max-w-2xl`。

分组与顺序（名字 → 说明 → 链接）：
1. `常用`
   - 外观 → 主题、背景、字体与字号 → `/settings/appearance`。**右侧在 `›` 前显示当前状态**：`杏雾 · 渐变` / `樱粉 · 照片`，取自 `useAppearance()` 的 `appearance.theme` 和 `appearance.background.kind`（`upload` 显示「照片」，其余「渐变」）。主题中文名目前写在 `app/settings/appearance/page.tsx` 的 `themes` 常量里，挪到共享文件两处共用，别复制一份。
   - 通知 → Bark 推送与发送状态 → `/settings/notifications`
   - 模型与中转站 → 新对话的默认模型、力度和中转站 → `/settings/upstream`
2. `记忆与引擎`
   - 记忆浮现 → 注入节奏、上下文预算、召回策略 → `/settings/recall`
   - 记忆处理 → 打标、向量、重排序 → `/settings/memory-processing`
   - 自动化 → Persona、夜梦、关系整理、每日画像 → `/settings/automation`
   - 记忆用的模型 → 召回、自动记忆与日回顾用哪个模型 → `/settings/models`
   - 权重配置 → Prompt 与评分权重 → `/prompts`（放本组最后）
3. `数据`
   - 导入 → 拖拽或粘贴，试跑后入库 → `/import`
   - 回收站 → 恢复或彻底删除 → `/trash`
4. 最底：「退出登录」单独一行居中，危险色文字，无边框按钮；仍是 `POST /api/auth/logout` 表单，点之前 `confirm('退出后这台设备要重新输入口令，确定？')`。

**不做**：顶部状态卡（额度已在本窗设置「会话信息」里）；其余行不显示状态（每行要多请求一次接口，设置页会变慢）。

**收尾**：`EntryGrid` 若只剩工作台在用就留着；子页面标题若与新名字不一致（如「上游模型配置」「召回、自动记忆与日回顾模型」），把子页面的大标题改成新名字，只改标题文字。同步 `docs/reference.md`「文件结构速查」里设置相关的描述。

**验收**：build、全量 Vitest 通过，`text-[Npx]` 为 0；手机四主题 × 渐变 / 照片下分组清楚、字能看清；外观行的状态随切换主题即时变化；12 个入口都能点进对应页面；退出登录有确认。

2026-09-30：已在 `feat/settings-page` 实现明确列出的 10 个入口、外观状态、退出确认及标题对齐，build 通过，`text-[Npx]` 为 0。全量 Vitest 为 386 通过、2 项因当前 Windows 环境拒绝创建符号链接而失败、1 跳过；手机主题 / 背景组合及入口点击仍待实机验收。上文「12 个入口」与逐项清单的 10 个不一致，以逐项清单为实现范围。

### 阶段 4b：工作台（✅ 布局已定）

2026-09-30 用户和 CC 定案。预览 `docs/design/stage4/workbench-preview.html`（四张：首页 / 文件夹 / 预览 / 放进来），颜色、间距照抄。分支 `feat/stage4b-workbench`（dashboard），不推 main。Haven 不动。

**起因**：用户几乎没用过现在的四格（待批准在聊天里就能点）；真正缺的是「一个能看到 VPS 上文件的渠道」，最常翻的是 yanzhi's files。窗口选择不做：用户一次只开一个工作窗口，照旧跟着 `ACTIVE_SESSION_KEY`。

**A. 首页 `/workbench`**（去掉「工作台 / 调参」两个 tab，改成一页往下滚）
- 顶栏同设置页：手机 `mobile-page-topbar`，标题「工作台」用 `--font-display`；桌面一个 h1，不放副标题。宽度 `max-w-2xl`。
- 分组与行复用设置页的 `.prompt-group` / `.prompt-row` 和 `Section` 分组标题。每行左边加一个 30px 圆角小图标块（细线 SVG，1.6 描边；「言之的文件」用强调色 14% 底 + 强调色图标，其余用中性色底），中间名字 + 一行淡色说明，右边 `›`，最小高度 52px。图标抽一个小组件放 `app/workbench/`，别散写在各行。
1. `WORKS · 作品`，右侧「全部 ›」→ `/workbench/files/yanzhi/artifacts`。下面一排横滑小卡（宽约 132px，最多 8 个，数据用现有 `/api/artifacts`，按修改时间），卡上半是封面：用 `--theme-mesh` 并按序号错开 `background-position`，右下角衬线斜体写英文 / 文件名；下半是标题（衬线）+ 日期。点卡 → 现有 `/artifacts/[name]` 播放器。没有作品时这一组不显示。横滑容器不加 blur。
2. `FILES · 文件`：四行 → 言之的文件（`/workbench/files/yanzhi`，说明「作品、你放进来的东西」，右侧显示顶层项数）、dashboard、haven、言之的笔记（后三个说明带「只读」）。下面另起一块同款分组，一行「目录权限 · 能访问 N 个 · 能修改 N 个」→ `/workbench/dirs`。
3. `ENGINE · 引擎`：六行 → 工具 · MCP（`/tools/mcp`）、模拟 Breath（`/breath-sim`）、召回透镜（`/recall-lens`）、聊天切片（`/conversation-slices`）、上下文审计（新子页 `/workbench/context`，里面放现有 `ContextAuditPanel`）、当前工作窗口（新子页 `/workbench/session`，里面放现有 `CcWorkbenchPanel`，说明「待批准、改过的文件、回退点、命令输出」）。两个新子页只加 `SubpageBackButton` + 大标题，面板本身不改。
- 删掉 `EntryGrid` 在本页的使用；若 `EntryGrid` 因此无人引用，删掉组件并确认无引用。

**B. 文件浏览**
- **根**（只在服务端映射，前端只传 key）：
  | key | 显示名 | 实际路径 | 权限 |
  |---|---|---|---|
  | `yanzhi` | 言之的文件 | `YANZHI_FILES_ROOT`（`/data/cc-chat-files`） | 看、下载、放进来、删文件 |
  | `dashboard` | dashboard | `/workspace/dashboard` | 看、下载 |
  | `haven` | haven | `/workspace/haven` | 看、下载 |
  | `notes` | 言之的笔记 | `/home/cc/.claude/projects/*/memory` | 看、下载 |
  - `notes` 根下列出每个**非空**的 `projects/<项目>/memory` 作为一个文件夹，显示名去掉 `-workspace-` 前缀（`-workspace-dashboard` → `dashboard`）；**`/home/cc/.claude` 下别的东西一律不可见**（那里有 `.credentials.json`、会话存档）。
  - 路径不存在的根（本机开发时）在首页那一行显示「这台机器上没有」且不可点，不报错。
- **API** `app/api/files/route.ts`（`runtime = 'nodejs'`）：
  - `GET ?root=&path=`：`path` 是相对路径。先 `realpath`，必须仍在根内（照 `app/lib/ccDirs.ts` 的 `isInside` 做，挡住 `..` 和软链接逃逸）。目录返回 `{ kind: 'dir', entries: [{ name, kind, size, mtime, count? }] }`，文件夹在前、其余按修改时间倒序；文件返回 `{ kind: 'file', name, size, mtime, mime, text?, truncated }`，文本只给前 256 KB。
  - `GET ?root=&path=&raw=1`：原样返回文件，带正确 `Content-Type`（图片、PDF 预览用）；加 `&download=1` 时带 `Content-Disposition: attachment`（文件名用 RFC 5987 编码，中文名不乱码）。
  - `POST`（multipart）：只允许 `root=yanzhi`，目标目录必须已在根内；单个文件不超过 10 MB，一次可多个；文件名只取 basename，去掉开头的点和路径字符；同名自动改成 `名字 (2).扩展名`，**永不覆盖**。在 yanzhi 根目录上传时放进 `小羊给的/`（不存在就建），在任何子文件夹里上传就放进当前文件夹。
  - `DELETE ?root=yanzhi&path=`：只删文件，不删文件夹；别的根一律 403。
  - **拦截规则**（列表隐藏 + 读 / 下载拒绝，所有根都适用）：任何一段以 `.` 开头（`.env*`、`.git`、`.git-credentials`、`.next` 等全在内）、`node_modules`，以及文件名匹配 `*.pem`、`*.key`、`*credential*`、`*secret*`。写一个纯函数放 `app/lib/fileBrowser.ts` 并补 Vitest（`..`、软链接、各拦截名、notes 根外路径、上传改名）。
- **页面** `/workbench/files/[root]/[[...path]]`：一个页面按 API 返回的 `kind` 显示文件夹或预览。顶上 `SubpageBackButton`，iOS 右滑回上一层；下面一行淡色路径（`言之的文件 / 小羊给的 /`），衬线大标题（当前文件夹名 / 文件名），小字 `3 个文件夹 · 8 个文件` 或 `2 KB · 今天 14:20`。
  - **文件夹**：两块同款分组，文件夹一块、文件一块（没有就不显示那块）。每行图标按类型（文件夹 / 文本 / 代码 / 网页 / 其他），名字 + `大小 · 日期`（文件夹写 `N 项`），右边 `›`。只在 `yanzhi` 根里，右上角一个强调色药丸「＋ 放进来」。空文件夹显示一句淡色「这里还是空的」。
  - **放进来**：底部弹出（`DetailPanel` 或同款底部抽屉，包 `BodyPortal`），标题「放进来」+ 小字「放到：言之的文件 / 小羊给的」；一块虚线框「选文件」（`<input type="file" multiple>`，不限 `accept`，iOS 会给照片 / 拍照 / 文件三个来源）；选完逐个显示进度条，完成显示「已放好」，失败显示原因；底部淡色说明：「文本文件（md、txt、csv、json、代码）闲聊里的言之能直接搜、按段读。图片和 PDF 现在只有工作窗口的言之能看。同名文件会自动加个 (2)，不会覆盖。」全部完成后刷新列表。
  - **预览**：右上角两个圆形玻璃按钮：下载、`···`。`···` 菜单：复制路径（复制服务器上的绝对路径，方便贴给工作窗口）；`yanzhi` 根里再加「删除」（危险色，`confirm` 后删并返回上一层）。
    - `.md`：默认渲染，顶部「预览 / 原文」小分段切换；渲染复用聊天里现有的 Markdown 组件（不另引依赖）。
    - 其余文本（代码、csv、json、txt、html 源码等）：等宽字体 + 行号，横向可滚，不自动换行。
    - 图片：`<img>` 直接显示（`raw=1`）。PDF：`<iframe>` 或新开 `raw=1`，交给系统预览。
    - `yanzhi/artifacts/` 下的 html / svg：多一个强调色「打开」按钮 → `/artifacts/[name]`。
    - 超过 256 KB 的文本只显示前面一段，底部提示「只显示了前面一段，完整的下载看」；二进制显示「这个类型看不了，可以下载」。
    - 文本区用玻璃块底（同提示词编辑页 `.ed` 的做法），**不加 blur**。

**C. 目录权限搬家**
- 新子页 `/workbench/dirs`：把 `app/collaborators/CollaboratorPage.tsx` 里「能访问的目录 / 能修改的目录」两个编辑区（`saveDirs` / `removeDir` 那段）原样搬过来，数据仍走 `/api/cc-personas` 整对象保存。编辑的是**当前协作者**，取法和主页抽屉「言」卡片同一来源；标题下小字写「言之 的目录」，协作者多于一个时旁边给一个下拉切换。
- `CollaboratorPage` 删掉 `DIRECTORIES · 目录` 整段及只为它存在的状态。

**D. 同批顺带：切页停顿**（OB Todo `e8b1b139967b482d`，单独一个 commit）
- 加 app 级 `loading.tsx`，切页时立刻有反馈（淡色，和现有切页淡入一致，不做转圈大图）。
- 查 `Link` 预取在 `proxy.ts` 登录校验下是否真的生效（生产 build 下看 Network 里的 prefetch 请求是 200 还是被重定向）；没生效就在 `proxy.ts` 放行预取请求所需的头，且不能绕过登录。结论写进最终回复。

**不做**：窗口选择；在手机上编辑文件；删除 / 新建文件夹；给闲聊工具加读图片 / PDF（OB Todo `dd33744ef2c947ec`）。

**文档同步**：`docs/reference.md`「文件结构速查」加新页面和 `app/api/files`（写明根映射与拦截规则）；「cc 数据持久化契约」里补一句：上传写入 `YANZHI_FILES_ROOT`（宿主机挂载卷，持久），不写别处。

**验收**
- build、全量 Vitest 通过；`text-[Npx]` 为 0；新子页都有引用，`EntryGrid` 若删则无引用。
- 手机：首页三组清楚、作品能横滑并打开；四个根都能一层层点进去再右滑回来；dashboard 根下看不到 `.env`、`.git`、`node_modules`，直接改 URL 访问 `.env` 返回 403；notes 根下只看得到 memory 文件。
- 在言之的文件根上传一个 md 和一张图 → 出现在「小羊给的」；再传一次同名 → 变成 `(2)`；md 能渲染 / 切原文，图片能看，下载后手机能打开；删除有确认。仓库里没有「放进来」和「删除」。
- 目录权限在工作台改完刷新仍在，新开工作窗口能按新目录读写；提示词页没有目录段了。
- 四主题 × 渐变 / 照片各看一眼首页和预览页。

### 阶段 4：其余页面统一

- 日记、关系轨迹、日回顾、Persona、照顾备忘、设置各子页，逐页对齐新组件和间距（= 阶段 4c）。
- 设置分层：日常用的和调参用的分开，调参类收进「高级」。

### 阶段 5：扩展

- 更多主题：樱粉、雾蓝、深色「夜」。前提是阶段 1a 的硬编码收编已完成（旧文档里那约 30 处低频硬编码也包含在 1a 里）。
- 动效：页面切换淡入 / 滑入、列表卡片交错淡入、按钮按下微缩回弹、弹窗用 spring 曲线。2026-09-29 先做了简易版：全站按下微缩 + 切页淡入（见 `DESIGN.md`「动效」）；滑入、交错、spring 仍待做。按页面改造时顺手做，是否引入 Framer Motion 到时候再评估。
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
- [x] 阶段 2 前置 B：字号分层。2026-09-29 合并：Haven `7d5a0aa`（CI + deploy-haven 通过），dashboard `3bba576`（rebase 到远端 `ba678d2` 后 build 通过、Vitest 57 文件 / 363 项通过、`text-[Npx]` grep 为 0）。手机输入框 16px 下限已删（viewport 禁止缩放，`3bba576`）。用户 iPhone 验收：滑条可调，关掉重开后保留。。Dashboard `feat/type-scale` 分支代码提交 `b552f8a`；Haven `feat/type-scale` 分支提交 `7d5a0aa`。标题 / 正文 / 小字独立缩放、外观设置滑条及跨设备配置已实现；`app/` 的 436 处固定像素字号类与 `globals.css` 的 50 处固定 px 字号均按档位收编，手机输入控件保持至少 16px。Dashboard build 通过；Vitest 360 通过、1 跳过，另 2 项仍因本机 Windows symlink `EPERM` 失败；Haven 外观测试 4 项通过。待用户在 iPhone 验收四滑条的独立效果、默认字号观感与输入框聚焦，再由 CC 合并到 `main`。 2026-09-29 CC 复核：`text-[Npx]` 与 globals.css 写死 px 均为 0，各档数量与对照表一致；CC 在分支上撤掉手机输入框 16px 下限（viewport 已 `maximumScale: 1`），build 通过、Vitest 363 项通过。**合并顺序：先合 Haven `feat/type-scale` 到 main 并等 CI 部署完，再合 dashboard**，否则三个新滑条保存后会被旧 Haven 丢掉。
- [ ] 阶段 2a：聊天页 + 对话列表。Codex 实现 dashboard `a8a67cb` / Haven `c2c9204`；CC 验收修复 `8c2584c`（删假重试、作品卡不随 Tools 折叠、粗体小标题与列表合泡 v3、模型名日期后缀、自建第二行）；用户手机走查后 CC 继续修 `c206284` / `e1004db` / `e242c99` / `08cd94d`（Thought process 与 Tools 无底色对齐、输入栏 22px、返回键与 ··· 图标、模型下拉、附件草稿、列表横滑、长按不再进入多选、选择模式不跳位、月历缓存）。2026-09-29 已合并 main 并部署，用户正式版走查中；四主题 × 照片背景的气泡观感待确认后勾选。
- [x] 阶段 2b：「提示词」页瘦身。Codex `0e40df6`：单页四段（身份 / 提示词 / 记忆 / 目录），隐藏印象、记忆条目、语义检索与引擎界面，原值随保存透传；CC 验收无改动，2026-09-29 合并 main。
- [ ] 阶段 3a：主页「窗」。2026-09-29 布局已定（预览 `docs/design/stage3/home-preview.html` F）。`feat/stage3a-home` 已本地实现窗楣、窗洞、纪念日、日记/周视图/照顾、两项房间抽屉和工作台 MCP 入口；build 通过，Vitest 374 通过、1 跳过、2 项因 Windows symlink `EPERM` 失败。待 iPhone 主屏幕 PWA 按上方「3a 验收」实机核对四主题 × 渐变/照片、首屏照顾标题和交互，。CC 验收（`6b42ec3`）：纪念日同日合并不再重复「周年」、半年/周年用中文数字；窗沿剪影的颜色改走 style（Safari 下 SVG 属性里的 CSS 变量不可靠）；纪念日大数字接 `--text-hero` 跟标题系数缩放。CC 环境 build 通过、Vitest 60 文件 / 377 项全过。同分支顺带做完 OB Todo `87ba2e16bde74652`（用户 9 月 29 日提）：助手消息去掉头像和名字（名字行只在有召回时显示召回按钮）；对话列表普通行补回「N 轮 · 时间」；聊天顶栏 `···` 不再弹菜单、直接打开本窗设置；窗口名只读放进本窗设置「会话信息」首行（改名仍在对话列表）；提示词入口挪到主页抽屉顶部「言」卡片（`/cc?prompt=1` 打开提示词弹窗）。**这改变了 2a 规格第 2 条「··· 菜单三项」**，以此为准。OB Todo `876b8bc1482247f2` 的背景仍需补入决定「v1 只显示与倒数，编辑页及点进去翻当天记忆以后再做」。
  - 2026-09-29 同晚跟进（均已部署）：抽屉让出状态栏、主页数据跨切页缓存（`6eb1a45`）；聊天回复长高时跟到底、对话列表两行、全站按下微缩 + 切页淡入（`728785c`）。
  - 窗台插画：奶糖（GPT 按照片画，CC 按区域 + 暖色渐变抠掉木板，`public/home/naitang.png` 480×325，原木板上沿在 72% 高处压窗下沿；`708295e`，`next/image` 需 `unoptimized`，否则优化器取图被 `proxy.ts` 登录挡回，`05214cb`）。**待做**：Clawd（3D 打印版：橙色方块、黑色像素墨镜、蓝色像素耳机，照奶糖那张的写实画法）、左右窗帘；可选毛绒版 Clawd。生图说明见 2026-09-29 工作窗口对话，画风以奶糖那张为准。
- [ ] 阶段 3b：记忆库。布局已定（时间线预览 D、记忆格两列方格）；前置拆分在 `feat/stage3b-split` 完成，旧 `?tab=review` 回到时间线，保留原有分类筛选与每日记忆 API。build 通过；Vitest 378 通过、1 跳过，另 2 项因本机 Windows symlink `EPERM` 失败；拆分后保留区域的 className、onClick、aria-label 与中文注释计数和拆分前对齐。待 iPhone 按 3b 前置验收做交互走查；卡片样式待 CC 预览定稿。CC 复核：合并 main 后 build 通过、Vitest 61 文件 / 381 项全过、`text-[Npx]` 为 0，合并 main。下一步 GPT 按「3b 布局」在 `feat/stage3b-memory` 实现。
  - 2026-09-29 `feat/stage3b-memory` 按「3b 布局」1–9 实现：D 时间线、两列记忆格、薄玻璃搜索与筛选、往日同日、年度章节、年轮、统一 `bucketDate`、最新/最重要排序；分类筛选行及旧权重/升降序/列表切换移除，后端算法、详情抽屉和新增入口不变。build 通过；记忆定向测试 8 项通过；全量 Vitest 382 通过、1 跳过、2 项因 Windows symlink `EPERM` 失败。`text-[Npx]` 为 0。下一步由用户在 iPhone 主屏幕 PWA 按「3b 验收」核对四主题 × 渐变/照片、8.29 往日记忆、9 月「日常」和章节句、年轮、日期、默认排序；随后 CC 验收并合并，禁止直接推 main。
  - 2026-09-29 CC 验收：合并 main 后 build 通过、Vitest 61 文件 / 385 项全过；修卡片在触屏上粘住的 hover 上浮、去掉与全站重复的按下缩放（`8640440`），合并 main（`9788058`）并部署。待用户 iPhone 走查。
- [x] 阶段 4 前置：提示词页 + 注入记忆按窗口。2026-09-29 布局已定（预览 `docs/design/stage4/prompt-page-preview.html`），排在 3b 之后交 GPT；Haven `feat/window-recall` 先合。
  - 2026-09-30 功能分支实现：Haven `feat/window-recall`（`9936dd2`）已推，独立 `recall_mode`、兼容迁移和空模块保存；dashboard `feat/prompt-page` 实现 A–D 并推同名分支。Haven 状态契约 48 项通过；dashboard build 通过，定向 Vitest 22 项通过，全量 385 项通过、1 跳过、2 项因本机 Windows symlink `EPERM` 未通过。`text-[Npx]` 和旧弹窗引用均为 0。下一步：先合并部署 Haven，再合并 dashboard；按本节手机验收逐项走查持久化、提示词一致性与 CHAT/WORK 召回，正式环境未验收前不勾选。
  - 2026-09-30 合并上线：Haven `9936dd2`，dashboard `b32aa7b`；用户手机走查后 CC 修 `d185c2f`（页面顶部重复安全区、定位截两行、定位编辑框加高、拖动把手屏蔽 iOS 长按选择）。
- [x] 阶段 4a：设置页。GPT `f186d9c`，2026-09-30 上线，用户手机确认样式。
- [ ] 阶段 4b：工作台。2026-09-30 布局已定（预览 `docs/design/stage4/workbench-preview.html`），交 GPT 在 `feat/stage4b-workbench` 实现，同分支单独 commit 做切页停顿（OB Todo `e8b1b139967b482d`）。
- [ ] 阶段 4c：其余子页面与弹窗样式逐页打磨。
- 2026-09-30 其他已上线：全站浮层挂 body（`BodyPortal`，弹窗不再被底栏压住）、聊天月历选日期后确认跳转、对话列表加载更多、记忆库去热门标签 / 往日卡放宽 / 屏外卡片跳过渲染（`35173d2`、`d185c2f`）；GPT 批次 `feat/batch-0930`：头像跟随主题、Context 上限用 SDK 真实值（Opus 5.5 = 1M）、中文粗体（`bba8117`、`91020cf`）。
- 窗台插画：Clawd 已画好（带透明通道，用户在聊天里发过），待抠图摆上窗台；窗帘可不做。
- [ ] 阶段 5
