/**
 * Organum Studio — Modo Ensino (prática guiada passo a passo).
 *
 * Máquina de estados sem DOM: a interface lê `view()` e reage a `onChange`.
 * Cada passo agrupa as notas que começam no mesmo tempo; o passo avança quando
 * todas foram tocadas (mouse, toque, teclado do PC ou MIDI). Notas ligadas por
 * ligadura de prolongamento NÃO são pedidas de novo.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});
  const Score = Organum.Score || (typeof require === 'function' ? require('./score.js') : null);

  const ADVANCE_DELAY_MS = 420;

  class Tutor {
    /**
     * @param {object} o
     * @param {Function} o.getScore   () => partitura atual
     * @param {Function} o.onChange   () => a interface deve re-renderizar
     * @param {Function} o.onStep     (step) => novo passo carregado (posiciona cursor/pedal)
     * @param {Function} o.onComplete ({hits, misses, accuracy}) => lição concluída
     * @param {Function} [o.setTimeout] injeção para testes
     */
    constructor(o) {
      this.getScore = o.getScore;
      this.onChange = o.onChange || (() => {});
      this.onStep = o.onStep || (() => {});
      this.onComplete = o.onComplete || (() => {});
      this._setTimeout = o.setTimeout || ((fn, ms) => setTimeout(fn, ms));
      this._clearTimeout = o.clearTimeout || ((id) => clearTimeout(id));

      this.active = false;
      this.steps = [];
      this.stepIndex = 0;
      this.satisfied = new Set();
      this.advancing = false;
      this.hits = 0;
      this.misses = 0;
      this._timer = null;
    }

    start() {
      this.active = true;
      this.rebuild();
    }

    stop() {
      this.active = false;
      this._cancelTimer();
      this.steps = [];
      this.satisfied.clear();
      this.advancing = false;
      this.onChange();
    }

    /** Recalcula os passos (após editar a partitura) e volta ao início. */
    rebuild() {
      this._cancelTimer();
      this.steps = Score.buildTutorSteps(this.getScore());
      this.stepIndex = 0;
      this.hits = 0;
      this.misses = 0;
      this._loadStep();
    }

    currentStep() {
      return this.steps[this.stepIndex] || null;
    }

    skip() {
      if (!this.active || this.steps.length === 0) return;
      this._cancelTimer();
      this.stepIndex++;
      this._loadStep();
    }

    _cancelTimer() {
      if (this._timer !== null) {
        this._clearTimeout(this._timer);
        this._timer = null;
      }
    }

    _loadStep() {
      this.satisfied.clear();
      this.advancing = false;
      if (this.steps.length === 0) {
        this.onChange();
        return;
      }
      if (this.stepIndex >= this.steps.length) {
        const total = this.hits + this.misses;
        const stats = { hits: this.hits, misses: this.misses, accuracy: total ? this.hits / total : 1 };
        this.stepIndex = 0;
        this.hits = 0;
        this.misses = 0;
        this.onComplete(stats);
      }
      this.onStep(this.steps[this.stepIndex]);
      this.onChange();
    }

    /**
     * Processa uma tecla tocada.
     * @returns {'hit'|'miss'|'ignored'}
     */
    handleInput(division, midi) {
      if (!this.active || this.advancing) return 'ignored';
      const step = this.currentStep();
      if (!step) return 'ignored';

      const match = step.notes.find((n) => !this.satisfied.has(n.id) && n.voice === division && n.midi === midi);
      if (!match) {
        // Re-tocar uma nota já feita neste passo não conta como erro.
        const already = step.notes.some((n) => this.satisfied.has(n.id) && n.voice === division && n.midi === midi);
        if (already) return 'ignored';
        this.misses++;
        this.onChange();
        return 'miss';
      }

      this.satisfied.add(match.id);
      this.hits++;
      this.onChange();

      if (step.notes.every((n) => this.satisfied.has(n.id))) {
        this.advancing = true;
        this._timer = this._setTimeout(() => {
          this._timer = null;
          if (!this.active) return;
          this.stepIndex++;
          this._loadStep();
        }, ADVANCE_DELAY_MS);
      }
      return 'hit';
    }

    /** Dados para a interface. */
    view() {
      const total = this.steps.length;
      const step = this.currentStep();
      return {
        active: this.active,
        total,
        index: this.stepIndex,
        pct: total ? Math.round((this.stepIndex / total) * 100) : 0,
        step,
        satisfied: this.satisfied,
        hits: this.hits,
        misses: this.misses,
      };
    }

    /** Teclas ainda pendentes no passo atual: Map keyId -> pedalTech|null. */
    pendingTargets() {
      const out = new Map();
      const step = this.active ? this.currentStep() : null;
      if (!step) return out;
      for (const n of step.notes) {
        if (!this.satisfied.has(n.id)) out.set(`${n.voice}:${n.midi}`, n.pedalTech || null);
      }
      return out;
    }
  }

  Organum.Tutor = Tutor;
  if (typeof module !== 'undefined' && module.exports) module.exports = Tutor;
})(typeof window !== 'undefined' ? window : globalThis);
