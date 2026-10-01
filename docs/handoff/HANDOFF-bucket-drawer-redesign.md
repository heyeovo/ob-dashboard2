# HANDOFF：桶抽屉重新设计

> 2026-10-02 CC 写规格，Codex 执行，CC 验收。只改 dashboard，不动 Haven，不删任何 API route。
> 开工先读 `AGENTS.md`、`MAINTENANCE_CONTRACT.md`，**完整读 `DESIGN.md`**。
> 视觉事实源：`docs/handoff/assets/bucket-drawer-v2.html`（用户 2026-10-02 在 iPhone 上确认的静态预览，浏览器直接打开，可切四个主题、点按钮）。预览里的颜色是手写的近似值，落地一律换成现有 Token；对不上时以预览的**结构和观感**为准，以 Token 为实现手段。

## 一、为什么改

`app/components/BucketDetailDrawer.tsx`（822 行）是六个页面（memory / journey / graph / impressions / care / breath-sim）共用的桶详情抽屉。现状是旧 UI：三个日期挤在标题下、六个大格子数值、八个粗按钮、标签压在正文上面，正文后面是一整块 MOMENTS + 桶内/跨桶关联原始 ID，年轮被埋在关联后面。用户的使用频率依次是：读正文 > 复制 ID 发给 CC > 改状态 > 编辑 > 偶尔看数值 > 很少看相似记忆。按这个顺序重排。

## 二、从上到下的新结构

1. **抓手 + 关闭**：顶部一条只有抓手和右上角圆形关闭按钮（`DetailPanel` 已有的关闭若能复用就复用，别画两个）。
2. **标题**：衬线大标题（沿用现有标题档位类），右侧给关闭按钮让位。
3. **时间行**：`9月29日 周二 16:00`（北京时间，主题色小字），点它进入现有的事件时间编辑（行为不变）。**紧跟在时间右边**（不是右对齐）是 ID 胶囊：等宽小字完整 ID + 复制图标，点击走现有 `onCopyId`，`copied` 为真时胶囊描边/文字变主题色约 1.2s。开着的状态（已钉选 / 已消化 / 已解决 / 已归档 / 悬念中 / 噪声）以主题色软底小标签跟在 ID 后面，同一行放不下自然换行。
4. **体征行**（正文上面，一行淡色小字）：`IMP ●●●●●●●○○○  V .95  A .60  权重 9.79  激活 0  动态`。IMP 是 10 个小点，亮的个数 = importance。点 IMP 区域进入现有的 importance 编辑（保留 `onImportanceChange` 行为，输入 1–10）。其余字段的数据来源与现在六个格子一致。
5. **正文框**：有厚度的卡片（顶部内高光 + 细描边 + 柔和外投影，用现有玻璃/卡片 Token，参考 `DESIGN.md`，缺语义 Token 先补 `globals.css` 与 `DESIGN.md`）。框头左边淡色 `389 字 · ~506 tokens`，右边两个图标按钮：复制正文、编辑（进入现有编辑态，编辑态 UI 沿用现有逻辑，只换皮）。**标签在框内、正文下方**，上面一条虚线分隔：domain 标签主题色软底小胶囊，普通标签淡色 `#标签` 文字。
6. **年轮**：独立一节，标题「年轮」。每条左侧一道主题色细竖线（页边批注感），正文 + 下面一行淡色时间、编辑图标、删除图标。现有的逐条编辑 / 删除功能全部保留（`mutateComment` 等不改）；删除确认换成第 9 条的两步式，不再用 `window.confirm`。没有年轮时整节不显示。
7. **相似记忆**：默认折叠的一行「▸ 相似记忆」，**展开时才请求** `/api/bucket/{id}/similar`（不再随打开抽屉自动请求），列表只显示名字 + 相似度。点一项的行为保持现状。
8. **尾部**：居中两行——淡色小字 `10/01 06:01 · AI 写入`（创建时间 + 来源，来源按现有 source 字段映射成中文），下面是抹除按钮。
9. **抹除**：居中的淡色幽灵胶囊（垃圾桶图标 + 「抹除」，描边与文字都是 tertiary 级）。点第一下变危险色软底，文字变「再点一次，移入回收站」；3 秒内再点才执行现有删除（`onTraceOp(id, { delete: true })` 后 `onClose`），3 秒不点自动复原。危险色用 `--color-danger` 系 Token。
10. **底部操作栏**：固定在抽屉底部（在抽屉的滚动容器里 `position: sticky; bottom: 0`），一排八格等分：**钉选 消化 解决 归档 悬念 噪声 轻触 激活**。图标在上、10px 级小字在下。**质感照抄全站 `BottomTabBar`**：`--mobile-chrome-fill` 玻璃底 + `--glass-blur`、顶边 `--glass-border` 细线、`--glass-shadow`；底部留白用 `--mobile-tabbar-bottom`；开着的状态 = 图标后面一颗 `--color-primary-soft` 软胶囊 + 主题色（同 `.tab-pill` 选中），按下胶囊 `scale(.86)`。轻触 / 激活是动作不是开关，没有选中态。各按钮调用的接口和参数与现在完全一致（pinned / digested / resolved 用 `onTraceOp`，归档用 `onArchive`（已归档时为取消归档，沿用调用方现有逻辑），悬念用 `wish`，噪声沿用现有判断与参数，轻触 `onTouch`，激活 `onActivate`），`operating` 时整排禁用。图标参考预览，用同一套描边风格（与 `BottomTabBar` 的 stroke 宽度一致）。

