/**
 * Organum Studio — utilitários musicais e helpers puros (sem DOM, sem áudio).
 *
 * Este arquivo é carregado como script clássico no navegador (expõe
 * `Organum.Utils`) e também via `require()` nos testes em Node.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});

  const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const STEP_TO_SEMITONE = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
  const SEMITONE_TO_STEP_SHARP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const SEMITONE_TO_ACC_SHARP = ['', '#', '', '#', '', '', '#', '', '#', '', '#', ''];
  const SEMITONE_TO_STEP_FLAT = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];

  /** Extensão de cada divisão do órgão (MIDI inclusivo). */
  const RANGES = Object.freeze({
    rh: Object.freeze({ min: 48, max: 84 }), // Manual II: C3–C6
    lh: Object.freeze({ min: 36, max: 72 }), // Manual I:  C2–C5
    ped: Object.freeze({ min: 36, max: 55 }), // Pedaleira: C2–G3
  });

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const mod = (n, m) => ((n % m) + m) % m;

  function midiToNoteName(midi, preferFlat) {
    if (midi === null || midi === undefined) return 'Pausa';
    const octave = Math.floor(midi / 12) - 1;
    const semitone = mod(midi, 12);
    const name = preferFlat ? NOTE_NAMES_FLAT[semitone] : NOTE_NAMES_SHARP[semitone];
    return `${name}${octave}`;
  }

  function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function isBlackKey(midi) {
    return [1, 3, 6, 8, 10].includes(mod(midi, 12));
  }

  /**
   * Converte MIDI + acidente para índice diatônico (C0 = 0, D0 = 1, …, C4 = 28),
   * usado para posicionar a nota na linha/espaço correto do pentagrama.
   */
  function midiToDiatonicInfo(midi, explicitAcc) {
    const octave = Math.floor(midi / 12) - 1;
    const semitone = mod(midi, 12);
    if (explicitAcc === 'b') {
      return { diatonicIndex: octave * 7 + SEMITONE_TO_STEP_FLAT[semitone], acc: 'b' };
    }
    const step = SEMITONE_TO_STEP_SHARP[semitone];
    const acc = explicitAcc || SEMITONE_TO_ACC_SHARP[semitone];
    return { diatonicIndex: octave * 7 + step, acc };
  }

  function diatonicIndexToMidi(diatonicIndex, acc) {
    const octave = Math.floor(diatonicIndex / 7);
    const step = mod(diatonicIndex, 7);
    let midi = (octave + 1) * 12 + STEP_TO_SEMITONE[step];
    if (acc === '#') midi += 1;
    if (acc === 'b') midi -= 1;
    return midi;
  }

  function expressionValueToDynamicLabel(val) {
    if (val <= 0.25) return 'pp';
    if (val <= 0.42) return 'p';
    if (val <= 0.56) return 'mp';
    if (val <= 0.74) return 'mf';
    if (val <= 0.9) return 'f';
    return 'ff';
  }

  /** Termo italiano de andamento correspondente ao BPM (semínima). */
  function tempoMarking(bpm) {
    if (bpm < 40) return 'Grave';
    if (bpm < 60) return 'Largo';
    if (bpm < 66) return 'Larghetto';
    if (bpm < 76) return 'Adagio';
    if (bpm < 108) return 'Andante';
    if (bpm < 120) return 'Moderato';
    if (bpm < 156) return 'Allegro';
    if (bpm < 176) return 'Vivace';
    if (bpm < 200) return 'Presto';
    return 'Prestissimo';
  }

  /**
   * Calcula o BPM a partir de timestamps (ms) de toques ("tap tempo").
   * Usa os últimos `maxTaps` toques e ignora o histórico anterior a uma pausa
   * maior que `resetMs`. Retorna null enquanto houver menos de 2 toques.
   */
  function computeTapTempo(timestamps, opts) {
    const { maxTaps = 8, resetMs = 2200, minBpm = 20, maxBpm = 300 } = opts || {};
    if (!Array.isArray(timestamps) || timestamps.length < 2) return null;
    const recent = [timestamps[timestamps.length - 1]];
    for (let i = timestamps.length - 2; i >= 0 && recent.length < maxTaps; i--) {
      if (recent[0] - timestamps[i] > resetMs) break;
      recent.unshift(timestamps[i]);
    }
    if (recent.length < 2) return null;
    const avg = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
    if (!(avg > 0)) return null;
    return clamp(Math.round(60000 / avg), minBpm, maxBpm);
  }

  const Utils = {
    NOTE_NAMES_SHARP,
    NOTE_NAMES_FLAT,
    RANGES,
    clamp,
    mod,
    midiToNoteName,
    midiToFrequency,
    isBlackKey,
    midiToDiatonicInfo,
    diatonicIndexToMidi,
    expressionValueToDynamicLabel,
    tempoMarking,
    computeTapTempo,
  };

  Organum.Utils = Utils;
  if (typeof module !== 'undefined' && module.exports) module.exports = Utils;
})(typeof window !== 'undefined' ? window : globalThis);
