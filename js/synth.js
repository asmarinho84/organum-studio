/**
 * Organum Studio — sintetizador de órgão de tubos (Web Audio API).
 *
 * Duas formas de tocar:
 *  - ao vivo:     noteOn(keyId, …) / noteOff(keyId)           (teclas, MIDI)
 *  - agendado:    scheduleNote(midi, division, when, dur)      (execução da partitura)
 *
 * Cadeia: vozes → filtro/ganho da caixa expressiva → (seco + reverb) →
 *         compressor → volume geral → saída.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});
  const Utils = Organum.Utils || (typeof require === 'function' ? require('./utils.js') : null);
  const { clamp, midiToFrequency } = Utils;

  const ATTACK = 0.028; // s — ataque rápido de tubo
  const RELEASE_TAU = 0.022; // s — constante de tempo do decaimento
  const RELEASE_TAIL = RELEASE_TAU * 9; // s — quando parar os osciladores
  const MAX_VOICES = 96;

  function defaultStops() {
    return [
      { id: 'subbass16', name: "Subbass 16'", short: "16'", active: true, mult: 0.5, type: 'triangle', gain: 0.34 },
      { id: 'principal8', name: "Principal 8'", short: "8'", active: true, mult: 1.0, type: 'sawtooth', gain: 0.22, filterHz: 1900 },
      { id: 'flauta8', name: "Flauta Doce 8'", short: "8'F", active: true, mult: 1.0, type: 'sine', gain: 0.3 },
      { id: 'oitava4', name: "Oitava 4'", short: "4'", active: true, mult: 2.0, type: 'triangle', gain: 0.18 },
      { id: 'quinta223', name: "Quinta 2 2/3'", short: "2⅔'", active: false, mult: 3.0, type: 'sine', gain: 0.12 },
      { id: 'superoitava2', name: "Superoitava 2'", short: "2'", active: false, mult: 4.0, type: 'triangle', gain: 0.11 },
      { id: 'trompete8', name: "Trompete 8'", short: "TR8'", active: false, mult: 1.0, type: 'sawtooth', gain: 0.24, filterHz: 3200, resonance: 3.5 },
      { id: 'tremulante', name: 'Tremulante', short: 'TRM', active: false, isTremulant: true },
    ];
  }

  class PipeOrganSynth {
    constructor() {
      this.ctx = null;
      this.swellFilter = null;
      this.swellGain = null;
      this.reverbNode = null;
      this.masterGain = null;
      this.tremulantOsc = null;
      this.tremulantGain = null;
      this.tremulantDetune = null;

      this.expression = 0.65; // 0.05–1.0 (abertura da caixa expressiva)
      this.masterVolume = 0.9;
      this.activeVoices = new Map(); // keyId -> voz (ao vivo)
      this.scheduledVoices = new Set(); // vozes agendadas pela partitura
      this.stops = defaultStops();
    }

    /** Cria o AudioContext sob demanda (precisa de gesto do usuário) e o retoma. */
    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = root.AudioContext || root.webkitAudioContext;
        if (!AudioCtx) throw new Error('Web Audio API não suportada neste navegador.');
        this.ctx = new AudioCtx({ latencyHint: 'interactive' });
        this._buildGraph();
      }
      if (this.ctx.state === 'suspended') {
        const p = this.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      return this.ctx;
    }

    _buildGraph() {
      const ctx = this.ctx;

      this.swellFilter = ctx.createBiquadFilter();
      this.swellFilter.type = 'lowpass';
      this.swellFilter.Q.value = 0.8;
      this.swellGain = ctx.createGain();

      this.reverbNode = ctx.createConvolver();
      this.reverbNode.buffer = this._createCathedralImpulse(1.9, 2.6);
      const reverbWet = ctx.createGain();
      reverbWet.gain.value = 0.26;
      const dryGain = ctx.createGain();
      dryGain.gain.value = 0.85;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 12;
      limiter.ratio.value = 4;
      limiter.attack.value = 0.005;
      limiter.release.value = 0.15;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;

      this.swellFilter.connect(this.swellGain);
      this.swellGain.connect(dryGain);
      this.swellGain.connect(this.reverbNode);
      this.reverbNode.connect(reverbWet);
      dryGain.connect(limiter);
      reverbWet.connect(limiter);
      limiter.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);

      // LFO do tremulante (5,2 Hz): modula o ganho da caixa e a afinação das vozes.
      this.tremulantOsc = ctx.createOscillator();
      this.tremulantOsc.frequency.value = 5.2;
      this.tremulantGain = ctx.createGain();
      this.tremulantGain.gain.value = 0;
      this.tremulantDetune = ctx.createGain();
      this.tremulantDetune.gain.value = 0;
      this.tremulantOsc.connect(this.tremulantGain);
      this.tremulantOsc.connect(this.tremulantDetune);
      this.tremulantGain.connect(this.swellGain.gain);
      this.tremulantOsc.start();

      this.setExpression(this.expression);
      this._updateTremulantState();
    }

    _createCathedralImpulse(durationSec, decayRate) {
      const sampleRate = this.ctx.sampleRate;
      const length = Math.floor(sampleRate * durationSec);
      const impulse = this.ctx.createBuffer(2, length, sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          const t = i / length;
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decayRate);
        }
      }
      return impulse;
    }

    _updateTremulantState() {
      if (!this.ctx) return;
      const trem = this.stops.find((s) => s.isTremulant);
      const on = !!(trem && trem.active);
      const now = this.ctx.currentTime;
      this.tremulantGain.gain.setTargetAtTime(on ? 0.06 : 0, now, 0.05);
      this.tremulantDetune.gain.setTargetAtTime(on ? 7 : 0, now, 0.05);
    }

    toggleStop(stopId) {
      const stop = this.stops.find((s) => s.id === stopId);
      if (!stop) return false;
      stop.active = !stop.active;
      if (stop.isTremulant) this._updateTremulantState();
      return stop.active;
    }

    /** Define o estado dos registros a partir de { [id]: boolean }. */
    applyStopState(map) {
      if (!map || typeof map !== 'object') return;
      for (const stop of this.stops) {
        if (typeof map[stop.id] === 'boolean') stop.active = map[stop.id];
      }
      this._updateTremulantState();
    }

    getStopState() {
      const out = {};
      for (const s of this.stops) out[s.id] = !!s.active;
      return out;
    }

    setMasterVolume(v) {
      this.masterVolume = clamp(v, 0, 1);
      if (this.masterGain) {
        this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.02);
      }
    }

    /**
     * Abertura da caixa expressiva (0.05–1.0), imediata ou agendada em `when`.
     * Curva exponencial das venezianas: 420 Hz → ~9,2 kHz.
     */
    setExpression(value, when) {
      this.expression = clamp(value, 0.05, 1.0);
      if (!this.ctx) return;
      const t = when === undefined ? this.ctx.currentTime : when;
      const cutoff = 420 * Math.pow(22, this.expression);
      const gainVal = 0.16 + this.expression * 0.78;
      this.swellFilter.frequency.setTargetAtTime(cutoff, t, 0.04);
      this.swellGain.gain.setTargetAtTime(gainVal, t, 0.04);
    }

    /** Registros de tubo ativos (exclui o tremulante). */
    _pipeStops() {
      const active = this.stops.filter((s) => s.active && !s.isTremulant);
      // Garante ao menos um registro suave caso o usuário desligue todos.
      return active.length > 0 ? active : [{ id: 'fallback', mult: 1.0, type: 'sine', gain: 0.25 }];
    }

    /**
     * Constrói uma voz (um tubo por registro ativo) que começa em `when`.
     * @returns objeto de voz com release(at), kill() e dispose().
     */
    _createVoice(midi, division, when) {
      const ctx = this.ctx;
      const baseFreq = midiToFrequency(midi);

      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, when);
      master.gain.linearRampToValueAtTime(1.0, when + ATTACK);
      master.connect(this.swellFilter);

      const nodes = [master];
      const oscs = [];

      for (const stop of this._pipeStops()) {
        let weight = 1.0;
        if (stop.id === 'subbass16') weight = division === 'ped' ? 1.45 : 0.35;
        else if (division === 'ped' && stop.mult >= 3) weight = 0.55;

        const osc = ctx.createOscillator();
        osc.type = stop.type;
        osc.frequency.setValueAtTime(baseFreq * stop.mult, when);
        this.tremulantDetune.connect(osc.detune);

        const stopGain = ctx.createGain();
        stopGain.gain.setValueAtTime(stop.gain * weight, when);
        nodes.push(stopGain);

        if (stop.filterHz) {
          const pipeFilter = ctx.createBiquadFilter();
          pipeFilter.type = 'lowpass';
          pipeFilter.frequency.setValueAtTime(stop.filterHz, when);
          if (stop.resonance) pipeFilter.Q.value = stop.resonance;
          osc.connect(pipeFilter);
          pipeFilter.connect(stopGain);
          nodes.push(pipeFilter);
        } else {
          osc.connect(stopGain);
        }
        stopGain.connect(master);
        osc.start(when);
        oscs.push(osc);
      }

      const synth = this;
      const voice = {
        midi,
        division,
        startTime: when,
        released: false,
        disposed: false,

        /**
         * Inicia o decaimento em `at` (respeitando o fim do ataque).
         * Com `force`, antecipa um decaimento já agendado para o futuro.
         */
        release(at, force) {
          if (voice.released && !force) return;
          voice.released = true;
          const t = Math.max(at, when + ATTACK + 0.002);
          if (force) master.gain.cancelScheduledValues(t);
          master.gain.setTargetAtTime(0, t, RELEASE_TAU);
          const stopAt = t + RELEASE_TAIL;
          for (const o of oscs) {
            try { o.stop(stopAt); } catch (e) { /* já parado */ }
          }
        },

        /** Silencia imediatamente uma voz que ainda não começou a soar. */
        kill() {
          if (voice.released) return;
          voice.released = true;
          const now = ctx.currentTime;
          for (const o of oscs) {
            try { o.stop(now); } catch (e) { /* já parado */ }
          }
          setTimeout(voice.dispose, 250);
        },

        dispose() {
          if (voice.disposed) return;
          voice.disposed = true;
          for (const o of oscs) {
            try { synth.tremulantDetune.disconnect(o.detune); } catch (e) { /* ok */ }
            try { o.disconnect(); } catch (e) { /* ok */ }
          }
          for (const n of nodes) {
            try { n.disconnect(); } catch (e) { /* ok */ }
          }
          synth.scheduledVoices.delete(voice);
        },
      };
      oscs[0].onended = voice.dispose;
      return voice;
    }

    // ---------------------------------------------------------------- ao vivo

    noteOn(keyId, midi, division = 'rh') {
      this.ensureContext();
      if (this.activeVoices.has(keyId)) return;
      if (this.activeVoices.size + this.scheduledVoices.size >= MAX_VOICES) return;
      this.activeVoices.set(keyId, this._createVoice(midi, division, this.ctx.currentTime));
    }

    noteOff(keyId) {
      const voice = this.activeVoices.get(keyId);
      if (!voice) return;
      voice.release(this.ctx.currentTime);
      this.activeVoices.delete(keyId);
    }

    allNotesOff() {
      for (const key of Array.from(this.activeVoices.keys())) this.noteOff(key);
    }

    // -------------------------------------------------------------- agendado

    /**
     * Agenda uma nota para soar em `when` (tempo do AudioContext) por `duration` s.
     * Retorna a voz ou null se o limite de polifonia foi atingido.
     */
    scheduleNote(midi, division, when, duration) {
      this.ensureContext();
      if (this.activeVoices.size + this.scheduledVoices.size >= MAX_VOICES) return null;
      const voice = this._createVoice(midi, division, when);
      voice.release(when + Math.max(0.02, duration));
      this.scheduledVoices.add(voice);
      return voice;
    }

    /** Cancela notas agendadas: as pendentes são descartadas, as soando decaem. */
    cancelScheduled() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      for (const voice of Array.from(this.scheduledVoices)) {
        if (voice.startTime > now + 0.005) {
          voice.released = false; // permite kill() mesmo com release já agendado
          voice.kill();
        } else {
          voice.release(now, true); // já soando: antecipa o decaimento
        }
        this.scheduledVoices.delete(voice);
      }
    }
  }

  Organum.PipeOrganSynth = PipeOrganSynth;
  if (typeof module !== 'undefined' && module.exports) module.exports = PipeOrganSynth;
})(typeof window !== 'undefined' ? window : globalThis);
