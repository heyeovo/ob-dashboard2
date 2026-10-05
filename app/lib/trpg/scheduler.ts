// P2b 由 CC 实现：按 phase 叫言之 / DM 的回合。
export type TrpgTrigger = 'action' | 'table-talk' | 'settle' | 'roll'
export async function kickTrpgTurn(gameId: string, trigger: TrpgTrigger): Promise<void> {
  void gameId
  void trigger
}
