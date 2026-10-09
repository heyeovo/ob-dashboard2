// 工作窗口 / 后台 wake 开 worktree 的地方和「主仓库检出」，ccDirs 和 bashPolicy 共用。
// 单独一个文件，是为了不让测试里 mock 掉 ccDirs 时把这两个常量一起抹掉。

/** 容器里的临时目录，重建会清空，所以在这里干的活要推分支。 */
export const WORKTREE_ROOT = '/workspace/worktrees'

/** 前台工作窗口在用的主仓库检出：后台只读。 */
export const MAIN_CHECKOUTS = ['/workspace/dashboard', '/workspace/haven'] as const
