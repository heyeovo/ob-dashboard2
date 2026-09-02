# ob-dashboard2 设计规范

## 设计 Token

所有视觉变量定义在 `app/globals.css` 的 `:root` 中。修改一处全局生效。

### 品牌色

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-primary` | `#D97757` | 主按钮、链接、强调 |
| `--color-primary-hover` | `#C86645` | 悬停态 |
| `--color-primary-soft` | `#FDF0ED` | 淡色背景（badge、标签底色） |
| `--color-primary-muted` | `#FDF9F7` | 极淡背景 |
| `--color-primary-gradient` | `#E8A58F` | 渐变终点（logo/头像） |
| `--color-primary-hover-soft` | `#FBE5DE` | 淡色按钮 hover |
| `--color-primary-light` | `#FFF5F2` | 极淡主色背景 |

### 表面层级

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-bg` | `#FCFAF8` | 页面底色 |
| `--color-surface` | `#FFFFFF` | 卡片/弹窗白底 |
| `--color-surface-elevated` | `#FDFCFB` | 高亮卡片 |
| `--color-surface-secondary` | `#F9F8F6` | 次级背景 |
| `--color-surface-tertiary` | `#F4F2EC` | 三级背景（chip/标签底） |
| `--color-surface-hover` | `#E8E4DC` | 三级背景 hover |

### 边框

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-border` | `#E8E6E1` | 默认边框 |
| `--color-border-light` | `#F0EFEB` | 淡边框 |
| `--color-border-subtle` | `#EEEAE4` | 极淡边框（滑条轨道） |
| `--color-border-hover` | `#C4C1BC` | 边框 hover 加深 |

### 文字层级

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-text-primary` | `#3A3836` | 正文 |
| `--color-text-heading` | `#2B2927` | 标题 |
| `--color-text-secondary` | `#6C6965` | 次要文字 |
| `--color-text-tertiary` | `#8A8681` | 辅助文字 |
| `--color-text-disabled` | `#A8A49D` | 禁用/占位 |
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

### CC 对话气泡

- 用户消息使用 `--chat-user-fill` 的实心右侧气泡。
- Assistant 流式输出会把已经稳定的普通段落固定成连续气泡，最后一个未完成段保留输入光标；气泡使用专用的 `--chat-assistant-fill` 轻表面、无描边阴影和 14px 圆角，段间距 8px。
- 当前实时回复按换行逐颗显现，新气泡使用轻微淡入上移；不能等整轮结束后一次拆出全部气泡。系统启用“减少动态效果”时立即显示。
- 一轮内的 thinking、工具和助手对话按真实发生顺序交错展示；每段助手对话仍按换行拆成多个气泡，不能再把整轮正文重复显示在末尾。
- Thinking 使用无状态圆点、无左侧竖线的轻量折叠表面；按下有轻微压感，展开内容带高度、位移和透明度过渡；生成完成后保持用户当前的展开状态。
- 页面增量收到的后台完整消息按 360ms 间隔逐段显现；初次历史载入不重播，系统启用“减少动态效果”时立即完整显示。
- 代码、列表、表格、引用等原子 Markdown block 不套文字气泡，继续整宽展示，避免结构被切碎。

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
| **NavBar** | `NavBar.tsx` | 桌面端顶部导航栏（`hidden md:block`），全站 8 页共用 |
| **BottomTabBar** | `BottomTabBar.tsx` | 手机端底部 5 栏 Tab Bar |
| **MobileViewSwitch** | `MobileViewSwitch.tsx` | 手机端记忆页时间线/记忆格切换 |
| **MobileShell** | `MobileShell.tsx` | 手机端布局容器（加底部间距） |

### 评分旋钮（breath-sim 专用）

| 组件 | 文件 | 用途 |
|------|------|------|
| **KnobRow** | `KnobRow.tsx` | 滑条控件 |
| **KnobToggle** | `KnobToggle.tsx` | 开关控件 |
| **ScoreBar** | `ScoreBar.tsx` | Pipeline 四维评分条 |

---

## 页面与导航

### 桌面端

NavBar 横向排列所有页面入口。`hidden md:block` 在手机端隐藏。

### 手机端

BottomTabBar 在底部显示 5 个 Tab：
- **审阅** → `/?tab=review`
- **日记** → `/journal`
- **记忆**（中间突起）→ `/`
- **Breath** → `/breath-sim`
- **设置**（点击弹出菜单）→ 关系图谱 / 导入 / 回收站 / 权重配置

底部间距：`pb-7` + `env(safe-area-inset-bottom)`。

记忆页顶部有 mini header（`md:hidden`）：左 Ombre Brain logo，右 MobileViewSwitch 切换时间线/记忆格。

### 新增按钮

主页面和日记页面都有右下角悬浮 "+" 按钮：
- `fixed bottom-24 md:bottom-8 right-4 sm:right-8`
- 圆形，品牌色背景，白色文字
- 点击打开 DetailPanel (modal)

### 全站布局

所有页面的主内容区和 NavBar 均为 `max-w-6xl mx-auto px-4 sm:px-6`。

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
| `interactive` | 白底 + 边框 + hover 上移 + 阴影 | 时间线卡片、结果列表 |
| `outline` | 白底 + 边框 | 静态内容区 |
| `ghost` | 淡底 + 细边框 | Graph 侧栏列表 |
| `empty` | 虚线边框 | 空状态占位 |

---

## 颜色映射速查表

用设计 Token 替代硬编码：`#D97757` → `var(--color-primary)`，`#3A3836` → `var(--color-text-primary)`，依次类推。
