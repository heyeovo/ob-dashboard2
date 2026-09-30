# ob-dashboard2 设计规范

## 设计 Token

所有视觉变量定义在 `app/globals.css`。默认主题为 `apricot`（杏雾）；`sakura`（樱粉）、`mist`（雾蓝）、`dusk`（夜）为首批主题。主题块只提供 `--theme-base`、`--theme-mesh`、`--theme-accent`、`--theme-on-accent`、`--theme-ink`、`--theme-tint`、`--theme-edge`、`--theme-grain`、`--theme-grain-blend`；`:root` 用 `color-mix()` 推导下列语义 Token。下表旧暖白数值仅用于辨认 Token 用途，实际值以 `globals.css` 的推导式为准。用户滑条的值由 `<html style>` 覆盖。

### 阶段 1.5 主题与材质

| 主题 | base | accent | ink | tint (RGB) | edge | 颗粒 |
|---|---|---|---|---|---|---|
| 杏雾 `apricot` | `#F5EBE3` | `#C27B63` | `#3F3634` | `255 249 245` | 白色 .70 | .07 / multiply |
| 樱粉 `sakura` | `#F6E8EA` | `#C0707F` | `#3F3236` | `255 247 248` | 白色 .72 | .07 / multiply |
| 雾蓝 `mist` | `#E8EDF1` | `#5F7F98` | `#2F3940` | `250 252 253` | 白色 .75 | .07 / multiply |
| 夜 `dusk` | `#1E1C23` | `#D9A08A` | `#EDE6E1` | `40 36 46` | 白色 .08 | .10 / soft-light |

`--bg-gradient` 取主题的 mesh；html 上的灰度 SVG `feTurbulence` 颗粒层覆盖渐变与纯色背景。浅色主题的强调色文字为白色，夜主题为 `#231D1C` 并使用 `color-scheme: dark`。旧 `linen` 配置由前后端归一化为 `apricot`。

强调色淡底按 accent 的 7%–20% 透明混合推导；表面以 tint 配玻璃不透明度，次级表面以 ink 的 4%–10% 透明混合推导；边框以 ink 的 6%–26% 透明混合推导；文字以 ink 与 base 混合，正文 92%、次要 72%、辅助 55%。状态背景、边框和 hover 分别由状态前景色的 12%、28%、18% 透明混合推导；夜主题的状态前景色提亮。头像的「跟随主题」预设由 accent 与 base 推导；其余固定预设、图表分类色和字段命中色是数据色，不参与材质推导。

上传图片沿用 `<html data-background="upload">`：浅色主题玻璃 tint 改为 `255 255 255`、edge 改为白色 .55；夜主题改为 `24 22 28`、白色 .10。`--bg-photo-overlay` 也由 tint 推导，手机端仍只在根画布蒙一次图，不再用固定暖米色。

「背景浓度」滑条（`background.intensity`，0.2–1，默认 0.7，存 Haven）写到 `<html style>` 的 `--bg-intensity`：渐变模式用 `--bg-gradient-veil` 盖一层 `(1 - 浓度)` 的主题底色，照片模式用 `--bg-photo-overlay` 盖一层 `min(.9, (1 - 浓度) × 2.8)` 的 tint，纯色模式不生效。页面根容器 `--color-bg` 为透明，不再额外叠底色。

照片强调色：照片模式可选「跟随主题 / 跟随图片」（`background.accentMode`，上传新图默认跟随图片）。`app/lib/photoAccent.ts` 在浏览器端把图缩到 48×48，跳过灰 / 白 / 黑，取面积大又有颜色的色相，饱和度压到 25–50%，存进 `background.accent {h, s}` 同步到 Haven。生效时 `<html data-accent="photo">`，`--theme-accent` = `hsl(--photo-h --photo-s (--photo-l + --photo-l-shift))`：浅色主题亮度 44%、夜 72%，黄绿色相再压 6% 保证白字对比度；其余强调派生 Token 自动跟随。取不出颜色时回落主题强调色。文字色仍用主题 ink。

