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

**Token 分层**（`globals.css`）
- 现有 `--color-*` 保留为语义层，页面不用改。
- 新增：`--bg-base`、`--bg-image`、`--bg-overlay`、`--glass-fill`、`--glass-border`、`--glass-blur`、`--glass-shadow`、`--font-display`、`--font-body`、`--font-scale`、`--label-tracking`、`--chat-bubble-alpha`。
- 主题块：`:root[data-theme="linen"] { ... }`。滑条类的值由 `<html style>` 上的内联变量覆盖（`--glass-blur`、`--font-scale`、`--effect-rain-intensity`）。
- 暖白 `linen` 初稿（实现后按截图微调）：底色是暖纸色，从上到下轻微渐变；主色把 `#D97757` 降一点饱和度，保留家族感；文字换成暖棕灰；边框用带暖色的低透明度描边，替代现在的中性灰。
- 字体：拉丁标题用 Cormorant Garamond，中文标题用 Noto Serif SC（`next/font/google`，`preload: false`，按需子集加载），正文保留 Geist 加系统中文字体。

**Haven**
- `GET/POST /api/cc/appearance`：JSON 配置，结构如下，服务端做 normalize：
  `{ version, theme, background: { kind: "gradient"|"upload"|"none", assetId? }, glass: { blur, opacity }, font: { display: "serif"|"sans", scale }, effects: { rain: { mode: "off"|"on"|"weather", intensity } } }`
- `GET/POST/DELETE /api/cc/appearance/background`：上传一张背景图（限制大小和 MIME，压缩到合适宽度），只保留当前这一张。
- 新路由必须同时加进 `server.py` 的 `/gateway/*` 转发表（`gateway.py` 路由表里有 ⚠️ 注释）。
- 同步 Haven `docs/reference.md`「REST API」和「cc 持久化（Haven 侧）」。

**Dashboard**
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

- 更多主题：樱粉、雾蓝、深色「夜」。前提是先把剩下约 30 处低频硬编码色收编成 Token（graph 节点色、breath-sim 柱色、prompts 页、journal 滚动条、impressions 圆点、persona 渐变、import 边框等，清单见旧 `HANDOFF-ui-design-system.md` 第一步）；否则切到深色主题时这些地方不会跟着变。
- 动效：页面切换淡入 / 滑入、列表卡片交错淡入、按钮按下微缩回弹、弹窗用 spring 曲线。按页面改造时顺手做，是否引入 Framer Motion 到时候再评估。
- 雨痕 `weather` 模式：按城市查天气 API，下雨时才显示；需要确定城市配置和天气源。

## 进度

- [ ] 阶段 1
- [ ] 阶段 2
- [ ] 阶段 3
- [ ] 阶段 4
- [ ] 阶段 5
