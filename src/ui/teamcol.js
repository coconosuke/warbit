// 味方と敵の色（設定。BattleBit の Friendly Colour・Enemy Colour に合わせて選べる。11-20）
// 地図・印・HUD の色はここから取る。CSS は --ally・--enemy
export const TC = { ally: '#4aa8ff', enemy: '#ff4b3e' };
export function setTeamCols(st) {
  TC.ally = (st && st.allyCol) || '#4aa8ff';
  TC.enemy = (st && st.enemyCol) || '#ff4b3e';
  if (typeof document !== 'undefined') { const R = document.documentElement.style; R.setProperty('--ally', TC.ally); R.setProperty('--enemy', TC.enemy); }
}