照片模式文字可读性：`secondary / tertiary / disabled` 文字与 base 的混合比提到 82 / 68 / 50；`body` 继承一层与 tint 同色、贴着笔画的淡光晕（`text-shadow` 1px + 3px，更大半径会让字发虚），把直接压在照片上的字和花纹隔开，气泡（`.cc-bubble-*`）、卡片（`bg-[var(--color-surface*)]`）、浮层（`.float-surface` / `.cc-modal` / `.cc-popmenu`）、玻璃外框（顶栏、底栏、输入栏、返回按钮）、thinking 块、行内代码、标题（`h1–h3`、`.cc-name`）和强调色实底里的字不加光晕；新增自带底色的组件也要加进 `globals.css` 这条排除名单，只给直接压在照片上的字。

浮层（`DetailPanel`、`.cc-modal` 系列弹窗 / 底部 sheet、`.cc-popmenu`、聊天「+」菜单、历史抽屉、主页侧边抽屉）统一用 `.float-surface` / `--float-fill`：tint 不透明度取 `max(玻璃不透明度, .94)` 并自带 `--float-blur` 模糊，不随毛玻璃滑条变透。新增浮层必须用它，不要用 `--color-surface`。

### 品牌色

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-primary` | `#C87458` | 主按钮、链接、强调 |
| `--color-primary-hover` | `#B76549` | 悬停态 |
| `--color-primary-soft` | `#F9EDE7` | 淡色背景（badge、标签底色） |
| `--color-primary-muted` | `#FCF7F2` | 极淡背景 |
| `--color-primary-gradient` | `#DEA48D` | 渐变终点（logo/头像） |
| `--color-primary-hover-soft` | `#F4DFD5` | 淡色按钮 hover |
| `--color-primary-light` | `#FEF4EE` | 极淡主色背景 |
| `--color-on-primary` | `#FFFFFF` | 主色按钮上的字与图标 |
| `--color-overlay` | `#000000` | 带透明度的遮罩基础色 |

### 表面层级

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-bg` | `transparent` | 页面根容器底色；背景由 `html` 的底色 + 渐变 / 照片负责，页面不再叠半透明层 |
| `--color-surface` | `rgb(255 253 250 / .88)` | 卡片/弹窗半透明填充，无逐卡模糊 |
| `--color-surface-elevated` | `#FFFCF8` | 高亮卡片 |
| `--color-surface-secondary` | `#F8F3ED` | 次级背景 |
| `--color-surface-tertiary` | `#F1E9E1` | 三级背景（chip/标签底） |
| `--color-surface-hover` | `#E9DED3` | 三级背景 hover |

### 边框

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-border` | `rgba(122, 95, 79, .21)` | 默认边框 |
| `--color-border-light` | `rgba(122, 95, 79, .13)` | 淡边框 |
| `--color-border-subtle` | `rgba(122, 95, 79, .10)` | 极淡边框（滑条轨道） |
| `--color-border-hover` | `rgba(122, 95, 79, .38)` | 边框 hover 加深 |

### 文字层级

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-text-primary` | `#483D36` | 正文 |
| `--color-text-heading` | `#342B26` | 标题 |
| `--color-text-secondary` | `#71645C` | 次要文字 |
| `--color-text-tertiary` | `#93847A` | 辅助文字 |
| `--color-text-disabled` | `#B2A79F` | 禁用/占位 |
| `--color-text-divider` | `#D0CEC9` | 分隔符 |

### 状态色

