# 五首程序化 D&B · 编曲说明

全部由 `src/music/synth.mjs` 的 WebAudio 实时合成，无采样、无外部音频文件。
每首按 16 小节/段的完整结构写作；各段有独立配器、鼓型、和声与旋律。

## 01 冷水循环 COLD LOOP
- 174 BPM · A minor · 104 bars ≈ 2:23 · Liquid D&B
- 和声：Am9 – Fmaj9 – Cmaj9 – Gadd9（每 2 小节）
- 乐器：温暖 Pad、FM 钢琴主题、铃铛对句、Reese、Sub、滚动 breakbeat、16 分琶音
- 结构：Intro 8 → Build 8 → Drop A 32 → Break 8 → Drop B 32 → Bridge 8 → Outro 8

## 02 瓷砖深渊 TILE ABYSS
- 172 BPM · F# phrygian · 96 bars ≈ 2:14 · Techstep / Neurofunk
- 和声：F# 小调 drone + F#m stabs
- 乐器：三振荡器失真 Reese、金属敲击、工业 clank、暗色 Pad、稀疏长音 Lead
- 终段升半音；Break 为半拍崩塌；大量 Impact/Riser/Siren

## 03 氯气黎明 CHLORINE DAWN
- 168 BPM · D major · 104 bars ≈ 2:29 · Atmospheric / Liquid D&B
- 和声：Dmaj9 – Bm7 – Gmaj7 – A7sus4（每小节）
- 乐器：FM 铃铛主题、钢琴琶音、明亮 Pad、Choir、轻 breakbeat、rimshot、shaker
- 结构：Intro/Build/Drop A/Break/Drop B/Bridge/Drop C/Outro；Drop C 高八度铃铛

## 04 泵房脉冲 PUMP ROOM
- 176 BPM · E phrygian · 96 bars ≈ 2:11 · Jump-up
- 和声：Em7 – Fmaj7 – G6 – Am7
- 乐器：Wobble 低音（1/8 与 1/16 速率切换）、重击鼓组、Rave 和弦刺、机械 clank、Lead
- 结构：Intro/Build/Drop A/Break/Drop B/Bridge/Drop C/Outro

## 05 回声溺亡 ECHO DROWN
- 170 BPM · C minor · 104 bars ≈ 2:27 · Deep / Tribal D&B
- 和声：Cm(add9) – Abmaj7 – Fm7 – Bb6（每 2 小节）
- 乐器：低音合唱、半拍重鼓、部落嗵鼓/边击、极深 Sub、钟声/管风琴主题、水滴
- 结构：Intro/Build/Drop A/Break/Drop B/Bridge/Drop C/Outro

## 技术验证
- 离线渲染完整时长：144.7 / 135.2 / 149.8 / 132.1 / 148.0 秒
- 峰值：0.989 / 0.997 / 0.983 / 0.991 / 0.985
- 全曲无静音 4 秒窗；段落平均 RMS 从 0.05–0.10（前奏）升至 0.30–0.39（Drop）
