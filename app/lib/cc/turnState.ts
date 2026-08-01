// 一轮对话的生命周期状态（9.5 步明确化）。
//
// 以前「这一轮进行到哪了」是散在 runTurn 里的几个 flag（interrupted /
// busyReleased / terminalEvent）—— 正常完成、工具等待、服务端失败、浏览器
// 中止、用户切换会话，每种的清理动作都不统一，出过「失败后仍显示上一轮没跑完」。
// 这里把一轮的终态收拢成四种，每种都带统一的收尾约定。
//
// ⚠️ 状态机只做「记账 + 断言」，不改变 runTurn 的实际行为 ——
// 它记录这一轮最后走到了哪个终态，测试和日志可以据此断言。

/** 一轮进行中的阶段。 */
export type TurnPhase = 'preparing' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/**
 * 终态的收尾约定（runTurn 的 finally 按这些做，测试按这些断言）：
 *   succeeded  —— 正常答完：发 done → 写库 → 发 after → 释放 busy。
 *   failed     —— 服务端 / 模型出错：dropSession 收掉子进程 → 发 error →
 *                  释放 busy → 不写 Haven。
 *   cancelled  —— 浏览器断连 / 用户切走：不再推事件 → 释放 busy → 不写 Haven。
 *                 （点「停止」不是 cancelled —— 那是 interrupted，走 succeeded
 *                   路径收尾，已生成的字照常保留并写库。）
 */
export class TurnState {
  private phase: TurnPhase = 'preparing'
  /** 这一轮生成的助手文字。收尾时判断「要不要写库」要用它。 */
  assistantText = ''

  constructor(public readonly sessionId: string) {}

  markRunning() {
    this.phase = 'running'
  }

  /** 正常答完（含用户点停止后的半截回复）。 */
  markSucceeded() {
    this.phase = 'succeeded'
  }

  markFailed() {
    this.phase = 'failed'
  }

  /** 浏览器断连 / 用户切走，这一轮没跑完也不再跑。 */
  markCancelled() {
    this.phase = 'cancelled'
  }

  get current(): TurnPhase {
    return this.phase
  }

  get isDone(): boolean {
    return (
      this.phase === 'succeeded' || this.phase === 'failed' || this.phase === 'cancelled'
    )
  }
}
