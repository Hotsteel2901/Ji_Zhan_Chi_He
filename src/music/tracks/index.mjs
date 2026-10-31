// ============================================================
//  五首曲目播放列表（顺序即游戏内自动轮播顺序）
// ============================================================
import { coldLoop } from './coldloop.mjs';
import { tileAbyss } from './tileabyss.mjs';
import { chlorineDawn } from './chlorinedawn.mjs';
import { pumpRoom } from './pumproom.mjs';
import { echoDrown } from './echodrown.mjs';

export const TRACKS = [coldLoop, tileAbyss, chlorineDawn, pumpRoom, echoDrown];
export { coldLoop, tileAbyss, chlorineDawn, pumpRoom, echoDrown };