| 状态 | 前景色 Token | 背景色 Token |
|------|------------|------------|
| 钉选 (pinned) | `--color-pinned` (#D97757) | `--color-pinned-bg` (#FDF0ED) |
| 已解决 (resolved) | `--color-resolved` (#3B72B9) | `--color-resolved-bg` (#EDF4FC) |
| 已消化 (digested) | `--color-digested` (#478B4A) | `--color-digested-bg` (#EAF5E9) |
| feel | `--color-feel` (#D97757) | `--color-feel-bg` (#FDF0ED) |
| 悬念 (wish) | `--color-wish` (#B8860B) | `--color-wish-bg` (#FDF3E7) |
| 已归档 (archived) | `--color-archived` (#8A8681) | `--color-archived-bg` (#F4F2EC) |
| 噪声 (noise) | `--color-noise` (#8A8681) | `--color-noise-bg` (#F4F2EC) |
| 待处理 (pending) | `--color-pending` (#C97E2C) | `--color-pending-bg` (#FDF3E4) |
| 危险操作 | `--color-danger` (#C64B45) | `--color-danger-bg` (#FCEEED) |

### 状态扩展（边框/hover）

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-pending-border` | `#F2D9B6` | 待处理边框 |
| `--color-pending-hover` | `#FBE9D0` | 待处理 hover |
| `--color-danger-border` | `#F0C0BF` | 错误边框 |
| `--color-danger-hover` | `#FADAD9` | 错误 hover |
| `--color-digested-border` | `#C5E0C3` | 已消化边框 |
| `--color-digested-hover` | `#D4EAD2` | 已消化 hover |
| `--color-resolved-border` | `#C8DAF0` | 已解决边框 |
| `--color-resolved-hover` | `#E0ECF8` | 已解决 hover |

### 即时模拟/语义通道

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-keyword` | `#D97757` | 关键词命中 |
| `--color-keyword-bg` | `#FDF0ED` | 关键词命中背景 |
| `--color-semantic` | `#478B4A` | 语义召回 |
| `--color-semantic-bg` | `#EAF5E9` | 语义召回背景 |

### 字段命中色

| Token | 值 | 对应字段 |
|-------|-----|---------|
| `--color-field-name` | `#D97757` | name |
| `--color-field-domain` | `#8A8681` | domain |
| `--color-field-tags` | `#3B72B9` | tags |
| `--color-field-content` | `#478B4A` | content |

### 圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | 6px | chip/tag/badge |
| `--radius-md` | 10px | Card(padding=sm) |
| `--radius-lg` | 14px | Card(padding=md) |
| `--radius-xl` | 16px | Card(padding=lg) |
| `--radius-2xl` | 22px | 弹窗/Modal |
| `--radius-window` | 30px | 主页窗洞圆角 |
| `--radius-reading-card` / `--radius-journal-paper` | 18px / 20px | 阶段 4c-1 阅读页列表卡与单篇正文纸张 |

### 动效

| Token | 值 |
|-------|-----|
| `--ease-standard` | `cubic-bezier(.2, .8, .2, 1)` |
| `--duration-fast` | `0.12s` |
| `--duration-normal` | `0.18s` |
| `--duration-slow` | `0.26s` |

- 全站按下反馈：`a` / `button` / `[role="button"]` 按下时 `scale: .97`（base 层、零优先级，用独立 `scale` 属性，不碰 Tailwind 的 `translate`）；不想要的元素自己覆盖 `scale`。
- 切页淡入：`MobileShell` 按路径重挂内容层并播 `.page-enter`（只动 opacity，不用 transform，免得页面里的 fixed 栏在动画期间错位）。`prefers-reduced-motion` 下两者都关。

### 阴影

| Token | 值 |
|-------|-----|
| `--shadow-sm` | `0 2px 6px rgba(58,56,54,0.04)` |
| `--shadow-md` | `0 4px 14px rgba(58,56,54,0.06)` |
| `--shadow-hover` | `0 4px 18px rgba(217,119,87,0.10)` |

### 布局

| Token | 值 |
|-------|-----|
| `--page-width` | `1152px` |

### 主题引擎与外观

| Token | 用途 |
|-------|------|
| `--bg-base`, `--bg-image`, `--bg-overlay`, `--bg-photo-overlay` | 页面最底层纯色、主题渐变或上传图片、图片遮罩；背景可选 gradient / upload / none |
| `--glass-fill`, `--glass-border`, `--glass-blur`, `--glass-shadow` | 固定外框的玻璃质感；滑条覆盖模糊与不透明度 |
| `--font-display`, `--font-body`, `--font-scale` | 标题字体、正文黑体与整体字号缩放；标题可选 serif / sans |
| `--type-title-scale`, `--type-body-scale`, `--type-meta-scale` | 标题、正文、小字的独立字号系数，默认均为 1；与整体字号相乘 |
| `--label-tracking`, `--chat-bubble-alpha` | 小号大写标签字距、聊天表面透明度预留语义 |
| `--chat-user-fill`, `--chat-assistant-fill`, `--chat-bubble-radius`, `--chat-bubble-edge`, `--chat-bubble-shadow` | 阶段 2a 的两侧半透明气泡：用户 24% 强调色、助手 6% 强调色、90% tint；共用 18px 圆角、顶部高光与轻阴影，不逐泡模糊 |
| `--persona-avatar-tint` | 协作者头像的「跟随主题」渐变，由 `--theme-accent` 与 `--theme-base` 混合；夜主题自动压低亮度。旧「橙」预设继续使用 `--chat-avatar-tint` |
| `--chat-session-group-fill`, `--chat-session-group-radius`, `--chat-main-glow`, `--chat-session-dot*` | 对话列表 A：78% tint 的细线分组、18px 圆角、主窗右上角强调色光晕与窗口模式圆点 |
| `--chat-attachment-width`, `--chat-sheet-height`, `--chat-sheet-radius` | 聊天附件最大宽度和聊天浮层尺寸；输入区的安全区域内边距保留与系统 inset 的计算 |
| `--home-frame-fill`, `--home-anniversary-fill`, `--home-window-inset` | 阶段 3a 主页窗框实底、纪念日浮卡、窗洞内阴影；上传照片只画在窗洞里 |
| `--home-cat-width`, `--home-clawd-glasses`, `--radius-window` | 窗沿奶糖插画宽度（`min(36vw, 140px)`，图 `public/home/naitang.png` 原木板上沿在 72% 高处，压在窗下沿）、Clawd 占位剪影墨镜色、窗洞 30px 圆角 |
| `--memory-card-fill`, `--memory-search-fill`, `--memory-ago-fill`, `--memory-filter-fill` | 阶段 3b 记忆卡片、搜索框、往日记忆条和筛选胶囊的主题材质；列表卡片不做逐卡模糊 |
| `--memory-card-shadow`, `--memory-switch-shadow` | 记忆卡片顶部高光与轻阴影、两格切换器选中阴影 |
| `--memory-card-gap`, `--memory-grid-min-height` | 记忆卡片 9px 间距与记忆格固定起始高度（两列等高） |
| `--journal-paper-fill`, `--journal-sheep-dot`, `--journal-joint-dot` | 阶段 4c-1 日记正文纸张 84% tint、小羊的主题蓝灰圆点，以及共同作者由两色各占半边的小圆点 |
| `--todo-check-size`, `--journal-editor-min-height`, `--journal-dialog-max-height`, `--journal-new-body-min-height` | 阶段 4c-1 待办圆圈 21px；日记编辑正文至少半屏、创建表单正文至少 35vh 且抽屉最高 75vh |
| `--effect-rain-intensity` | 透明玻璃水珠的数量与可见度；低强度水珠较少且较淡，高强度叠加更多水珠；默认关闭，页面不可见暂停，减少动态效果时静止 |
| `--color-success*`, `--color-danger*`, `--color-pending*`, `--color-resolved*` | 状态色及背景、边框；页面按状态语义引用 |
| `--color-chart-*`, `--color-graph-*`, `--color-memory-event` | 图表分类色与记忆事件标记 |

`backdrop-filter` 只放在固定外框等区域；聊天气泡使用半透明填充，不逐泡模糊。PWA 使用 `viewport-fit=cover`，交互内容避开安全区域。手机上传图片时，根画布用由 tint 推导的 `--bg-photo-overlay` 蒙一次图；页面的 `--color-bg` 透明，状态栏与主页面标题栏共用连续的顶部玻璃层，底部 5 Tab 使用低覆盖率的 `--mobile-chrome-fill` 与玻璃模糊，避免不同页面重复叠色。手机主页面的内容画布与滚动层贯穿整个视口，标题栏和底部 5 Tab 浮在其上；滚动内容用顶部和底部内边距保证首尾内容可读，不通过缩短页面高度截断背景或消息。聊天页的独立滚动、对话列表和历史聊天遵循同一规则；输入区浮在消息上方并避开底栏与系统安全区域。普通子页面使用 `SubpageBackButton` 圆形返回按钮及随正文滚动的大标题；手机端可见圆形为 36px、点击范围至少 44px，沿用底栏的玻璃色系但提高小圆按钮自身的填充强度以保证辨识度，箭头居中，按钮与标题一同靠近页面顶部。`--mobile-topbar-height` 与 `--mobile-tabbar-height` 是主页面标题栏及底栏内容的统一高度；底栏下沿用 `--mobile-tabbar-bottom`（见「手机端」）。独立模式下根画布与 body 至少绘制到 `100vh`，避免聊天页的短 `100dvh` 留白。清单和浏览器主题色使用杏雾底色作为回退；最终效果以 iPhone 实机截图为准。旧 Tailwind 调色板色和组件内联颜色已收编为语义 Token，`app/cc/persona.ts` 的固定头像渐变属于数据，只有「跟随主题」预设随主题改色。

### CC 对话气泡

- 用户消息使用 `--chat-user-fill` 的半透明右侧气泡；助手使用 `--chat-assistant-fill`。两侧共用 18px 圆角、顶部高光和轻阴影。
- Assistant 流式输出只把遇到换行边界的完整普通段落提交为连续气泡；未完成尾段留在缓冲区并显示轻量三点，整轮结束后再整颗出现，不在气泡内部逐字生长。普通段落贴合文字宽度，段间距 8px。
- 当前实时回复按完整气泡逐颗显现，新气泡使用轻微淡入上移；不能等整轮结束后一次拆出全部气泡，也不能在气泡内卡顿流式。系统启用“减少动态效果”时立即显示。
- 一轮内的 thinking、工具和助手对话按真实发生顺序交错展示；每段助手对话仍按换行拆成多个气泡，不能再把整轮正文重复显示在末尾。
- 列表、代码、表格、引用，以及「粗体小标题＋后续连续正文」或「粗体小标题＋紧跟的列表 / 引用 / 表格 / 代码」保持一个结构块（分段 v3）；结构块未闭合时不提前显示，避免章节内容被拆成很多聊天短句。
- Thought process 与 Tools 都是无底色的一行淡色小字（`.cc-think-toggle`），后面跟共用的细线箭头 `.cc-fold-caret`（收起朝右、展开朝下）；展开后的思考内容不加框、不加左侧竖线，只缩进 12px。生成完成后保持用户当前的展开状态。输入栏圆角用 `--chat-composer-radius`（22px），不用 999px，否则多行时会被拉变形。网页不伪装成设备触觉反馈。
- 页面增量收到的后台完整消息按 360ms 间隔逐段显现；初次历史载入和已经完成的旧轮次不重播，系统启用“减少动态效果”时立即完整显示。
- 消息列表和气泡的 React key 用 `renderKey || id`，不用 `id`：一轮结束存进 Haven 后，用户和助手消息的 `id` 会从临时 id 换成正式 id，`renderKey` 保留第一次渲染时的值。直接拿 `id` 当 key 会整条重新挂载，已经显现完的气泡全部消失再重播一遍（2026-09-28 修过一次）。
- 代码、列表、表格、引用等原子 Markdown block 进入整宽气泡，结构不拆；代码块在气泡内再用 7% ink 的底色。Markdown 标题或单独一行的粗体小标题与后续块合成一泡。
- 两侧操作行显示 HH:mm 和淡色小图标；保存成功不显示双勾。正在思考显示逐秒计时与扫光，减少动态效果时停用扫光。
- 设置 → 外观里的「聊天显示」提供两个本设备全局偏好：运行信息（引擎、Provider、模型、上下文入口）默认关闭，Token 总数与明细默认开启；错误、保存状态和持久化核对入口不受开关影响。

---

### 字号档位

| 层级 | 类名 | 100% 时基准字号 |
|---|---|---|
| 小字 | `text-3xs` / `text-2xs` / `text-meta` / `text-xs` | 9 / 10 / 11 / 12px |
| 正文 | `text-note` / `text-sm` / `text-md` / `text-base` | 13 / 14 / 15 / 16px |
| 标题 | `text-lg` / `text-xl` / `text-2xl` / `text-3xl` / `text-4xl` | 18 / 20 / 24 / 30 / 36px |
| 主页大数字 | `--text-hero`（仅 CSS 变量，主页纪念日倒数） | 44px，跟标题系数缩放 |

所有档位以 rem 定义，先受「整体字号」影响，再乘所属层级的系数；新档位也有对应的行高 Token。以后使用命名档位类，不再写 `text-[Npx]`。`globals.css` 的固定字号也引用同一组 Token；Markdown 标题等相对字号保持 `em`。手机端输入框、textarea 和 select 的实际字号至少 16px，避免 iPhone 聚焦时页面自动放大。

## 组件映射

### 原子组件（`app/components/`）

| 组件 | 文件 | 用途 | 关键 Props |
|------|------|------|-----------|
| **StatusBadge** | `StatusBadge.tsx` | 桶状态标签（已解决/已消化/噪声等） | `type` (pinned/resolved/digested/noise/feel/wish), `size` (sm/xs) |
| **TagPill** | `TagPill.tsx` | Domain / tag 标签胶囊 | `text`, `variant` (domain/tag) |
| **DataBadge** | `DataBadge.tsx` | score / imp 等数字展示 | `label`, `value`, `size` (sm/xs) |
| **Stat** | `Stat.tsx` | 统计格子 | `label`, `value` |

### 容器组件

| 组件 | 文件 | 用途 | 关键 Props |
|------|------|------|-----------|
| **Card** | `Card.tsx` | 统一卡片壳 | `variant` (interactive/outline/ghost/empty), `padding` (none/sm/md/lg) |
| **SearchBar** | `SearchBar.tsx` | 全站统一的药丸搜索框 | `value`, `onChange`, `placeholder` |
| **FilterBar** | `FilterBar.tsx` | 筛选按钮行容器 | `children` |
| **FilterPill** | `FilterBar.tsx` (named export) | 单个筛选药丸按钮 | `label`, `active`, `onClick` |

### 弹窗组件

| 组件 | 文件 | 用途 | 关键 Props |
|------|------|------|-----------|
| **DetailPanel** | `DetailPanel.tsx` | 统一的详情弹窗（drawer/modal） | `open`, `onClose`, `mode` (drawer/modal), `width`, `loading` |

### 导航组件

| 组件 | 文件 | 用途 |
|------|------|------|
| **SideRail** | `SideRail.tsx` | 桌面端左侧导航栏（4.6 取代原顶部 NavBar） |
| **BottomTabBar** | `BottomTabBar.tsx` | 手机端底部 5 栏 Tab Bar |
| **MemoryViewSwitch** | `MemoryViewSwitch.tsx` | 记忆库页内切换：时间线 / 记忆格（桌面与手机共用） |
| **MobileShell** | `MobileShell.tsx` | 手机端布局容器（加底部间距） |
| **SubpageBackButton** | `SubpageBackButton.tsx` | 手机子页面正文标题上方的圆形返回按钮 |

### 评分旋钮（breath-sim 专用）

| 组件 | 文件 | 用途 |
|------|------|------|
| **KnobRow** | `KnobRow.tsx` | 滑条控件 |
| **KnobToggle** | `KnobToggle.tsx` | 开关控件 |
| **ScoreBar** | `ScoreBar.tsx` | Pipeline 四维评分条 |

---

## 页面与导航

### 桌面端

SideRail 在左侧纵向排列页面入口，手机端隐藏。

### 手机端

BottomTabBar 在底部显示 5 个 Tab：
- **主页** → `/`
- **记忆库** → `/memory`
- **聊天** → `/cc`
- **工作台** → `/workbench`
- **设置** → `/settings`；外观在 `/settings/appearance`

底栏满宽、只放图标（文字只作 `aria-label`），当前页用 `.tab-pill` 强调色淡底（`--color-primary-soft`）托住图标，按下时小胶囊缩到 .86 再弹回；聊天与其他 Tab 同样式，不突起。内容高 `--mobile-tabbar-height`（44px），下沿 `--mobile-tabbar-bottom` 只保留一部分 Home 条安全区（`env(safe-area-inset-bottom) - 14px`，最少 8px）；页面避让底栏一律用这两个变量相加，不再直接加 `env(safe-area-inset-bottom)`。主页、记忆库、工作台和设置的手机顶栏固定在状态栏下方，聊天页的消息区域独立滚动。

普通子页面的手机标题随正文自然滚动；返回按钮放在标题上方。小作品全屏查看器和登录页保留专用布局。五个主页面的顶栏内容随各自页面重设计阶段再定：聊天阶段 2，主页/记忆库阶段 3，工作台/设置阶段 4。

主页阶段 3a 使用固定窗楣取代原 mini header：菜单、英文日期、默认协作者小头像。主页为实底窗框，窗洞使用当前外观背景；上传照片只在窗洞中绘制。纪念日浮卡压在窗沿上，窗台的日记本、这一周、照顾仅用细线分段。桌面沿用同一结构并居中至 640px，SideRail 不变。

记忆页手机固定顶栏左侧为衬线「记忆库」，右侧 MemoryViewSwitch 薄玻璃药丸切换时间线/记忆格；桌面同样在顶栏显示标题与切换器。时间线使用无竖线的日期分组和圆角实填充卡片；记忆格使用两列等高小方格。

### 新增按钮

主页面和日记页面都有右下角悬浮 "+" 按钮：
- `fixed bottom-24 md:bottom-8 right-4 sm:right-8`
- 圆形，品牌色背景，白色文字
- 点击打开 DetailPanel (modal)

### 全站布局

所有页面的主内容区均为 `max-w-6xl mx-auto px-4 sm:px-6`。

---

## 层级（z-index）

| 档 | 值 | 放什么 |
|---|---|---|
| 装饰 | `-3` 背景（`body::before`）/ `-2` 雨痕 / `-1` 颗粒（`html::before`） | 只做氛围，不接收点击 |
| 内容 | `auto` | 页面本身；**页面外壳（`MobileShell` 内容层、各页根容器）不加 z-index** |
| 固定外框 | `20–40` | 顶栏、底部 5 Tab（40）、悬浮按钮 |
| 浮层 | `50+` | `DetailPanel`、弹窗、底部 sheet、抽屉、菜单 |

浮层永远盖过底部 Tab，不按 Tab 高度留底边，所以以后改 Tab 高度不用回头调浮层。给某层容器加 z-index 会创建新的层叠上下文，里面的浮层再高也出不来——2026-09-28 就因为内容外壳加了 `z-[1]`，所有弹窗都被压在 Tab 下面。

全屏浮层（`fixed inset-0` 的遮罩 / sheet / 抽屉 / 模态框）一律包一层 `BodyPortal`（`app/components/BodyPortal.tsx`）挂到 `body` 下：留在页面树里时，祖先只要带 transform、opacity 动画、`backdrop-filter` 或 `content-visibility` 就会把它关进去。`DetailPanel` 已内置。

## 弹窗规范

所有弹窗（桶详情、新增记忆/日记、合并预览、日记查看、Prompt 测试）统一使用 **DetailPanel**。

### 两种模式

| mode | 桌面端 | 手机端（未实现） | 适用场景 |
|------|--------|-----------------|---------|
| `drawer` | 右侧滑入 | 底部 sheet | 桶详情 |
| `modal` | 居中 overlay | 底部 sheet | 新增记忆/日记、合并预览、日记查看、Prompt 测试 |

### DetailPanel 调用示例

```tsx
// Drawer
<DetailPanel open={!!selected} onClose={fn} mode="drawer">
  <BucketContent ... />
</DetailPanel>

// Modal
<DetailPanel open={showAdd} onClose={fn} mode="modal" width="max-w-lg">
  <AddForm ... />
</DetailPanel>
```

### 卡片变体

| variant | 样式 | 典型使用 |
|---------|------|---------|
| `interactive` | 半透明表面 + 边框 + hover 上移 + 阴影 | 时间线卡片、结果列表 |
| `outline` | 半透明表面 + 边框 | 静态内容区 |
| `ghost` | 淡底 + 细边框 | Graph 侧栏列表 |
| `empty` | 虚线边框 | 空状态占位 |

---

## 颜色映射速查表

用设计 Token 替代硬编码：`#D97757` → `var(--color-primary)`，`#3A3836` → `var(--color-text-primary)`，依次类推。
