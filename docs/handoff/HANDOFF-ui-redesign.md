# UI 重构：主题引擎 + 页面改造

> 2026-09-27 开。取代 `HANDOFF-ui-design-system.md`（其第一步“清理硬编码”已完成，其余草案以本文件为准）。对应 OB Todo `ea074ff139f64c54`，TECH_DEBT `CC-P01` 并入本文件。
> 执行者：Codex（GPT）为主，CC 负责方案和验收。每个阶段单独开窗、单独 commit，完成后在下方「进度」勾掉并写 commit。
> **阶段 1 规格已定，可以直接开工。阶段 2–4 只写了方向**：每个阶段开工前，由用户和 CC 先讨论具体布局，把定案补进对应小节并标「✅ 布局已定」后才能动手；没有这个标记的阶段不许开工。

## 问题（用户原话归纳）

1. 风格工程感太重：纯白底 + 细灰边 + 全黑体、一切平铺在同一层；主页是功能卡片目录，聊天页顶栏像 IDE 工具栏。
2. 不少页面从没设计过，只是把按钮 / 卡片放上去，没对齐、没美化。
3. 希望颜色、字体、字号、效果可以自定义。

## 已定决定

- **默认主题 = 暖白升级版**（id `linen`），其他主题后续再加。
- **外观设置跨设备同步**：用户手机和电脑换着用，外观配置和背景图存 Haven。`localStorage` 只做首屏缓存镜像，不是事实源。
- **自定义三层，互相独立**：
  - 主题预设：配色、玻璃质感、阴影。不做自由取色器，用预设加少量滑条，保证好看的下限。
  - 背景：`gradient`（默认，每个主题自带一种渐变）/ `upload`（用户上传的图）/ `none`（纯色）。内置图片背景以后再加。
  - 效果：雨痕 `off` / `on`（强度可调），**默认关**；以后加 `weather`（跟随用户所在城市的真实天气）。
- **字体**：标题和名字可选衬线或黑体，正文保持清楚的黑体，整体字号有缩放。
- **视觉语言**：两层结构，底层是氛围（背景 / 渐变 / 效果），上层是半透明内容；标题用衬线；小标签用小号、加宽字距的大写字母；整体低饱和。
- 以后装饰可以放奶糖 / Clawd 形象，放在阶段 3 主页，需要美术素材时再定。

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

### 阶段 2：聊天页 + 对话列表（布局待讨论）

- 言之目前没有头像。正式头像另外设计，这之前先用衬线「言」字的圆形字标占位。
- 顶栏精简：头像、名字（衬线）、状态放一行；cc/自建、历史、本窗、设置、工作模式标识都收进右侧 `···` 菜单或底部抽屉。
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
- [ ] 阶段 2
- [ ] 阶段 3
- [ ] 阶段 4
- [ ] 阶段 5