## 三、删掉的

- 标题下的「修改时间」和那一行三段式 meta（创建时间挪到尾部小字）。
- 六个大数值格子、八个大按钮网格（被第 4、10 条取代）。
- **设为日记**：抽屉里的表单与相关 state；`BucketDetailDrawer` 的 `onConvertToJournal` prop；`app/memory/page.tsx` 里传入的处理函数。
- **MOMENTS 与关联整块**：`fetchMoments`、`momentData` 及 `MomentItem` / `MomentEdge` / `CrossBucketEdge` 类型、桶内关联、跨桶关联、刷新按钮。
- **合并**：merge-preview / merge-commit 的 state、请求和合并 modal。
- 不删 API route（`/api/moments`、merge 相关、转日记相关）。改完 grep 一遍，把**已无前端调用方**的 route 列在报告里，由 CC 决定去留。

## 四、不改的

- Haven、所有 API route、`DetailPanel` 本身的行为（如需小改先在报告里说明理由）。
- 六个调用页的 props 接口除 `onConvertToJournal` 外不变。
- `app/memory/MemoryCard.tsx`：CC 已改（年轮数挪到日期左边，`ec8b82b`），不要再动。

## 五、文档同步

- `AGENTS.md`「设计与组件」里 `BucketDetailDrawer` 那一条，改成新结构的一句话约定（底部操作栏、两步抹除、年轮可逐条编辑）。
- 新增 / 修改 Token 时同步 `DESIGN.md` + `globals.css`。
- `docs/handoff/README.md` 本条状态由 CC 验收后更新，Codex 不改。

## 六、验收（Codex 自测 + CC 复验）

1. `npm run build` 通过；相关测试通过；无 `text-[Npx]`、无硬编码颜色。
2. 375px 宽手机视口：结构顺序与预览一致；底栏一排八格不换行、不溢出；长正文滚动时底栏始终可见、不遮住最后的抹除按钮（滚动容器底部留出底栏高度）。
3. 四个主题（含夜间）和照片背景下对比度正常。
4. 六个调用页都能打开抽屉；八个操作、IMP 编辑、事件时间编辑、正文编辑 / 复制、ID 复制、年轮编辑 / 删除、相似记忆展开、两步抹除逐项可用。
5. 打开抽屉时网络面板里不再有 `/api/moments` 和 `/similar` 请求（展开相似记忆时才有 `/similar`）。
6. 报告里列出：改了哪些文件、删掉的 state/函数、已无调用方的 API route。
