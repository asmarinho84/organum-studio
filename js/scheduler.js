/**
 * Organum Studio — agendador de execução (transporte).
 *
 * Usa o padrão "lookahead": um timer (Web Worker, imune ao throttling de abas em
 * segundo plano) acorda a cada ~25 ms e agenda, no relógio do AudioContext, tudo
 * que cairá nos próximos ~140 ms: notas, cliques do metrônomo e automação da
 * caixa expressiva. O resultado é tempo preciso (sem jitter de requestAnimationFrame),
 * ligaduras corretas, repetições de nota re‑articuladas, loop sem emendas,
 * contagem (count‑in) e treinador de andamento.
 *
 * A posição exibida na tela é DERIVADA do relógio de áudio (âncoras tempo→tempo
 * musical), nunca acumulada por dt — por isso não deriva nem pula notas.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});
  const Utils = Organum.Utils || (typeof require === 'function' ? require('./utils.js') : null);
  const Score = Organum.Score || (typeof require === 'function' ? require('./score.js') : null);
  const { clamp, mod } = Utils;

  const LOOKAHEAD = 0.14; // s agendados à frente
  const TICK_MS = 25; // intervalo do timer
  const START_DELAY = 0.06; // s entre o clique em Tocar e o primeiro som
  const MAX_LAG = 0.1; // s — acima disso, ressincroniza em vez de "rajada" de notas
  const EPS = 1e-9;
  const NOTE_GAP = 0.004; // s — micro‑pausa para soltar antes de re‑articular
  const BREATH_GAP = 0.3; // tempos de silêncio na respiração (vírgula)
  const FERMATA_FACTOR = 2; // nota com fermata soa o dobro do valor
  const FROZEN_SPB = 1e9; // âncora que congela o cursor durante a fermata

  const noop = () => {};

  /** Timer baseado em Web Worker; recai em setInterval se Worker/Blob falharem. */
  function createWorkerTimer(fn, ms) {
    let worker = null;
    let intervalId = null;
    return {
      start() {
        this.stop();
        try {
          const src = `let t=null;onmessage=function(e){clearInterval(t);t=null;if(e.data==='start'){t=setInterval(function(){postMessage(0)},${ms});}};`;
          const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
          worker = new Worker(url);
          URL.revokeObjectURL(url);
          worker.onmessage = fn;
          worker.onerror = () => {
            if (worker) { worker.terminate(); worker = null; }
            if (!intervalId) intervalId = setInterval(fn, ms);
          };
          worker.postMessage('start');
        } catch (e) {
          worker = null;
          intervalId = setInterval(fn, ms);
        }
      },
      stop() {
        if (worker) {
          try { worker.postMessage('stop'); worker.terminate(); } catch (e) { /* ok */ }
          worker = null;
        }
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      },
    };
  }

  class Scheduler {
    /**
     * @param {object} o
     * @param {object} o.synth      PipeOrganSynth (ensureContext, scheduleNote, setExpression, cancelScheduled)
     * @param {object} o.metronome  Metronome (scheduleClick, beatsPerBar, subdivision, trainer)
     * @param {Function} o.getScore  () => partitura atual
     * @param {Function} o.getBpm    () => BPM atual
     * @param {Function} o.setBpm    (bpm) => aplica novo BPM (treinador de andamento)
     * @param {Function} o.onFrame   ({beat, rawBeat, beatIndex, beatInBar, countingIn, mode}) a cada frame
     * @param {Function} o.onFinish  () => fim natural da partitura
     * @param {Function} o.onStateChange ({running, mode})
     */
    constructor(o) {
      this.synth = o.synth;
      this.metronome = o.metronome;
      this.getScore = o.getScore;
      this.getBpm = () => clamp(Number(o.getBpm()) || 72, 20, 300);
      this.setBpm = o.setBpm || noop;
      this.onFrame = o.onFrame || noop;
      this.onFinish = o.onFinish || noop;
      this.onStateChange = o.onStateChange || noop;
      this._createTimer = o.createTimer || createWorkerTimer;
      this._raf = o.raf || (typeof root.requestAnimationFrame === 'function' ? root.requestAnimationFrame.bind(root) : (f) => setTimeout(f, 16));
      this._caf = o.caf || (typeof root.cancelAnimationFrame === 'function' ? root.cancelAnimationFrame.bind(root) : clearTimeout);

      this.running = false;
      this.mode = 'idle'; // 'idle' | 'score' | 'metronome'
      this._timer = null;
      this._rafId = null;
      this._frame = this._frame.bind(this);
    }

    // ------------------------------------------------------------------ início

    /**
     * @param {object} [opts]
     * @param {'score'|'metronome'} [opts.mode]  'score' toca a partitura; 'metronome' só os cliques
     * @param {number} [opts.fromBeat]           posição inicial (tempos) no modo 'score'
     * @param {boolean} [opts.click]             clique junto com a partitura
     * @param {number} [opts.countInBars]        compassos de contagem antes da partitura
     * @param {boolean} [opts.loop]              repetir ao chegar ao fim
     */
    start(opts) {
      const { mode = 'score', fromBeat = 0, click = false, countInBars = 0, loop = false } = opts || {};
      this._halt(false);

      const ctx = this.synth.ensureContext();
      this.ctx = ctx;
      this.mode = mode;
      this.playNotes = mode === 'score';
      this.click = mode === 'metronome' ? true : !!click;
      this.loop = this.playNotes && !!loop;

      this.score = this.playNotes ? this.getScore() : null;
      this.sounding = this.playNotes ? Score.resolveTies(this.score.notes).sounding : [];
      this.endBeat = this.playNotes ? this.score.measures * Score.beatsPerMeasure(this.score) : Infinity;
      this._buildHolds(Number(fromBeat) || 0);

      let start = this.playNotes ? Number(fromBeat) || 0 : 0;
      if (start < 0 || start >= this.endBeat - EPS) start = 0;
      this.scoreStart = start;

      const countInBeats = this.playNotes && countInBars > 0 ? countInBars * this.metronome.beatsPerBar : 0;
      this.cursorBeat = start - countInBeats;
      this.cursorTime = ctx.currentTime + START_DELAY;
      this.clickOrigin = countInBeats > 0 ? this.cursorBeat : 0;
      this.trainerOrigin = this.playNotes ? start : 0;
      this._lastTrainerK = 0;
      this._partialDone = !this.playNotes;
      this._finished = false;
      this._endTime = 0;

      const spb = 60 / this.getBpm();
      this.anchors = [{ time: this.cursorTime, beat: this.cursorBeat, spb }];

      this.running = true;
      this._timer = this._createTimer(() => this._pump(), TICK_MS);
      this._pump();
      this._timer.start();
      this._rafId = this._raf(this._frame);
      this.onStateChange({ running: true, mode: this.mode });
    }

    /** Relê a partitura durante a execução (edições passam a valer à frente do cursor). */
    refreshScore() {
      if (!this.running || !this.playNotes) return;
      this.score = this.getScore();
      this.sounding = Score.resolveTies(this.score.notes).sounding;
      this.endBeat = this.score.measures * Score.beatsPerMeasure(this.score);
    }

    // ------------------------------------------------------------------- parada

    /** Pausa e devolve a posição (tempos) onde parou. */
    pause() {
      if (!this.running) return this.scoreStart || 0;
      const beat = this.mode === 'score' ? this.getPosition().beat : 0;
      this._halt(true);
      return beat;
    }

    stop() {
      this._halt(true);
    }

    _halt(notify) {
      const wasRunning = this.running;
      this.running = false;
      this.mode = 'idle';
      if (this._timer) {
        this._timer.stop();
        this._timer = null;
      }
      if (this._rafId !== null) {
        this._caf(this._rafId);
        this._rafId = null;
      }
      if (wasRunning) this.synth.cancelScheduled();
      if (notify && wasRunning) this.onStateChange({ running: false, mode: 'idle' });
    }

    _complete() {
      this._halt(true);
      this.onFinish();
    }

    // ----------------------------------------------------------------- posição

    _latency() {
      const c = this.ctx;
      return (c && (c.outputLatency || c.baseLatency)) || 0;
    }

    /** Posição musical atual (compensando a latência de saída de áudio). */
    getPosition() {
      const t = this.ctx.currentTime - this._latency();
      let a = this.anchors[0];
      for (let i = this.anchors.length - 1; i >= 0; i--) {
        if (this.anchors[i].time <= t) {
          a = this.anchors[i];
          break;
        }
      }
      let raw = a.beat + Math.max(0, t - a.time) / a.spb;
      if (this._finished) raw = Math.min(raw, this.endBeat);
      const countingIn = this.playNotes && raw < this.scoreStart - EPS;
      const beat = this.playNotes ? Math.max(raw, this.scoreStart) : raw;
      const beatIndex = Math.floor(raw - this.clickOrigin + EPS);
      return {
        beat,
        rawBeat: raw,
        countingIn,
        beatIndex,
        beatInBar: mod(beatIndex, this.metronome.beatsPerBar),
        mode: this.mode,
      };
    }

    _frame() {
      if (!this.running) return;
      this.onFrame(this.getPosition());
      this._rafId = this._raf(this._frame);
    }

    // ---------------------------------------------------------------- agendador

    _pump() {
      if (!this.running) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;

      if (this._finished) {
        if (now >= this._endTime) this._complete();
        return;
      }

      // Thread travada (aba congelada, GC): em vez de tocar tudo de uma vez, pula à frente.
      if (this.cursorTime < now - MAX_LAG) {
        const spb = 60 / this.getBpm();
        this.cursorBeat += (now - this.cursorTime) / spb;
        this.cursorTime = now;
        this.anchors.push({ time: this.cursorTime, beat: this.cursorBeat, spb });
      }

      const horizon = now + LOOKAHEAD;
      let guard = 0;
      while (this.cursorTime < horizon && !this._finished && guard++ < 128) {
        this._applyTrainerIfDue();
        const spb = 60 / this.getBpm();
        const last = this.anchors[this.anchors.length - 1];
        if (Math.abs(last.spb - spb) > 1e-12) {
          this.anchors.push({ time: this.cursorTime, beat: this.cursorBeat, spb });
        }

        let endBeat = this.cursorBeat + (horizon - this.cursorTime) / spb;
        const boundary = this._nextTrainerBoundary();
        if (boundary !== null && boundary < endBeat) endBeat = boundary;
        const hold = this.holds[this.holdIdx];
        if (hold && hold.at > this.cursorBeat + EPS && hold.at < endBeat) endBeat = hold.at;
        let reachedEnd = false;
        if (endBeat >= this.endBeat - EPS) {
          endBeat = this.endBeat;
          reachedEnd = true;
        }
        if (endBeat <= this.cursorBeat + EPS && !reachedEnd) break;

        if (endBeat > this.cursorBeat) {
          this._scheduleRange(this.cursorBeat, endBeat, this.cursorTime, spb);
          this.cursorTime += (endBeat - this.cursorBeat) * spb;
          this.cursorBeat = endBeat;
        }
        this._applyHold(spb);
        if (reachedEnd) this._handleEnd(spb);
      }

      // Descarta âncoras antigas (mantém ≥ 1).
      const keepFrom = now - 3;
      while (this.anchors.length > 2 && this.anchors[1].time < keepFrom) this.anchors.shift();
    }

    /** Fermatas: pontos (fim da nota sustentada) onde o tempo para por `extra` tempos. */
    _buildHolds(fromBeat) {
      const map = new Map();
      if (this.playNotes) {
        for (const n of Score.resolveTies(this.score.notes).sounding) {
          if (!n.fermataExtra) continue;
          const at = Math.round((n.startBeat + n.duration) * 1000) / 1000;
          map.set(at, Math.max(map.get(at) || 0, n.fermataExtra * (FERMATA_FACTOR - 1)));
        }
      }
      this.holds = [...map.entries()].map(([at, extra]) => ({ at, extra })).sort((x, y) => x.at - y.at);
      this.breaths = this.playNotes && Array.isArray(this.score.breaths) ? this.score.breaths : [];
      this.holdIdx = 0;
      while (this.holds[this.holdIdx] && this.holds[this.holdIdx].at <= fromBeat + EPS) this.holdIdx++;
    }

    _applyHold(spb) {
      const h = this.holds[this.holdIdx];
      if (!h || Math.abs(this.cursorBeat - h.at) > EPS) return;
      this.holdIdx++;
      // âncora "congelada": o cursor visual fica parado durante a pausa
      this.anchors.push({ time: this.cursorTime, beat: h.at, spb: FROZEN_SPB });
      this.cursorTime += h.extra * spb;
      this.anchors.push({ time: this.cursorTime, beat: h.at, spb });
    }

    _handleEnd(spb) {
      if (this.loop) {
        this.cursorBeat = 0;
        this.scoreStart = 0;
        this.clickOrigin = 0;
        this.trainerOrigin = 0;
        this._lastTrainerK = 0;
        this._partialDone = true;
        this.holdIdx = 0;
        this.anchors.push({ time: this.cursorTime, beat: 0, spb });
      } else {
        this._finished = true;
        this._endTime = this.cursorTime;
      }
    }

    // --- treinador de andamento (aumenta o BPM a cada N compassos) ---

    _trainerActive() {
      const tr = this.metronome.trainer;
      return this.click && tr && tr.enabled;
    }

    _trainerPeriod() {
      return this.metronome.beatsPerBar * this.metronome.trainer.everyBars;
    }

    _applyTrainerIfDue() {
      if (!this._trainerActive()) return;
      const rel = this.cursorBeat - this.trainerOrigin;
      if (rel < EPS) return;
      const period = this._trainerPeriod();
      const k = Math.round(rel / period);
      if (k <= this._lastTrainerK || Math.abs(rel - k * period) > 1e-6) return;
      this._lastTrainerK = k;
      const tr = this.metronome.trainer;
      const cur = this.getBpm();
      if (cur >= tr.maxBpm) return;
      this.setBpm(Math.min(tr.maxBpm, cur + tr.step));
    }

    _nextTrainerBoundary() {
      if (!this._trainerActive()) return null;
      if (this.getBpm() >= this.metronome.trainer.maxBpm) return null;
      const period = this._trainerPeriod();
      const rel = this.cursorBeat - this.trainerOrigin;
      const k = Math.floor(rel / period + 1e-9) + 1;
      return this.trainerOrigin + Math.max(1, k) * period;
    }

    // --- agenda tudo que cai em [b0, b1) tempos, a partir do instante t0 ---

    _scheduleRange(b0, b1, t0, spb) {
      const m = this.metronome;

      // Cliques do metrônomo
      const sub = m.subdivision;
      const kStart = Math.ceil((b0 - this.clickOrigin) * sub - EPS);
      const kEnd = Math.ceil((b1 - this.clickOrigin) * sub - EPS);
      for (let k = kStart; k < kEnd; k++) {
        const pos = this.clickOrigin + k / sub;
        const inCountIn = this.playNotes && pos < this.scoreStart - EPS;
        if (!this.click && !inCountIn) continue;
        const beatIdx = Math.floor(k / sub);
        m.scheduleClick(t0 + (pos - b0) * spb, mod(beatIdx, m.beatsPerBar), mod(k, sub));
      }

      if (!this.playNotes) return;

      // Notas que já estavam soando ao iniciar no meio da peça
      if (!this._partialDone && b1 > this.scoreStart - EPS) {
        this._partialDone = true;
        const when = t0 + Math.max(0, this.scoreStart - b0) * spb;
        for (const n of this.sounding) {
          const end = n.startBeat + n.duration;
          if (n.startBeat < this.scoreStart - EPS && end > this.scoreStart + EPS) {
            this.synth.scheduleNote(n.midi, n.voice, when, (end - this.scoreStart) * spb - NOTE_GAP);
          }
        }
      }

      // Notas que começam neste intervalo (nunca na contagem)
      for (const n of this.sounding) {
        if (n.startBeat >= b0 - EPS && n.startBeat < b1 - EPS && n.startBeat >= this.scoreStart - EPS) {
          const when = t0 + (n.startBeat - b0) * spb;
          // Notas que atravessam uma fermata (inclusive as marcadas) sustentam durante a pausa.
          let len = n.duration;
          for (const h of this.holds) if (h.at > n.startBeat + EPS && h.at <= n.startBeat + n.duration + EPS) len += h.extra;
          // Respiração (vírgula): a nota que termina nela solta um pouco antes.
          const end = n.startBeat + n.duration;
          if (this.breaths.some((b) => Math.abs(b - end) < 0.02)) len -= Math.min(BREATH_GAP, n.duration * 0.4);
          this.synth.scheduleNote(n.midi, n.voice, when, len * spb - NOTE_GAP);
        }
      }

      // Automação da caixa expressiva (dinâmicas da partitura)
      if (b1 > this.scoreStart) {
        const mid = Math.max(this.scoreStart, (b0 + b1) / 2);
        this.synth.setExpression(Score.getDynamicAtBeat(this.score.dynamics, mid).value, t0);
      }
    }
  }

  Scheduler.createWorkerTimer = createWorkerTimer;
  Scheduler.constants = { LOOKAHEAD, TICK_MS, START_DELAY };

  Organum.Scheduler = Scheduler;
  if (typeof module !== 'undefined' && module.exports) module.exports = Scheduler;
})(typeof window !== 'undefined' ? window : globalThis);
