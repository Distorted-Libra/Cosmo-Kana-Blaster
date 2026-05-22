(function () {
  "use strict";

  const STORAGE_KEY = "cosmo-kana-blaster-muted";
  const MASTER_VOLUME = 0.1;
  const BGM_SRC = "./assets/music/Asteroid_Lane.mp3";
  const BGM_VOLUME = 0.1;
  const BGM_FADE_IN_SECONDS = 1.2;
  const BGM_FADE_OUT_SECONDS = 0.75;
  const BGM_LOOP_FADE_SECONDS = 0.8;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  let audioContext = null;
  let masterGain = null;
  let bgm = null;
  let bgmFade = null;
  let bgmLoopWatch = null;
  let bgmLooping = false;
  let bgmWanted = false;
  let muted = localStorage.getItem(STORAGE_KEY) === "true";

  function initBgm() {
    if (bgm) return bgm;
    bgm = new Audio(BGM_SRC);
    bgm.loop = false;
    bgm.preload = "auto";
    bgm.volume = 0;
    bgm.load();
    return bgm;
  }

  function stopLoopWatch() {
    if (!bgmLoopWatch) return;
    cancelAnimationFrame(bgmLoopWatch);
    bgmLoopWatch = null;
  }

  function startLoopWatch() {
    stopLoopWatch();

    function watch() {
      const track = initBgm();
      if (!bgmWanted || muted || track.paused) {
        bgmLoopWatch = null;
        return;
      }

      if (
        Number.isFinite(track.duration) &&
        track.duration > BGM_LOOP_FADE_SECONDS + 0.5 &&
        track.duration - track.currentTime <= BGM_LOOP_FADE_SECONDS &&
        !bgmLooping
      ) {
        bgmLooping = true;
        fadeBgm(0, BGM_LOOP_FADE_SECONDS, {
          after: () => {
            if (!bgmWanted || muted) return;
            track.currentTime = 0;
            const playPromise = track.play();
            if (playPromise) playPromise.catch(() => {});
            fadeBgm(BGM_VOLUME, BGM_LOOP_FADE_SECONDS);
            bgmLooping = false;
            startLoopWatch();
          }
        });
        return;
      }

      bgmLoopWatch = requestAnimationFrame(watch);
    }

    bgmLoopWatch = requestAnimationFrame(watch);
  }

  function fadeBgm(targetVolume, seconds, { pause = false, reset = false, after = null } = {}) {
    const track = initBgm();
    if (bgmFade) cancelAnimationFrame(bgmFade);

    const startVolume = track.volume;
    const startedAt = performance.now();
    const duration = Math.max(0.01, seconds) * 1000;

    function step(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      track.volume = startVolume + (targetVolume - startVolume) * progress;

      if (progress < 1) {
        bgmFade = requestAnimationFrame(step);
        return;
      }

      track.volume = targetVolume;
      bgmFade = null;
      if (pause) track.pause();
      if (reset) track.currentTime = 0;
      if (after) after();
    }

    bgmFade = requestAnimationFrame(step);
  }

  function init() {
    initBgm();
    if (!AudioContextClass) return null;

    if (!audioContext) {
      audioContext = new AudioContextClass();
      masterGain = audioContext.createGain();
      masterGain.gain.value = muted ? 0 : MASTER_VOLUME;
      masterGain.connect(audioContext.destination);
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    return audioContext;
  }

  function setMuted(value) {
    muted = Boolean(value);
    localStorage.setItem(STORAGE_KEY, String(muted));
    if (masterGain) {
      const now = audioContext.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, now, 0.015);
    }
    if (muted) {
      stopLoopWatch();
      fadeBgm(0, 0.2, { pause: true });
    } else if (bgmWanted) {
      playBgm();
    }
  }

  function toggleMute() {
    init();
    setMuted(!muted);
    return muted;
  }

  function canPlay() {
    return init() && masterGain && !muted;
  }

  function playBgm() {
    bgmWanted = true;
    const track = initBgm();
    if (muted) return;
    if (bgmFade) cancelAnimationFrame(bgmFade);
    bgmFade = null;
    bgmLooping = false;

    const playPromise = track.play();
    if (playPromise) {
      playPromise
        .then(() => {
          if (bgmWanted && !muted) {
            fadeBgm(BGM_VOLUME, BGM_FADE_IN_SECONDS);
            startLoopWatch();
          }
        })
        .catch(() => {});
      return;
    }
    fadeBgm(BGM_VOLUME, BGM_FADE_IN_SECONDS);
    startLoopWatch();
  }

  function stopBgm({ reset = false } = {}) {
    bgmWanted = false;
    stopLoopWatch();
    bgmLooping = false;
    if (!bgm) return;
    fadeBgm(0, BGM_FADE_OUT_SECONDS, { pause: true, reset });
  }

  function tone({ frequency, endFrequency, duration, type = "sine", gain = 0.45, delay = 0 }) {
    if (!canPlay()) return;

    const now = audioContext.currentTime + delay;
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    }

    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(envelope);
    envelope.connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.025);
  }

  function noise({ duration, gain = 0.22, delay = 0, lowpass = 1800 }) {
    if (!canPlay()) return;

    const now = audioContext.currentTime + delay;
    const sampleRate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const envelope = audioContext.createGain();

    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.buffer = buffer;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(masterGain);
    source.start(now);
  }

  function playCorrect() {
    tone({ frequency: 720, endFrequency: 920, duration: 0.055, type: "triangle", gain: 0.22 });
  }

  function playMiss() {
    tone({ frequency: 180, endFrequency: 120, duration: 0.09, type: "square", gain: 0.18 });
    tone({ frequency: 130, endFrequency: 95, duration: 0.08, type: "square", gain: 0.13, delay: 0.07 });
  }

  function playDestroy() {
    tone({ frequency: 520, endFrequency: 980, duration: 0.11, type: "sawtooth", gain: 0.2 });
    tone({ frequency: 260, endFrequency: 190, duration: 0.16, type: "triangle", gain: 0.18, delay: 0.04 });
    noise({ duration: 0.16, gain: 0.16, lowpass: 2600, delay: 0.035 });
  }

  function playDamage() {
    tone({ frequency: 120, endFrequency: 72, duration: 0.22, type: "sawtooth", gain: 0.24 });
    noise({ duration: 0.12, gain: 0.12, lowpass: 900 });
  }

  function playGameOver() {
    tone({ frequency: 330, endFrequency: 260, duration: 0.18, type: "triangle", gain: 0.18 });
    tone({ frequency: 260, endFrequency: 196, duration: 0.2, type: "triangle", gain: 0.17, delay: 0.17 });
    tone({ frequency: 196, endFrequency: 110, duration: 0.34, type: "triangle", gain: 0.18, delay: 0.35 });
  }

  window.CosmoKanaBlasterSound = {
    init,
    isMuted: () => muted,
    setMuted,
    toggleMute,
    playBgm,
    stopBgm,
    playCorrect,
    playMiss,
    playDestroy,
    playDamage,
    playGameOver
  };
}());
