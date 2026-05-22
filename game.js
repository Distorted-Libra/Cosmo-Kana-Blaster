const canvas = document.getElementById("stage");
    const ctx = canvas.getContext("2d");
    const overlay = document.getElementById("overlay");
    const overlayDialog = document.getElementById("overlayDialog");
    const titleLogo = document.getElementById("titleLogo");
    const overlayTitle = document.getElementById("overlayTitle");
    const overlayText = document.getElementById("overlayText");
    const waveBanner = document.getElementById("waveBanner");
    const startBtn = document.getElementById("startBtn");
    const resetBtn = document.getElementById("resetBtn");
    const muteBtn = document.getElementById("muteBtn");
    const scoreEl = document.getElementById("score");
    const scorePopEl = document.getElementById("scorePop");
    const comboEl = document.getElementById("combo");
    const lifeEl = document.getElementById("life");
    const waveEl = document.getElementById("wave");
    const targetKanaEl = document.getElementById("targetKana");
    const targetRomanEl = document.getElementById("targetRoman");

    function loadSprite(src) {
      const image = new Image();
      image.src = src;
      return image;
    }

    const sprites = {
      player: loadSprite("./assets/sprites/player-fighter.png"),
      enemy: loadSprite("./assets/sprites/enemy-ufo.png"),
      bosses: Array.from({ length: 10 }, (_, index) => loadSprite(`./assets/sprites/boss-ufo-${String(index + 1).padStart(2, "0")}.png`))
    };

    const { kanaMap, smallKana, words, bossWords } = window.CosmoKanaBlasterData;
    const config = window.CosmoKanaBlasterConfig;
    const BEST_RESULT_KEY = "cosmo-kana-blaster-best-result";

    const state = {
      running: false,
      over: false,
      score: 0,
      combo: 0,
      life: config.startingLife,
      wave: 1,
      killsInWave: 0,
      maxCombo: 0,
      missCount: 0,
      correctCount: 0,
      enemiesDestroyed: 0,
      bossesDestroyed: 0,
      startedAt: 0,
      endedAt: 0,
      enemies: [],
      bullets: [],
      particles: [],
      stars: [],
      targetId: null,
      candidateIds: [],
      input: "",
      lastTime: 0,
      spawnTimer: 0,
      spawnQueue: [],
      bossSpawnDelay: 0,
      nextId: 1,
      shake: 0,
      missFlash: 0,
      title: true,
      waveBannerTime: 0,
      waveBannerBoss: false
    };

    const sound = window.CosmoKanaBlasterSound;

    function unlockAudio() {
      if (sound) sound.init();
      updateMuteButton();
    }

    function updateMuteButton() {
      if (!muteBtn || !sound) return;
      const muted = sound.isMuted();
      muteBtn.textContent = muted ? "Muted" : "Sound";
      muteBtn.setAttribute("aria-pressed", String(muted));
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedStars();
    }

    function seedStars() {
      const rect = canvas.getBoundingClientRect();
      state.stars = Array.from({ length: Math.max(42, Math.floor(rect.width / 12)) }, () => ({
        x: Math.random() * rect.width,
        y: Math.random() * rect.height,
        r: Math.random() * 1.7 + .4,
        speed: Math.random() * 26 + 18,
        alpha: Math.random() * .5 + .25
      }));
    }

    function tokenizeKana(kana) {
      const tokens = [];
      for (let i = 0; i < kana.length; i += 1) {
        const one = kana[i];
        const two = kana.slice(i, i + 2);
        if (one === "っ") {
          tokens.push({ kana: "っ", options: ["ltu", "xtu"], sokuon: true });
          continue;
        }
        if (smallKana.has(kana[i + 1]) && kanaMap.has(two)) {
          tokens.push({ kana: two, options: kanaMap.get(two) });
          i += 1;
        } else {
          tokens.push({ kana: one, options: kanaMap.get(one) || [one] });
        }
      }
      return tokens;
    }

    function optionsForTokens(tokens, index) {
      const token = tokens[index];
      if (!token) return [""];
      if (token.kana === "ん" && index === tokens.length - 1) {
        return token.options.filter(option => option !== "n");
      }
      if (!token.sokuon) return token.options;
      const next = tokens[index + 1];
      const doubled = next ? optionsForTokens(tokens, index + 1)
        .map(option => option[0])
        .filter(ch => /[bcdfghjklmpqrstvwxyz]/.test(ch))
        .map(ch => ch) : [];
      return Array.from(new Set([...doubled, ...token.options]));
    }

    function inputStatus(tokens, input) {
      const memo = new Map();
      function walk(tokenIndex, inputIndex, roman) {
        const key = `${tokenIndex}:${inputIndex}`;
        if (memo.has(key)) return null;
        if (tokenIndex >= tokens.length) {
          return inputIndex === input.length ? { complete: true, roman } : null;
        }
        for (const option of optionsForTokens(tokens, tokenIndex)) {
          const typedPart = input.slice(inputIndex, inputIndex + option.length);
          if (option.startsWith(typedPart)) {
            const nextRoman = roman + option;
            if (inputIndex + option.length > input.length) {
              return { complete: false, roman: nextRoman, next: option[input.length - inputIndex] || "" };
            }
            const result = walk(tokenIndex + 1, inputIndex + option.length, nextRoman);
            if (result) return result;
          }
        }
        memo.set(key, false);
        return null;
      }
      return walk(0, 0, "");
    }

    function rankWeightsForWave(wave) {
      return config.rankWeights.find(item => wave < item.beforeWave).weights;
    }

    function chooseRank(weights) {
      const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
      let roll = Math.random() * total;
      for (const [rank, weight] of Object.entries(weights)) {
        roll -= weight;
        if (roll <= 0) return rank;
      }
      return "easy";
    }

    function hasSimilarVisiblePrefix(word, prefixLength = 3) {
      const prefix = word.kana.slice(0, prefixLength);
      if (prefix.length < prefixLength) return false;
      return state.enemies.some(enemy => {
        if (enemy.isBoss) return false;
        return enemy.word.kana.slice(0, prefixLength) === prefix;
      });
    }

    function reduceSimilarPrefixes(pool) {
      const strict = pool.filter(word => !hasSimilarVisiblePrefix(word, 3));
      if (strict.length > 0) return strict;

      const loose = pool.filter(word => !hasSimilarVisiblePrefix(word, 2));
      return loose.length > 0 ? loose : pool;
    }

    function pickWord() {
      const rank = chooseRank(rankWeightsForWave(state.wave));
      const pool = words.filter(word => word.rank === rank);
      const source = reduceSimilarPrefixes(pool.length > 0 ? pool : words);
      const base = source[Math.floor(Math.random() * source.length)];
      return { ...base, tokens: tokenizeKana(base.kana) };
    }

    function pickBossWord() {
      const base = bossWords[Math.floor(Math.random() * bossWords.length)];
      return { ...base, tokens: tokenizeKana(base.kana) };
    }

    function isBossWave(wave) {
      return wave > 0 && wave % config.bossWaveInterval === 0;
    }

    function hasBoss() {
      return state.enemies.some(enemy => enemy.isBoss && !enemy.exiting);
    }

    function killsRequiredForWave(wave) {
      return config.wave.baseKills + Math.min(config.wave.extraKillsCap, Math.floor(wave / config.wave.extraKillsEvery));
    }

    function chooseEnemyLane(rect) {
      const minY = 80;
      const maxY = minY + Math.max(80, rect.height - 180);
      let bestLane = minY + Math.random() * (maxY - minY);
      let bestScore = -Infinity;
      const activeEnemies = state.enemies.filter(enemy => !enemy.isBoss && !enemy.exiting);

      for (let i = 0; i < 8; i += 1) {
        const lane = minY + Math.random() * (maxY - minY);
        const nearest = activeEnemies.reduce((min, enemy) => Math.min(min, Math.abs(enemy.y - lane)), Infinity);
        const edgePenalty = Math.min(Math.abs(lane - minY), Math.abs(maxY - lane)) * 0.08;
        const score = (Number.isFinite(nearest) ? nearest : 120) + edgePenalty;
        if (score > bestScore) {
          bestScore = score;
          bestLane = lane;
        }
      }

      return bestLane;
    }

    function spawnEnemy() {
      const rect = canvas.getBoundingClientRect();
      const word = pickWord();
      const lane = chooseEnemyLane(rect);
      const baseSpeed = config.enemy.baseSpeed + state.wave * config.enemy.waveSpeed + Math.random() * config.enemy.randomSpeed;
      const longWordSlowdown = Math.min(
        config.enemy.longWordMaxSlowdown,
        Math.max(0, word.kana.length - config.enemy.longWordThreshold) * config.enemy.longWordSlowdownPerChar
      );
      const speed = baseSpeed * (1 - longWordSlowdown);
      state.enemies.push({
        id: state.nextId++,
        x: rect.width + 70,
        y: lane,
        r: 22 + Math.min(7, word.kana.length * 1.1),
        speed,
        hp: word.kana.length,
        word,
        isBoss: false,
        born: performance.now()
      });
    }

    function spawnBoss() {
      const rect = canvas.getBoundingClientRect();
      const word = pickBossWord();
      if (hasBoss()) return;
      const targetY = rect.height * .46;
      // Boss time uses the old right-to-left travel speed only; do not apply word-length slowdown.
      const referenceSpeed = config.boss.baseReferenceSpeed + state.wave * config.boss.waveReferenceSpeed;
      const travelDistance = rect.width * .62 - 30;
      const timeLimit = Math.max(config.boss.minTimeLimit, travelDistance / referenceSpeed);
      state.enemies.push({
        id: state.nextId++,
        x: rect.width * .62,
        y: -110,
        targetY,
        r: 58,
        speed: 0,
        enterSpeed: config.boss.enterSpeed,
        timeLimit,
        timeLeft: timeLimit,
        hp: word.kana.length,
        word,
        isBoss: true,
        entering: true,
        bossSpriteIndex: (Math.floor(state.wave / config.bossWaveInterval) - 1) % sprites.bosses.length,
        born: performance.now()
      });
    }

    function scheduleInitialEnemies(wave) {
      const count = Math.min(3, 1 + wave);
      const firstDelay = config.transition.initialSpawnFirstMin + Math.random() * config.transition.initialSpawnFirstRandom;
      state.spawnQueue = Array.from({ length: count }, (_, index) => ({
        time: firstDelay + index * (config.transition.initialSpawnGapMin + Math.random() * config.transition.initialSpawnGapRandom)
      }));
    }

    function startBossTransition() {
      let hasExitingEnemies = false;
      for (const enemy of state.enemies) {
        if (enemy.isBoss) continue;
        enemy.exiting = true;
        enemy.exitTime = 0;
        enemy.exitDuration = config.transition.bossExitMin + Math.random() * config.transition.bossExitRandom;
        enemy.exitDrift = (Math.random() - .5) * 24;
        enemy.exitRetreat = 18 + Math.random() * 18;
        hasExitingEnemies = true;
      }
      state.bossSpawnDelay = hasExitingEnemies ? config.transition.bossSpawnDelayWithExit : config.transition.bossSpawnDelayEmpty;
    }

    function nextSpawnDelay() {
      return Math.max(
        config.enemy.spawnMin,
        config.enemy.spawnBase - state.wave * config.enemy.spawnWaveReduction + Math.random() * config.enemy.spawnRandom
      );
    }

    function titleHtml() {
      const best = loadBestResult();
      const bestLine = best ? `<div class="best-line">Best Score ${best.score} / Wave ${best.wave}</div>` : "";
      return `
        <p>スペースキーか Start で開始。敵の下に出ている日本語をローマ字で入力すると、自機が撃ちます。</p>
        ${bestLine}
        <div class="help-list">
          <div>Space: Start / Pause</div>
          <div>Backspace: ターゲット解除</div>
          <div>Esc: リセット</div>
        </div>
      `;
    }

    function pauseHtml() {
      return `
        <p>スペースキーか Start で再開できます。</p>
        <div class="help-list">
          <div>Backspace: ターゲット解除</div>
          <div>Esc: リセット</div>
        </div>
      `;
    }

    function loadBestResult() {
      try {
        return JSON.parse(localStorage.getItem(BEST_RESULT_KEY) || "null");
      } catch (error) {
        return null;
      }
    }

    function saveBestResult(result) {
      const previous = loadBestResult();
      const isBest = !previous || result.score > previous.score;
      const best = isBest ? result : previous;
      localStorage.setItem(BEST_RESULT_KEY, JSON.stringify(best));
      return { ...best, isNew: isBest };
    }

    function buildResult() {
      const inputs = state.correctCount + state.missCount;
      const accuracy = inputs > 0 ? Math.round(state.correctCount / inputs * 100) : 100;
      const seconds = state.startedAt && state.endedAt ? Math.max(0, Math.round((state.endedAt - state.startedAt) / 1000)) : 0;
      return {
        score: state.score,
        wave: state.wave,
        maxCombo: state.maxCombo,
        missCount: state.missCount,
        accuracy,
        enemiesDestroyed: state.enemiesDestroyed,
        bossesDestroyed: state.bossesDestroyed,
        seconds,
        date: new Date().toISOString()
      };
    }

    function resultHtml(result, best) {
      const bestText = best.isNew
        ? "New High Score"
        : `Best Score ${best.score} / Wave ${best.wave}`;
      return `
        <div class="result-grid">
          <div class="result-card"><span>Score</span><strong>${result.score}</strong></div>
          <div class="result-card"><span>Wave</span><strong>${result.wave}</strong></div>
          <div class="result-card"><span>Max Combo</span><strong>${result.maxCombo}</strong></div>
          <div class="result-card"><span>Accuracy</span><strong>${result.accuracy}%</strong></div>
          <div class="result-card"><span>Miss</span><strong>${result.missCount}</strong></div>
          <div class="result-card"><span>Destroyed</span><strong>${result.enemiesDestroyed}</strong></div>
        </div>
        <div class="best-line">${bestText}</div>
        <p>Reset か Start で再挑戦できます。</p>
      `;
    }

    function startGame() {
      unlockAudio();
      if (state.over) resetGame();
      state.title = false;
      state.running = true;
      if (!state.startedAt) state.startedAt = performance.now();
      overlay.hidden = true;
      if (sound) sound.playBgm();
      if (state.enemies.length === 0) {
        beginWave(state.wave);
      }
    }

    function pauseGame() {
      state.running = false;
      if (sound) sound.stopBgm();
      overlayDialog.classList.remove("title-dialog");
      titleLogo.hidden = true;
      overlayTitle.textContent = "Paused";
      overlayText.innerHTML = pauseHtml();
      overlay.hidden = false;
    }

    function clearWaveBanner() {
      state.waveBannerTime = 0;
      state.waveBannerBoss = false;
      waveBanner.textContent = "";
      waveBanner.classList.remove("is-visible", "is-boss");
    }

    function resetGame() {
      if (sound) sound.stopBgm({ reset: true });
      Object.assign(state, {
        running: false,
        over: false,
        score: 0,
        combo: 0,
        life: config.startingLife,
        wave: 1,
        killsInWave: 0,
        maxCombo: 0,
        missCount: 0,
        correctCount: 0,
        enemiesDestroyed: 0,
        bossesDestroyed: 0,
        startedAt: 0,
        endedAt: 0,
        enemies: [],
        bullets: [],
        particles: [],
        targetId: null,
        candidateIds: [],
        input: "",
        spawnTimer: 0,
        spawnQueue: [],
        bossSpawnDelay: 0,
        shake: 0,
        missFlash: 0,
        title: true,
        waveBannerTime: 0,
        waveBannerBoss: false
      });
      clearWaveBanner();
      overlayDialog.classList.add("title-dialog");
      titleLogo.hidden = false;
      overlayTitle.textContent = "Cosmo Kana Blaster";
      overlayText.innerHTML = titleHtml();
      overlay.hidden = false;
      updateHud();
    }

    function gameOver() {
      if (sound) sound.playGameOver();
      if (sound) sound.stopBgm({ reset: true });
      state.running = false;
      state.over = true;
      state.endedAt = performance.now();
      const result = buildResult();
      const best = saveBestResult(result);
      overlayDialog.classList.remove("title-dialog");
      titleLogo.hidden = true;
      overlayTitle.textContent = "Game Over";
      overlayText.innerHTML = resultHtml(result, best);
      overlay.hidden = false;
    }

    function showWaveBanner(text, isBoss) {
      state.waveBannerTime = isBoss ? config.wave.bannerSeconds.boss : config.wave.bannerSeconds.normal;
      state.waveBannerBoss = isBoss;
      waveBanner.textContent = text;
      waveBanner.classList.toggle("is-boss", isBoss);
      waveBanner.classList.add("is-visible");
    }

    function beginWave(wave) {
      state.wave = wave;
      state.killsInWave = 0;
      state.targetId = null;
      state.candidateIds = [];
      state.input = "";
      state.spawnQueue = [];
      state.spawnTimer = isBossWave(wave) ? 999 : .25;
      showWaveBanner(isBossWave(wave) ? `Boss Wave ${wave}` : `Wave ${wave}`, isBossWave(wave));
      if (isBossWave(wave)) {
        startBossTransition();
      } else if (state.enemies.length === 0) {
        scheduleInitialEnemies(wave);
      }
      updateHud();
    }

    function advanceWave() {
      beginWave(state.wave + 1);
    }

    function syncTargetState() {
      state.candidateIds = state.candidateIds.filter(id => state.enemies.some(enemy => enemy.id === id && !enemy.entering && !enemy.exiting));

      if (state.targetId && !state.enemies.some(enemy => enemy.id === state.targetId && !enemy.entering && !enemy.exiting)) {
        state.targetId = null;
      }

      if (!state.targetId && state.candidateIds.length === 1) {
        state.targetId = state.candidateIds[0];
      }

      if (state.targetId) {
        state.candidateIds = [state.targetId];
      }
    }

    function currentTarget() {
      syncTargetState();
      return state.enemies.find(enemy => enemy.id === state.targetId) || null;
    }

    function matchingEnemies(input) {
      return state.enemies
        .slice()
        .sort((a, b) => a.x - b.x)
        .filter(enemy => !enemy.entering && !enemy.exiting)
        .filter(enemy => inputStatus(enemy.word.tokens, input));
    }

    function setInputCandidates(input) {
      const candidates = matchingEnemies(input);
      if (candidates.length === 0) return null;

      state.input = input;
      state.candidateIds = candidates.map(enemy => enemy.id);
      if (candidates.length === 1) {
        state.targetId = candidates[0].id;
        state.candidateIds = [state.targetId];
      } else {
        state.targetId = null;
      }

      return candidates;
    }

    function fireAt(enemy) {
      const rect = canvas.getBoundingClientRect();
      state.bullets.push({
        x: 156,
        y: rect.height * .52,
        tx: enemy.x,
        ty: enemy.y,
        enemyId: enemy.id,
        t: 0,
        duration: 180
      });
    }

    function explode(x, y, color = "#ffcf5a") {
      for (let i = 0; i < 24; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 180;
        state.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: .45 + Math.random() * .35,
          maxLife: .8,
          color
        });
      }
      state.shake = 8;
    }

    function comboScoreBonus(combo) {
      if (combo <= 0) return 0;
      return Math.floor(Math.pow(combo, config.score.comboPower) * config.score.comboScale);
    }

    function waveScoreBonus(wave) {
      return Math.floor(Math.max(0, wave - 1) / config.score.waveBonusEvery);
    }

    function defeatScore(enemy, combo) {
      const characterScore = enemy.word.kana.length * config.score.characterPoint;
      const bossBonus = enemy.isBoss ? config.score.bossBonus : 0;
      return characterScore + bossBonus + comboScoreBonus(combo) + waveScoreBonus(state.wave);
    }

    function showScorePop(amount) {
      if (!scorePopEl || amount === 0) return;
      scorePopEl.textContent = amount > 0 ? `+${amount}` : String(amount);
      scorePopEl.classList.toggle("is-minus", amount < 0);
      scorePopEl.classList.remove("is-visible");
      void scorePopEl.offsetWidth;
      scorePopEl.classList.add("is-visible");
    }

    function destroyTarget(enemy) {
      if (sound) sound.playDestroy();
      const wasBoss = enemy.isBoss;
      fireAt(enemy);
      const scoreGain = defeatScore(enemy, state.combo);
      state.score += scoreGain;
      showScorePop(scoreGain);
      state.combo += 1;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.enemiesDestroyed += 1;
      if (wasBoss) state.bossesDestroyed += 1;
      state.enemies = state.enemies.filter(item => item.id !== enemy.id);
      state.targetId = null;
      state.candidateIds = [];
      state.input = "";
      setTimeout(() => explode(enemy.x, enemy.y), 120);
      if (wasBoss) {
        advanceWave();
      } else {
        state.killsInWave += 1;
        if (state.killsInWave >= killsRequiredForWave(state.wave)) advanceWave();
      }
      updateHud();
    }

    function handleTyping(key) {
      if (!state.running || state.over || key.length !== 1) return;
      const char = key.toLowerCase();
      let target = currentTarget();
      if (!target) {
        const candidates = setInputCandidates(state.input + char);
        if (!candidates) {
          registerMiss();
          return;
        }
        target = currentTarget();
      } else {
        const nextInput = state.input + char;
        if (inputStatus(target.word.tokens, nextInput)) {
          state.input = nextInput;
          state.candidateIds = [target.id];
        } else {
          registerMiss();
          return;
        }
      }

      if (sound) sound.playCorrect();
      state.correctCount += 1;
      const completeCandidates = matchingEnemies(state.input)
        .filter(enemy => inputStatus(enemy.word.tokens, state.input)?.complete);
      if (completeCandidates.length >= 1) {
        destroyTarget(completeCandidates[0]);
      }
      updateHud();
    }

    function registerMiss() {
      if (sound) sound.playMiss();
      state.missCount += 1;
      const penalty = Math.min(config.score.missPenalty, state.score);
      state.score = Math.max(0, state.score - config.score.missPenalty);
      if (penalty > 0) showScorePop(-penalty);
      state.combo = 0;
      state.missFlash = .18;
      targetKanaEl.classList.remove("miss");
      void targetKanaEl.offsetWidth;
      targetKanaEl.classList.add("miss");
      updateHud();
    }

    function updateHud() {
      syncTargetState();
      scoreEl.textContent = String(state.score);
      comboEl.textContent = String(state.combo);
      lifeEl.textContent = String(state.life);
      waveEl.textContent = String(state.wave);
      const target = currentTarget();
      if (!target) {
        if (state.input && state.candidateIds.length > 0) {
          renderCandidateList();
          return;
        }
        targetKanaEl.textContent = state.running ? "ターゲット未選択" : "待機中";
        targetRomanEl.textContent = "";
        return;
      }
      renderTargetText(target);
    }

    function renderCandidateList() {
      const candidates = state.enemies.filter(enemy => state.candidateIds.includes(enemy.id));
      const candidate = candidates[0];

      if (!candidate) {
        targetKanaEl.textContent = "候補を選択中";
        targetRomanEl.innerHTML = `<span class="typed">${escapeHtml(state.input)}</span>`;
        return;
      }

      renderTargetText(candidate);
    }

    function renderTargetText(target) {
      if (target.word.ruby) {
        targetKanaEl.innerHTML = rubyHtml(target.word.ruby);
      } else {
        targetKanaEl.textContent = target.word.text;
      }
      const roman = fullRomanForInput(target.word.tokens, state.input);
      const typed = state.input.length;
      targetRomanEl.innerHTML =
        `<span class="typed">${escapeHtml(roman.slice(0, typed))}</span>` +
        `<span class="next">${escapeHtml(roman.slice(typed, typed + 1))}</span>` +
        `${escapeHtml(roman.slice(typed + 1))}`;
    }

    function fullRomanForInput(tokens, input) {
      function compatible(roman) {
        return input.startsWith(roman) || roman.startsWith(input);
      }

      function walk(index, roman) {
        if (!compatible(roman)) return null;
        if (index >= tokens.length) return roman.startsWith(input) ? roman : null;
        for (const option of optionsForTokens(tokens, index)) {
          const result = walk(index + 1, roman + option);
          if (result) return result;
        }
        return null;
      }

      return walk(0, "") || tokens.map((_, index) => optionsForTokens(tokens, index)[0]).join("");
    }

    function rubyHtml(parts) {
      return parts.map(([text, reading]) => {
        if (!reading) return escapeHtml(text);
        return `<ruby>${escapeHtml(text)}<rt>${escapeHtml(reading)}</rt></ruby>`;
      }).join("");
    }

    function escapeHtml(value) {
      return value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[ch]));
    }

    function update(dt) {
      const rect = canvas.getBoundingClientRect();
      const hadSpawnQueue = state.spawnQueue.length > 0;
      if (hadSpawnQueue && !isBossWave(state.wave)) {
        for (const item of state.spawnQueue) {
          item.time -= dt;
        }
        const ready = state.spawnQueue.filter(item => item.time <= 0);
        state.spawnQueue = state.spawnQueue.filter(item => item.time > 0);
        for (const item of ready) {
          spawnEnemy();
        }
        if (state.spawnQueue.length === 0) {
          state.spawnTimer = nextSpawnDelay();
        }
      }

      if (isBossWave(state.wave) && !hasBoss()) {
        state.bossSpawnDelay = Math.max(0, state.bossSpawnDelay - dt);
        const hasExitingEnemies = state.enemies.some(enemy => enemy.exiting);
        if (state.bossSpawnDelay <= 0 && !hasExitingEnemies) {
          spawnBoss();
        }
      }

      state.spawnTimer -= dt;
      if (!isBossWave(state.wave) && !hadSpawnQueue && state.spawnQueue.length === 0 && state.spawnTimer <= 0) {
        spawnEnemy();
        state.spawnTimer = nextSpawnDelay();
      }

      for (const star of state.stars) {
        star.x -= star.speed * dt;
        if (star.x < -4) {
          star.x = rect.width + 4;
          star.y = Math.random() * rect.height;
        }
      }

      for (const enemy of state.enemies) {
        if (enemy.exiting) {
          enemy.exitTime += dt;
          enemy.x += enemy.exitRetreat * dt;
          enemy.y += enemy.exitDrift * dt;
        } else if (enemy.entering) {
          enemy.y = Math.min(enemy.targetY, enemy.y + enemy.enterSpeed * dt);
          if (enemy.y >= enemy.targetY) {
            enemy.y = enemy.targetY;
            enemy.entering = false;
          }
        } else {
          enemy.x -= enemy.speed * dt;
          if (enemy.isBoss) {
            enemy.timeLeft -= dt;
          }
        }
      }
      state.enemies = state.enemies.filter(enemy => !enemy.exiting || enemy.exitTime < enemy.exitDuration);

      const escaped = state.enemies.filter(enemy => !enemy.entering && !enemy.exiting && (enemy.x < 30 || (enemy.isBoss && enemy.timeLeft <= 0)));
      if (escaped.length) {
        if (sound) sound.playDamage();
        state.life -= escaped.length;
        state.combo = 0;
        const escapedIds = new Set(escaped.map(enemy => enemy.id));
        state.enemies = state.enemies.filter(enemy => !escapedIds.has(enemy.id));
        state.targetId = null;
        state.candidateIds = [];
        state.input = "";
        state.shake = 12;
        updateHud();
        if (state.life <= 0) gameOver();
        else if (isBossWave(state.wave) && !hasBoss()) spawnBoss();
      }

      for (const bullet of state.bullets) {
        bullet.t += dt * 1000 / bullet.duration;
      }
      state.bullets = state.bullets.filter(bullet => bullet.t < 1.2);

      for (const particle of state.particles) {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 120 * dt;
        particle.life -= dt;
      }
      state.particles = state.particles.filter(particle => particle.life > 0);
      state.shake = Math.max(0, state.shake - 28 * dt);
      state.missFlash = Math.max(0, state.missFlash - dt);
      state.waveBannerTime = Math.max(0, state.waveBannerTime - dt);
      if (state.waveBannerTime <= 0) {
        waveBanner.classList.remove("is-visible");
      }
    }

    function drawShip(x, y) {
      const sprite = sprites.player;
      if (sprite.complete && sprite.naturalWidth > 0) {
        const width = 154;
        const height = width * sprite.naturalHeight / sprite.naturalWidth;
        ctx.save();
        ctx.shadowColor = "rgba(77, 228, 195, .5)";
        ctx.shadowBlur = 14;
        ctx.drawImage(sprite, x - width * .48, y - height / 2, width, height);
        ctx.restore();
        return;
      }

      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = "#ccefeb";
      ctx.strokeStyle = "#4de4c3";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(46, 0);
      ctx.lineTo(-28, -25);
      ctx.lineTo(-16, -6);
      ctx.lineTo(-46, 0);
      ctx.lineTo(-16, 6);
      ctx.lineTo(-28, 25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffcf5a";
      ctx.fillRect(28, -5, 22, 10);
      ctx.fillStyle = "rgba(77, 228, 195, .65)";
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawSpriteCentered(image, x, y, width, pulseScale = 1) {
      if (!image || !image.complete || image.naturalWidth <= 0) return false;
      const drawWidth = width * pulseScale;
      const drawHeight = drawWidth * image.naturalHeight / image.naturalWidth;
      ctx.drawImage(image, x - drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight);
      return true;
    }

    function labelMetrics(enemy) {
      ctx.save();
      ctx.font = `${enemy.isBoss ? 26 : 20}px 'Segoe UI', 'Yu Gothic UI', sans-serif`;
      const maxWidth = enemy.isBoss ? Math.min(560, canvas.getBoundingClientRect().width * .5) : 220;
      const measured = ctx.measureText(enemy.word.text);
      const textWidth = measured && measured.width ? measured.width : enemy.word.text.length * (enemy.isBoss ? 24 : 18);
      const width = Math.min(maxWidth, Math.max(enemy.isBoss ? 180 : 72, textWidth + 22));
      ctx.restore();
      return {
        width,
        height: enemy.isBoss ? 36 : 28,
        maxWidth
      };
    }

    function makeLabelBox(enemy, centerY, rect) {
      const metrics = labelMetrics(enemy);
      const minY = metrics.height / 2 + 8;
      const maxY = rect.height - metrics.height / 2 - 12;
      const y = Math.max(minY, Math.min(maxY, centerY));
      return {
        x: enemy.x - metrics.width / 2,
        y: y - metrics.height / 2,
        centerY: y,
        width: metrics.width,
        height: metrics.height,
        maxWidth: metrics.maxWidth
      };
    }

    function overlapArea(a, b) {
      const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      return x * y;
    }

    function layoutEnemyLabels(rect) {
      const layouts = new Map();
      const placed = [];
      const enemies = state.enemies.filter(enemy => !enemy.entering && !enemy.exiting).slice().sort((a, b) => a.x - b.x);

      for (const enemy of enemies) {
        const desiredY = enemy.y + enemy.r + (enemy.isBoss ? 42 : 30);
        const offsets = enemy.isBoss ? [0, -44, 44, -76, 76] : [0, -30, 30, -58, 58, -86, 86];
        let best = null;
        let bestCost = Infinity;

        for (const offset of offsets) {
          const box = makeLabelBox(enemy, desiredY + offset, rect);
          let cost = Math.abs(box.centerY - desiredY) * 5;
          for (const other of placed) {
            cost += overlapArea(box, other) * 80;
          }
          if (cost < bestCost) {
            best = box;
            bestCost = cost;
          }
        }

        layouts.set(enemy.id, best);
        placed.push(best);
      }

      return layouts;
    }

    function drawEnemy(enemy, isTarget, isCandidate, labelBox) {
      const pulse = Math.sin(performance.now() / 140 + enemy.id) * 2;
      const sprite = enemy.isBoss
        ? sprites.bosses[enemy.bossSpriteIndex % sprites.bosses.length]
        : sprites.enemy;
      const spriteWidth = enemy.isBoss ? 210 : 74;
      const haloWidth = enemy.isBoss ? 190 : 68;
      const haloHeight = enemy.isBoss ? 80 : 34;
      const exitRatio = enemy.exiting ? Math.max(0, 1 - enemy.exitTime / enemy.exitDuration) : 1;

      ctx.save();
      ctx.globalAlpha = (isTarget ? .72 : (isCandidate ? .45 : .18)) * exitRatio;
      ctx.strokeStyle = isTarget ? "#fff0b8" : (isCandidate ? "#ffcf5a" : "rgba(255, 107, 115, .7)");
      ctx.lineWidth = isTarget || isCandidate ? 3 : 1.5;
      ctx.beginPath();
      ctx.ellipse(enemy.x, enemy.y + 4, haloWidth / 2 + pulse, haloHeight / 2 + pulse * .35, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = exitRatio;
      ctx.shadowColor = enemy.isBoss ? "rgba(255, 107, 115, .35)" : "rgba(255, 88, 160, .32)";
      ctx.shadowBlur = enemy.isBoss ? 18 : 9;
      const drewSprite = drawSpriteCentered(sprite, enemy.x, enemy.y, spriteWidth, 1 + Math.max(0, pulse) * .002);
      ctx.restore();

      if (!drewSprite) {
        ctx.save();
        ctx.globalAlpha = exitRatio;
        ctx.translate(enemy.x, enemy.y);
        ctx.fillStyle = enemy.isBoss ? "#773342" : (isTarget ? "#ffcf5a" : (isCandidate ? "#ff9e64" : "#ff6b73"));
        ctx.strokeStyle = enemy.isBoss ? "#fff0b8" : (isTarget ? "#fff0b8" : "#ffc1c5");
        ctx.lineWidth = enemy.isBoss || isTarget || isCandidate ? 4 : 2;
        ctx.beginPath();
        const points = enemy.isBoss ? 12 : 8;
        for (let i = 0; i < points; i += 1) {
          const a = i / points * Math.PI * 2;
          const r = enemy.r + pulse + (i % 2 ? 0 : enemy.isBoss ? 13 : 7);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      if (enemy.exiting) {
        return;
      }

      if (enemy.entering) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "700 18px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.fillStyle = "rgba(255, 207, 90, .86)";
        ctx.strokeStyle = "rgba(0,0,0,.55)";
        ctx.lineWidth = 4;
        ctx.strokeText("WARNING", enemy.x, enemy.y + enemy.r + 36);
        ctx.fillText("WARNING", enemy.x, enemy.y + enemy.r + 36);
        ctx.restore();
        return;
      }

      ctx.save();
      ctx.textAlign = "center";
      ctx.font = `${enemy.isBoss ? 26 : 20}px 'Segoe UI', 'Yu Gothic UI', sans-serif`;
      ctx.fillStyle = "#f4fffd";
      ctx.strokeStyle = "rgba(0,0,0,.65)";
      ctx.lineWidth = 4;
      const fallback = makeLabelBox(enemy, enemy.y + enemy.r + 30, canvas.getBoundingClientRect());
      const label = labelBox || fallback;
      const naturalY = enemy.y + enemy.r + (enemy.isBoss ? 42 : 30);

      if (Math.abs(label.centerY - naturalY) > 12) {
        ctx.strokeStyle = "rgba(244, 255, 253, .22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(enemy.x, enemy.y + enemy.r + 6);
        ctx.lineTo(enemy.x, label.centerY - label.height / 2 + 4);
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,.65)";
        ctx.lineWidth = 4;
      }

      ctx.strokeText(enemy.word.text, enemy.x, label.centerY + label.height * .24, label.maxWidth);
      ctx.fillText(enemy.word.text, enemy.x, label.centerY + label.height * .24, label.maxWidth);
      if (enemy.isBoss && typeof enemy.timeLeft === "number") {
        const ratio = Math.max(0, Math.min(1, enemy.timeLeft / enemy.timeLimit));
        const barWidth = 180;
        const barY = label.centerY + label.height * .24 + 16;
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(255,255,255,.14)";
        ctx.fillRect(enemy.x - barWidth / 2, barY, barWidth, 5);
        ctx.fillStyle = ratio < .25 ? "#ff6b73" : "#ffcf5a";
        ctx.fillRect(enemy.x - barWidth / 2, barY, barWidth * ratio, 5);
      }
      ctx.restore();
    }

    function draw() {
      const rect = canvas.getBoundingClientRect();
      const shakeX = state.shake ? (Math.random() - .5) * state.shake : 0;
      const shakeY = state.shake ? (Math.random() - .5) * state.shake : 0;
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.save();
      ctx.translate(shakeX, shakeY);

      ctx.fillStyle = "#071012";
      ctx.fillRect(-20, -20, rect.width + 40, rect.height + 40);
      for (const star of state.stars) {
        ctx.globalAlpha = star.alpha;
        ctx.fillStyle = "#d7fffa";
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const shipX = 120;
      const shipY = rect.height * .52;
      syncTargetState();
      const target = currentTarget();
      if (target) {
        ctx.strokeStyle = state.missFlash > 0 ? "rgba(255, 107, 115, .72)" : "rgba(77, 228, 195, .48)";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(shipX + 70, shipY);
        ctx.lineTo(target.x - target.r, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (state.input && state.candidateIds.length > 0) {
        ctx.strokeStyle = "rgba(255, 158, 100, .25)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 9]);
        for (const enemy of state.enemies) {
          if (!state.candidateIds.includes(enemy.id)) continue;
          ctx.beginPath();
          ctx.moveTo(shipX + 70, shipY);
          ctx.lineTo(enemy.x - enemy.r, enemy.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      drawShip(shipX, shipY);

      for (const bullet of state.bullets) {
        const t = Math.min(1, bullet.t);
        const x = bullet.x + (bullet.tx - bullet.x) * t;
        const y = bullet.y + (bullet.ty - bullet.y) * t;
        ctx.strokeStyle = "rgba(255, 207, 90, .45)";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(bullet.x, bullet.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = "#fff3b0";
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      const labelLayouts = layoutEnemyLabels(rect);
      for (const enemy of state.enemies) {
        drawEnemy(enemy, enemy.id === state.targetId, state.candidateIds.includes(enemy.id), labelLayouts.get(enemy.id));
      }

      for (const particle of state.particles) {
        ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = "rgba(255,255,255,.1)";
      ctx.fillRect(22, 0, 3, rect.height);
      ctx.fillStyle = "rgba(255, 107, 115, .16)";
      ctx.fillRect(0, 0, 24, rect.height);
      ctx.restore();
    }

    function loop(time) {
      const dt = Math.min(.033, (time - state.lastTime) / 1000 || 0);
      state.lastTime = time;
      if (state.running) update(dt);
      draw();
      requestAnimationFrame(loop);
    }

    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("keydown", event => {
      unlockAudio();
      if (event.key === " ") {
        event.preventDefault();
        state.running ? pauseGame() : startGame();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        resetGame();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        state.input = "";
        state.targetId = null;
        state.candidateIds = [];
        updateHud();
        return;
      }
      handleTyping(event.key);
    });
    startBtn.addEventListener("click", () => {
      unlockAudio();
      startGame();
    });
    resetBtn.addEventListener("click", resetGame);
    muteBtn.addEventListener("click", () => {
      if (sound) sound.toggleMute();
      updateMuteButton();
    });

    resizeCanvas();
    overlayText.innerHTML = titleHtml();
    updateHud();
    updateMuteButton();
    requestAnimationFrame(loop);
