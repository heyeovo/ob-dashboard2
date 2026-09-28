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

强调色淡底按 accent 的 7%–20% 透明混合推导；表面以 tint 配玻璃不透明度，次级表面以 ink 的 4%–10% 透明混合推导；边框以 ink 的 6%–26% 透明混合推导；文字以 ink 与 base 混合，正文 92%、次要 72%、辅助 55%。状态背景、边框和 hover 分别由状态前景色的 12%、28%、18% 透明混合推导；夜主题的状态前景色提亮。头像预设、图表分类色和字段命中色是数据色，不参与材质推导。

上传图片沿用 `<html data-background="upload">`：浅色主题玻璃 tint 改为 `255 255 255`、edge 改为白色 .55；夜主题改为 `24 22 28`、白色 .10。`--bg-photo-overlay` 也由 tint 推导，手机端仍只在根画布蒙一次图，不再用固定暖米色。

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

### 动效

| Token | 值 |
|-------|-----|
| `--ease-standard` | `cubic-bezier(.2, .8, .2, 1)` |
| `--duration-fast` | `0.12s` |
| `--duration-normal` | `0.18s` |
| `--duration-slow` | `0.26s` |

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
| `--label-tracking`, `--chat-bubble-alpha` | 小号大写标签字距、聊天表面透明度预留语义 |
| `--effect-rain-intensity` | 透明玻璃水珠的数量与可见度；低强度水珠较少且较淡，高强度叠加更多水珠；默认关闭，页面不可见暂停，减少动态效果时静止 |
| `--color-success*`, `--color-danger*`, `--color-pending*`, `--color-resolved*` | 状态色及背景、边框；页面按状态语义引用 |
| `--color-chart-*`, `--color-graph-*`, `--color-memory-event` | 图表分类色与记忆事件标记 |

`backdrop-filter` 只放在固定外框等区域；聊天气泡的半透明填充留到阶段 2，当前仍使用实色。PWA 使用 `viewport-fit=cover`，交互内容避开安全区域。手机上传图片时，根画布用由 tint 推导的 `--bg-photo-overlay` 蒙一次图；页面的 `--color-bg` 透明，状态栏与主页面标题栏共用连续的顶部玻璃层，底部 5 Tab 使用低覆盖率的 `--mobile-chrome-fill` 与玻璃模糊，避免不同页面重复叠色。手机主页面的内容画布与滚动层贯穿整个视口，标题栏和底部 5 Tab 浮在其上；滚动内容用顶部和底部内边距保证首尾内容可读，不通过缩短页面高度截断背景或消息。聊天页的独立滚动、对话列表和历史聊天遵循同一规则；输入区浮在消息上方并避开底栏与系统安全区域。普通子页面使用 `SubpageBackButton` 圆形返回按钮及随正文滚动的大标题；手机端可见圆形为 36px、点击范围至少 44px，沿用底栏的玻璃色系但提高小圆按钮自身的填充强度以保证辨识度，箭头居中，按钮与标题一同靠近页面顶部。`--mobile-topbar-height` 与 `--mobile-tabbar-height` 是主页面标题栏及底栏内容的统一高度；底栏另保留系统提供的底部安全区域。独立模式下根画布与 body 至少绘制到 `100vh`，避免聊天页的短 `100dvh` 留白。清单和浏览器主题色使用杏雾底色作为回退；最终效果以 iPhone 实机截图为准。旧 Tailwind 调色板色和组件内联颜色已收编为语义 Token，`app/cc/persona.ts` 的用户可选头像渐变属于数据，不跟主题改色。

### CC 对话气泡

- 用户消息使用 `--chat-user-fill` 的实心右侧气泡。
- Assistant 流式输出只把遇到换行边界的完整普通段落提交为连续气泡；未完成尾段留在缓冲区并显示轻量三点，整轮结束后再整颗出现，不在气泡内部逐字生长。气泡使用专用的 `--chat-assistant-fill` 轻表面、无描边阴影和 14px 圆角，段间距 8px。
- 当前实时回复按完整气泡逐颗显现，新气泡使用轻微淡入上移；不能等整轮结束后一次拆出全部气泡，也不能在气泡内卡顿流式。系统启用“减少动态效果”时立即显示。
- 一轮内的 thinking、工具和助手对话按真实发生顺序交错展示；每段助手对话仍按换行拆成多个气泡，不能再把整轮正文重复显示在末尾。
- 列表、代码、表格、引用，以及「粗体小标题＋后续连续正文」保持一个结构块；结构块未闭合时不提前显示，避免章节内容被拆成很多聊天短句。
- Thinking 使用无状态圆点、无左侧竖线的轻量折叠表面；生成完成后保持用户当前的展开状态。网页不伪装成设备触觉反馈。
- 页面增量收到的后台完整消息按 360ms 间隔逐段显现；初次历史载入和已经完成的旧轮次不重播，系统启用“减少动态效果”时立即完整显示。
- 代码、列表、表格、引用等原子 Markdown block 不套文字气泡，继续整宽展示，避免结构被切碎。
- 设置 → 外观里的「聊天显示」提供两个本设备全局偏好：运行信息（引擎、Provider、模型、上下文入口）默认关闭，Token 总数与明细默认开启；错误、保存状态和持久化核对入口不受开关影响。

---

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
| **MemoryViewSwitch** | `MemoryViewSwitch.tsx` | 记忆库页内切换：时间线 / 记忆格 / 待处理（桌面与手机共用） |
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
- **聊天**（中间突起）→ `/cc`
- **工作台** → `/workbench`
- **设置** → `/settings`；外观在 `/settings/appearance`

底栏内容高 56px，另加 `env(safe-area-inset-bottom)`；主页、记忆库、工作台和设置的手机顶栏固定在状态栏下方，聊天页的消息区域独立滚动。

普通子页面的手机标题随正文自然滚动；返回按钮放在标题上方。小作品全屏查看器和登录页保留专用布局。五个主页面的顶栏内容随各自页面重设计阶段再定：聊天阶段 2，主页/记忆库阶段 3，工作台/设置阶段 4。

记忆页顶部有 mini header（`md:hidden`）：左 Ombre Brain logo，右 MemoryViewSwitch 切换时间线/记忆格/待处理。

### 新增按钮

主页面和日记页面都有右下角悬浮 "+" 按钮：
- `fixed bottom-24 md:bottom-8 right-4 sm:right-8`
- 圆形，品牌色背景，白色文字
- 点击打开 DetailPanel (modal)

### 全站布局

所有页面的主内容区均为 `max-w-6xl mx-auto px-4 sm:px-6`。

---

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
