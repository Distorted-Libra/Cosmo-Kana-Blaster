(function () {
  "use strict";

  window.CosmoKanaBlasterConfig = {
    startingLife: 5,
    bossWaveInterval: 5,
    score: {
      characterPoint: 2,
      missPenalty: 1,
      bossBonus: 500,
      comboPower: 1.25,
      comboScale: 0.45,
      waveBonusEvery: 3
    },
    wave: {
      baseKills: 10,
      extraKillsEvery: 6,
      extraKillsCap: 8,
      bannerSeconds: {
        normal: 1.45,
        boss: 2.4
      }
    },
    enemy: {
      baseSpeed: 34,
      waveSpeed: 2.15,
      randomSpeed: 13,
      spawnMin: 0.82,
      spawnBase: 2.35,
      spawnWaveReduction: 0.045,
      spawnRandom: 0.52,
      longWordThreshold: 6,
      longWordSlowdownPerChar: 0.035,
      longWordMaxSlowdown: 0.34
    },
    boss: {
      baseReferenceSpeed: 16,
      waveReferenceSpeed: 0.85,
      minTimeLimit: 14,
      enterSpeed: 150
    },
    transition: {
      initialSpawnFirstMin: 0.3,
      initialSpawnFirstRandom: 0.2,
      initialSpawnGapMin: 0.3,
      initialSpawnGapRandom: 0.5,
      bossExitMin: 0.5,
      bossExitRandom: 0.5,
      bossSpawnDelayWithExit: 0.85,
      bossSpawnDelayEmpty: 0.15
    },
    rankWeights: [
      { beforeWave: 4, weights: { easy: 80, normal: 20, hard: 0, rare: 0 } },
      { beforeWave: 9, weights: { easy: 45, normal: 45, hard: 10, rare: 0 } },
      { beforeWave: 16, weights: { easy: 20, normal: 45, hard: 30, rare: 5 } },
      { beforeWave: 26, weights: { easy: 10, normal: 35, hard: 40, rare: 15 } },
      { beforeWave: Infinity, weights: { easy: 5, normal: 25, hard: 45, rare: 25 } }
    ]
  };
}());
