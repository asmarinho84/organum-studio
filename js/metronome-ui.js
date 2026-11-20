/**
 * Organum Studio — interface do metrônomo (painel).
 * Liga os controles do DOM ao motor `Metronome` e ao andamento global.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});
  const Utils = Organum.Utils || (typeof require === 'function' ? require('./utils.js') : null);
  const Metronome = Organum.Metronome || (typeof require === 'function' ? require('./metronome.js') : null);
  const { clamp, tempoMarking, computeTapTempo } = Utils;
  const { LIMITS, SOUNDS, SUBDIVISIONS } = Metronome;

  const LEVEL_LABEL = { accent: 'acento', normal: 'normal', soft: 'suave', mute: 'mudo' };
  const $ = (id) => document.getElementById(id);

  class MetronomeUI {
    /**
     * @param {object} o
     * @param {Metronome} o.metronome
     * @param {Function} o.getBpm      () => BPM atual
     * @param {Function} o.setBpm      (bpm) => aplica (e propaga) o novo BPM
     * @param {Function} o.onToggle    () => inicia/para o metrônomo avulso
     * @param {Function} o.onChange    () => configuração mudou (persistir)
     */
    constructor(o) {
      this.m = o.metronome;
      this.getBpm = o.getBpm;
      this.setBpm = o.setBpm;
      this.onToggle = o.onToggle;
      this.onChange = o.onChange || (() => {});
      this.taps = [];
      this._lastBeatIndex = null;
      this._statusText = '';
      this.els = {};
    }

    init() {
      const e = (this.els = {
        toggle: $('metroToggle'),
        tap: $('metroTap'),
        down: $('metroBpmDown'),
        up: $('metroBpmUp'),
        value: $('metroBpmValue'),
        term: $('metroTerm'),
        slider: $('metroBpmSlider'),
        beats: $('metroBeats'),
        sub: $('metroSubdivision'),
        sound: $('metroSound'),
        volume: $('metroVolume'),
        countIn: $('metroCountIn'),
        withScore: $('metroWithScore'),
        trainer: $('metroTrainer'),
        step: $('trainerStep'),
        every: $('trainerEvery'),
        max: $('trainerMax'),
        dots: $('metroDots'),
        status: $('metroStatus'),
      });

      for (let i = LIMITS.minBeats; i <= LIMITS.maxBeats; i++) e.beats.add(new Option(String(i), String(i)));
      for (const [v, label] of Object.entries(SUBDIVISIONS)) e.sub.add(new Option(label, v));
      for (const [v, label] of Object.entries(SOUNDS)) e.sound.add(new Option(label, v));

      this._bindBpm();
      this._bindOptions();
      this.refreshFromConfig();
      this.syncBpm(this.getBpm());
    }

    // ------------------------------------------------------------------ BPM

    _bindBpm() {
      const { slider, value, up, down, tap, toggle } = this.els;

      slider.addEventListener('input', () => this.setBpm(Number(slider.value)));
      const commit = () => {
        const v = Number(value.value);
        if (Number.isFinite(v) && value.value !== '') this.setBpm(v);
        else this.syncBpm(this.getBpm());
      };
      value.addEventListener('change', commit);
      value.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          commit();
          value.blur();
        }
      });
      value.addEventListener('wheel', (ev) => {
        if (document.activeElement !== value) return;
        ev.preventDefault();
        this.setBpm(this.getBpm() + (ev.deltaY < 0 ? 1 : -1));
      }, { passive: false });

      // Botões −/+ com repetição ao segurar (Shift = passos de 5).
      const repeater = (btn, dir) => {
        let delay = null;
        let timer = null;
        const step = (shift) => this.setBpm(this.getBpm() + dir * (shift ? 5 : 1));
        const stop = () => {
          clearTimeout(delay);
          clearInterval(timer);
          delay = timer = null;
        };
        btn.addEventListener('pointerdown', (ev) => {
          if (ev.pointerType === 'mouse' && ev.button !== 0) return;
          ev.preventDefault();
          step(ev.shiftKey);
          delay = setTimeout(() => { timer = setInterval(() => step(ev.shiftKey), 70); }, 420);
        });
        ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((t) => btn.addEventListener(t, stop));
        btn.addEventListener('click', (ev) => {
          if (ev.detail === 0) step(ev.shiftKey); // ativação por teclado (Enter/Espaço)
        });
      };
      repeater(down, -1);
      repeater(up, +1);

      toggle.addEventListener('click', () => this.onToggle());

      tap.addEventListener('click', () => {
        const now = performance.now();
        this.taps.push(now);
        if (this.taps.length > 16) this.taps.shift();
        const bpm = computeTapTempo(this.taps);
        if (bpm !== null) this.setBpm(bpm);
        tap.classList.add('active');
        setTimeout(() => tap.classList.remove('active'), 90);
      });
    }

    /** Reflete o BPM nos controles do painel. */
    syncBpm(bpm) {
      const { value, slider, term } = this.els;
      if (document.activeElement !== value) value.value = String(bpm);
      slider.value = String(bpm);
      term.textContent = tempoMarking(bpm);
    }

    // ------------------------------------------------------- outras opções

    _bindOptions() {
      const m = this.m;
      const e = this.els;

      e.beats.addEventListener('change', () => {
        m.setBeatsPerBar(e.beats.value);
        this.renderDots();
        this.onChange();
      });
      e.sub.addEventListener('change', () => {
        m.setSubdivision(e.sub.value);
        this.onChange();
      });
      e.sound.addEventListener('change', () => {
        m.setSound(e.sound.value);
        m.preview(true);
        this.onChange();
      });
      e.volume.addEventListener('input', () => m.setVolume(Number(e.volume.value) / 100));
      e.volume.addEventListener('change', () => {
        m.preview(false);
        this.onChange();
      });
      e.countIn.addEventListener('change', () => {
        m.setCountInBars(e.countIn.value);
        this.onChange();
      });
      e.withScore.addEventListener('change', () => {
        m.clickWithPlayback = e.withScore.checked;
        this.onChange();
      });

      e.trainer.addEventListener('change', () => {
        m.setTrainer({ enabled: e.trainer.checked });
        this._syncTrainerFields();
        this.onChange();
      });
      const trainerField = (input, key, lo, hi) => input.addEventListener('change', () => {
        const v = clamp(Math.round(Number(input.value) || lo), lo, hi);
        input.value = String(v);
        m.setTrainer({ [key]: v });
        this.onChange();
      });
      trainerField(e.step, 'step', 1, 50);
      trainerField(e.every, 'everyBars', 1, 32);
      trainerField(e.max, 'maxBpm', LIMITS.minBpm, LIMITS.maxBpm);

      e.dots.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.beat-dot');
        if (!btn) return;
        m.cycleAccent(Number(btn.dataset.index));
        this._paintDot(btn);
        this.onChange();
      });
    }

    _syncTrainerFields() {
      const on = this.m.trainer.enabled;
      for (const input of [this.els.step, this.els.every, this.els.max]) input.disabled = !on;
    }

    /** Recarrega todos os controles a partir da configuração do motor. */
    refreshFromConfig() {
      const m = this.m;
      const e = this.els;
      e.beats.value = String(m.beatsPerBar);
      e.sub.value = String(m.subdivision);
      e.sound.value = m.sound;
      e.volume.value = String(Math.round(m.volume * 100));
      e.countIn.value = String(m.countInBars);
      e.withScore.checked = m.clickWithPlayback;
      e.trainer.checked = m.trainer.enabled;
      e.step.value = String(m.trainer.step);
      e.every.value = String(m.trainer.everyBars);
      e.max.value = String(m.trainer.maxBpm);
      this._syncTrainerFields();
      this.renderDots();
    }

    // -------------------------------------------------------- tempos (pontos)

    renderDots() {
      const { dots } = this.els;
      dots.textContent = '';
      this.m.accents.forEach((_, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'beat-dot';
        b.dataset.index = String(i);
        b.textContent = String(i + 1);
        this._paintDot(b);
        dots.appendChild(b);
      });
      this._lastBeatIndex = null;
    }

    _paintDot(btn) {
      const i = Number(btn.dataset.index);
      const level = this.m.accents[i];
      btn.dataset.level = level;
      btn.setAttribute('aria-label', `Tempo ${i + 1}: ${LEVEL_LABEL[level]} (clique para alternar)`);
    }

    // ------------------------------------------------------------ execução

    setRunning(running) {
      const { toggle } = this.els;
      toggle.textContent = running ? '⏹ Parar' : '▶ Iniciar';
      toggle.classList.toggle('btn-primary', !running);
      toggle.classList.toggle('btn-danger', running);
      if (!running) this.clearFlash();
    }

    /** Chamado a cada frame com a posição do agendador. */
    onFrame(info, standalone) {
      const dots = this.els.dots.children;
      if (info.beatIndex !== this._lastBeatIndex) {
        const prev = this.els.dots.querySelector('.current');
        if (prev) prev.classList.remove('current');
        const cur = dots[info.beatInBar];
        if (cur) cur.classList.add('current');
        this._lastBeatIndex = info.beatIndex;
      }

      let text = '';
      if (info.countingIn) text = `Contagem… ${info.beatInBar + 1}`;
      else if (standalone) text = `${this.m.beatsPerBar} tempos • ${this.getBpm()} BPM`;
      this._setStatus(text, info.countingIn);
    }

    clearFlash() {
      const prev = this.els.dots && this.els.dots.querySelector('.current');
      if (prev) prev.classList.remove('current');
      this._lastBeatIndex = null;
      this._setStatus('', false);
    }

    _setStatus(text, counting) {
      if (text === this._statusText) return;
      this._statusText = text;
      this.els.status.textContent = text;
      this.els.status.classList.toggle('counting', !!counting);
    }
  }

  Organum.MetronomeUI = MetronomeUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = MetronomeUI;
})(typeof window !== 'undefined' ? window : globalThis);
