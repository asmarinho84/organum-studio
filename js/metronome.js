/**
 * Organum Studio — metrônomo profissional (motor de cliques + configuração).
 *
 * Este módulo só sabe SINTETIZAR e CONFIGURAR cliques. Quem decide QUANDO tocar é
 * o Scheduler (scheduler.js), que usa o relógio do AudioContext com lookahead —
 * assim o clique fica sample‑accurate e travado com a execução da partitura.
 *
 * Recursos: compasso 1–16 tempos, subdivisão (1/2/3/4 por tempo), padrão de
 * acentos por tempo (acento/normal/suave/mudo), 4 timbres, volume, contagem
 * (count‑in) e treinador de andamento (aumento gradual de BPM).
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});
  const Utils = Organum.Utils || (typeof require === 'function' ? require('./utils.js') : null);
  const { clamp } = Utils;

  const ACCENT_CYCLE = Object.freeze(['accent', 'normal', 'soft', 'mute']);
  const LEVEL_GAIN = Object.freeze({ accent: 1.0, normal: 0.68, soft: 0.36, mute: 0 });
  const SUB_GAIN = 0.26; // cliques de subdivisão (entre os tempos)

  const SOUNDS = Object.freeze({
    click: 'Clique eletrônico',
    wood: 'Bloco de madeira',
    beep: 'Bipe',
    hat: 'Chimbal',
  });

  const SUBDIVISIONS = Object.freeze({
    1: 'Sem subdivisão (1 por tempo)',
    2: 'Colcheias (2 por tempo)',
    3: 'Tercinas (3 por tempo)',
    4: 'Semicolcheias (4 por tempo)',
  });

  const LIMITS = Object.freeze({
    minBpm: 20,
    maxBpm: 300,
    minBeats: 1,
    maxBeats: 16,
    maxCountIn: 4,
  });

  /** Frequências (Hz) por camada de intensidade, para cada timbre. */
  const PITCHES = Object.freeze({
    click: { accent: 2600, normal: 1900, soft: 1500, sub: 1300 },
    wood: { accent: 1250, normal: 940, soft: 780, sub: 700 },
    beep: { accent: 1760, normal: 1320, soft: 990, sub: 880 },
    hat: { accent: 9000, normal: 8000, soft: 7000, sub: 7000 },
  });

  class Metronome {
    /** @param {{ensureContext: Function}} synth fornece o AudioContext compartilhado */
    constructor(synth) {
      this.synth = synth;
      this.beatsPerBar = 4;
      this.subdivision = 1;
      this.accents = ['accent', 'normal', 'normal', 'normal'];
      this.sound = 'click';
      this.volume = 0.7; // 0–1
      this.countInBars = 0; // compassos de contagem antes da partitura
      this.clickWithPlayback = false; // clique durante a execução da partitura
      this.trainer = { enabled: false, step: 4, everyBars: 4, maxBpm: 160 };

      this._out = null;
      this._noise = null;
      this._ctx = null;
    }

    // ------------------------------------------------------------ configuração

    setBeatsPerBar(n) {
      const beats = clamp(Math.round(Number(n) || 4), LIMITS.minBeats, LIMITS.maxBeats);
      const next = [];
      for (let i = 0; i < beats; i++) {
        next.push(this.accents[i] || (i === 0 ? 'accent' : 'normal'));
      }
      this.beatsPerBar = beats;
      this.accents = next;
    }

    setSubdivision(n) {
      const v = Math.round(Number(n));
      this.subdivision = v >= 1 && v <= 4 ? v : 1;
    }

    setSound(name) {
      if (Object.prototype.hasOwnProperty.call(SOUNDS, name)) this.sound = name;
    }

    setVolume(v) {
      this.volume = clamp(Number(v) || 0, 0, 1);
      if (this._out) this._out.gain.setTargetAtTime(this._outputLevel(), this._ctx.currentTime, 0.01);
    }

    cycleAccent(beatIndex) {
      if (beatIndex < 0 || beatIndex >= this.beatsPerBar) return this.accents[beatIndex];
      const cur = ACCENT_CYCLE.indexOf(this.accents[beatIndex]);
      this.accents[beatIndex] = ACCENT_CYCLE[(cur + 1) % ACCENT_CYCLE.length];
      return this.accents[beatIndex];
    }

    resetAccents() {
      this.accents = Array.from({ length: this.beatsPerBar }, (_, i) => (i === 0 ? 'accent' : 'normal'));
    }

    setCountInBars(n) {
      this.countInBars = clamp(Math.round(Number(n) || 0), 0, LIMITS.maxCountIn);
    }

    setTrainer(partial) {
      const t = this.trainer;
      if (typeof partial.enabled === 'boolean') t.enabled = partial.enabled;
      if (partial.step !== undefined) t.step = clamp(Math.round(Number(partial.step) || 1), 1, 50);
      if (partial.everyBars !== undefined) t.everyBars = clamp(Math.round(Number(partial.everyBars) || 1), 1, 32);
      if (partial.maxBpm !== undefined) t.maxBpm = clamp(Math.round(Number(partial.maxBpm) || 120), LIMITS.minBpm, LIMITS.maxBpm);
    }

    /** Configuração serializável (para localStorage). */
    toJSON() {
      return {
        beatsPerBar: this.beatsPerBar,
        subdivision: this.subdivision,
        accents: this.accents.slice(),
        sound: this.sound,
        volume: this.volume,
        countInBars: this.countInBars,
        clickWithPlayback: this.clickWithPlayback,
        trainer: { ...this.trainer },
      };
    }

    /** Aplica uma configuração salva, validando cada campo. */
    applyConfig(cfg) {
      if (!cfg || typeof cfg !== 'object') return;
      if (cfg.beatsPerBar !== undefined) this.setBeatsPerBar(cfg.beatsPerBar);
      if (Array.isArray(cfg.accents)) {
        this.accents = this.accents.map((cur, i) => (ACCENT_CYCLE.includes(cfg.accents[i]) ? cfg.accents[i] : cur));
      }
      if (cfg.subdivision !== undefined) this.setSubdivision(cfg.subdivision);
      if (cfg.sound !== undefined) this.setSound(cfg.sound);
      if (cfg.volume !== undefined) this.volume = clamp(Number(cfg.volume) || 0, 0, 1);
      if (cfg.countInBars !== undefined) this.setCountInBars(cfg.countInBars);
      if (typeof cfg.clickWithPlayback === 'boolean') this.clickWithPlayback = cfg.clickWithPlayback;
      if (cfg.trainer && typeof cfg.trainer === 'object') this.setTrainer(cfg.trainer);
    }

    // ----------------------------------------------------------------- áudio

    _outputLevel() {
      return this.volume * this.volume; // curva quadrática: mais resolução em volumes baixos
    }

    _ensureGraph() {
      const ctx = this.synth.ensureContext();
      if (this._ctx !== ctx) {
        this._ctx = ctx;
        this._out = ctx.createGain();
        this._out.gain.value = this._outputLevel();
        this._out.connect(ctx.destination);
        this._noise = this._createNoiseBuffer(ctx);
      }
      return ctx;
    }

    _createNoiseBuffer(ctx) {
      const length = Math.floor(ctx.sampleRate * 0.25);
      const buf = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    }

    /** Ganho relativo (0–1) de um clique; 0 = silêncio. */
    levelGain(beatInBar, sub) {
      if (sub > 0) return SUB_GAIN;
      return LEVEL_GAIN[this.accents[beatInBar]] ?? LEVEL_GAIN.normal;
    }

    /** Camada tímbrica do clique: accent | normal | soft | sub. */
    tierFor(beatInBar, sub) {
      if (sub > 0) return 'sub';
      return this.accents[beatInBar] || 'normal';
    }

    /**
     * Agenda um clique em `time` (tempo do AudioContext).
     * @param {number} beatInBar índice do tempo no compasso (0‑based)
     * @param {number} sub índice da subdivisão (0 = no tempo)
     */
    scheduleClick(time, beatInBar, sub) {
      const gain = this.levelGain(beatInBar, sub);
      if (gain <= 0) return;
      this._ensureGraph();
      this._voice(time, gain, this.tierFor(beatInBar, sub));
    }

    /** Toca um clique de teste imediatamente (ex.: ao trocar de timbre). */
    preview(accent) {
      const ctx = this._ensureGraph();
      this._voice(ctx.currentTime + 0.01, 1, accent ? 'accent' : 'normal');
    }

    _voice(t, level, tier) {
      const ctx = this._ctx;
      const freq = PITCHES[this.sound][tier] || PITCHES[this.sound].normal;
      const out = this._out;
      const g = ctx.createGain();
      g.connect(out);
      const cleanup = (src) => {
        src.onended = () => {
          try { src.disconnect(); } catch (e) { /* ok */ }
          try { g.disconnect(); } catch (e) { /* ok */ }
        };
      };

      switch (this.sound) {
        case 'wood': {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(freq * 1.6, t);
          o.frequency.exponentialRampToValueAtTime(freq, t + 0.012);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(level, t + 0.0015);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
          o.connect(g);
          o.start(t);
          o.stop(t + 0.1);
          cleanup(o);
          break;
        }
        case 'beep': {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(level * 0.8, t + 0.004);
          g.gain.setValueAtTime(level * 0.8, t + 0.045);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
          o.connect(g);
          o.start(t);
          o.stop(t + 0.09);
          cleanup(o);
          break;
        }
        case 'hat': {
          const n = ctx.createBufferSource();
          n.buffer = this._noise;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = freq - 2500;
          const decay = tier === 'accent' ? 0.07 : 0.032;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(level * 0.9, t + 0.001);
          g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
          n.connect(hp);
          hp.connect(g);
          n.start(t);
          n.stop(t + decay + 0.02);
          n.onended = () => {
            try { n.disconnect(); hp.disconnect(); g.disconnect(); } catch (e) { /* ok */ }
          };
          break;
        }
        case 'click':
        default: {
          // Transiente de ruído + tom curto: estalo nítido, bom para estudo.
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.setValueAtTime(freq, t);
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = freq;
          bp.Q.value = 1.2;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(level * 0.55, t + 0.0008);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
          o.connect(bp);
          bp.connect(g);
          o.start(t);
          o.stop(t + 0.04);
          o.onended = () => {
            try { o.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) { /* ok */ }
          };
          break;
        }
      }
    }
  }

  Metronome.ACCENT_CYCLE = ACCENT_CYCLE;
  Metronome.SOUNDS = SOUNDS;
  Metronome.SUBDIVISIONS = SUBDIVISIONS;
  Metronome.LIMITS = LIMITS;

  Organum.Metronome = Metronome;
  if (typeof module !== 'undefined' && module.exports) module.exports = Metronome;
})(typeof window !== 'undefined' ? window : globalThis);
