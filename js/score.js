/**
 * Organum Studio — modelo de partitura (puro, sem DOM/áudio).
 *
 * Responsabilidades:
 *  - validar/normalizar partituras importadas (JSON não confiável);
 *  - resolver ligaduras de prolongamento em "notas sonoras";
 *  - interpolar dinâmicas (cresc./dim.);
 *  - gerar os passos do Modo Ensino.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});
  const Utils = Organum.Utils || (typeof require === 'function' ? require('./utils.js') : null);
  const { RANGES, clamp, diatonicIndexToMidi } = Utils;

  const VOICES = Object.freeze(['rh', 'lh', 'ped']);
  const PEDAL_TECHS = Object.freeze(['E^', 'Eo', 'D^', 'Do']);

  /** Marcas de dinâmica aceitas e o valor padrão (abertura da caixa expressiva). */
  const DYNAMIC_MARKS = Object.freeze({
    pp: 0.2,
    p: 0.35,
    mp: 0.5,
    mf: 0.65,
    f: 0.85,
    ff: 1.0,
    'cresc.': 0.8,
    'dim.': 0.3,
  });

  const LIMITS = Object.freeze({
    minBpm: 20,
    maxBpm: 300,
    maxMeasures: 128,
    maxNotes: 8000,
    maxDuration: 16,
    minDuration: 0.125,
    beatsPerMeasure: 4,
  });

  const EPS = 1e-6;
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const isHairpin = (mark) => mark === 'cresc.' || mark === 'dim.';

  let idCounter = 0;
  function makeNoteId() {
    idCounter = (idCounter + 1) % 1e9;
    return `n_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1296).toString(36)}`;
  }

  const TIME_DENS = [2, 4, 8, 16];

  /** Fórmula de compasso -> tempos (semínimas) por compasso. 6/8 = 3, 3/4 = 3, 2/2 = 4. */
  function beatsPerMeasure(score) {
    const ts = score && score.timeSig;
    return ts ? (ts[0] * 4) / ts[1] : LIMITS.beatsPerMeasure;
  }

  function sanitizeTimeSig(raw) {
    if (!Array.isArray(raw) || raw.length !== 2) return [4, 4];
    const num = Number(raw[0]);
    const den = Number(raw[1]);
    if (!Number.isInteger(num) || num < 1 || num > 16 || !TIME_DENS.includes(den)) return [4, 4];
    return [num, den];
  }

  function sanitizeBreaths(raw, totalBeats) {
    if (!Array.isArray(raw)) return undefined;
    const set = new Set();
    for (const v of raw) {
      const b = Number(v);
      if (Number.isFinite(b) && b > 0 && b <= totalBeats + EPS) set.add(round3(b));
    }
    return set.size ? [...set].sort((a, b) => a - b).slice(0, 400) : undefined;
  }

  function sanitizeSlurs(raw, totalBeats) {
    if (!Array.isArray(raw)) return undefined;
    const out = [];
    for (const s of raw.slice(0, 600)) {
      if (!s || !VOICES.includes(s.voice)) continue;
      const a = Number(s.startBeat);
      const b = Number(s.endBeat);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || b > totalBeats + EPS) continue;
      out.push({ voice: s.voice, startBeat: round3(a), endBeat: round3(b), above: s.above !== false });
    }
    return out.length ? out : undefined;
  }

  function sanitizeMarks(raw, totalBeats) {
    if (!Array.isArray(raw)) return undefined;
    const out = [];
    for (const m of raw.slice(0, 200)) {
      if (!m || typeof m.text !== 'string' || !/^[*\u2020\u2021\u2460-\u2468A-Za-z0-9.]{1,4}$/.test(m.text)) continue;
      const b = Number(m.beat);
      if (!Number.isFinite(b) || b < 0 || b > totalBeats) continue;
      out.push({ beat: round3(b), text: m.text, voice: VOICES.includes(m.voice) ? m.voice : 'rh' });
    }
    return out.length ? out : undefined;
  }

  function sanitizeShortText(v, max) {
    // eslint-disable-next-line no-control-regex -- remove controles e marcação do texto importado
    return typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : undefined;
  }

  function sanitizeLyrics(raw) {
    if (!Array.isArray(raw)) return undefined;
    // eslint-disable-next-line no-control-regex -- remove controles e marcação do texto importado
    const clean = (v) => String(v).replace(/[\u0000-\u0008\u000b-\u001f<>]/g, '').slice(0, 3000);
    const out = raw.filter((v) => typeof v === 'string' && v.trim()).slice(0, 12).map(clean);
    return out.length ? out : undefined;
  }

  const cloneScore = (score) => JSON.parse(JSON.stringify(score));

  function createEmptyScore() {
    return {
      title: 'Partitura Vazia (Composição Própria)',
      bpm: 80,
      measures: 4,
      notes: [],
      dynamics: [{ beat: 0, mark: 'mf', value: 0.65 }],
    };
  }

  function sanitizeNote(raw, totalBeats, usedIds) {
    if (!raw || typeof raw !== 'object') return null;
    if (!VOICES.includes(raw.voice)) return null;

    let midi = null;
    if (raw.midi !== null && raw.midi !== undefined) {
      midi = Number(raw.midi);
      if (!Number.isInteger(midi)) return null;
      const range = RANGES[raw.voice];
      if (midi < range.min || midi > range.max) return null;
    }

    const start = Number(raw.startBeat);
    if (!Number.isFinite(start) || start < 0 || start >= totalBeats) return null;

    let duration = Number(raw.duration);
    if (!Number.isFinite(duration) || duration <= 0) duration = 1;
    duration = clamp(duration, LIMITS.minDuration, LIMITS.maxDuration);

    const acc = midi !== null && (raw.acc === '#' || raw.acc === 'b') ? raw.acc : '';

    let id = typeof raw.id === 'string' && /^[\w-]{1,48}$/.test(raw.id) ? raw.id : null;
    if (!id || usedIds.has(id)) id = makeNoteId();
    usedIds.add(id);

    const note = {
      id,
      voice: raw.voice,
      midi,
      startBeat: round3(start),
      duration: round3(duration),
      acc,
      tie: midi !== null && raw.tie === true,
    };
    if (midi !== null && Number.isInteger(raw.dia) && diatonicIndexToMidi(raw.dia, acc) === midi) {
      note.dia = raw.dia; // grafia exata (ex.: Dó♭ vs Si)
    }
    if (midi !== null && raw.fermata === true) note.fermata = true; // fermata: sustenta o dobro do valor
    if (midi !== null && typeof raw.finger === 'string' && /^[0-9\u2460-\u2468-]{1,6}$/.test(raw.finger)) {
      note.finger = raw.finger; // dedilhado impresso (ex.: "3", "1-3", "①")
      note.fingerSide = raw.fingerSide === 'b' ? 'b' : 'a';
    }
    if (raw.voice === 'ped') {
      note.pedalTech = PEDAL_TECHS.includes(raw.pedalTech) ? raw.pedalTech : 'E^';
    }
    return note;
  }

  function sanitizeDynamics(rawList, totalBeats) {
    const out = [];
    const list = Array.isArray(rawList) ? rawList : [];
    for (const d of list) {
      if (!d || typeof d !== 'object') continue;
      if (!Object.prototype.hasOwnProperty.call(DYNAMIC_MARKS, d.mark)) continue;
      const beat = Number(d.beat);
      if (!Number.isFinite(beat) || beat < 0 || beat >= totalBeats) continue;
      let value = Number(d.value);
      if (!Number.isFinite(value)) value = DYNAMIC_MARKS[d.mark];
      value = round3(clamp(value, 0.05, 1));
      out.push({ beat: round3(beat), mark: d.mark, value });
    }
    out.sort((a, b) => a.beat - b.beat);
    // Uma única dinâmica por posição (a última vence).
    const unique = [];
    for (const d of out) {
      if (unique.length && Math.abs(unique[unique.length - 1].beat - d.beat) < EPS) {
        unique[unique.length - 1] = d;
      } else {
        unique.push(d);
      }
    }
    if (unique.length === 0 || unique[0].beat > EPS) {
      unique.unshift({ beat: 0, mark: 'mf', value: DYNAMIC_MARKS.mf });
    }
    return unique;
  }

  /**
   * Valida e normaliza uma partitura vinda de fonte não confiável (JSON importado,
   * localStorage). Nunca confia nos campos: devolve uma cópia saneada.
   *
   * @returns {{score: object, dropped: number}}  `dropped` = notas descartadas.
   * @throws {Error} se o formato for irrecuperável.
   */
  function sanitizeScore(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('O JSON precisa ser um objeto de partitura.');
    }
    if (!Array.isArray(raw.notes)) throw new Error('Campo "notes" ausente ou inválido.');

    const measures = Number(raw.measures);
    if (!Number.isInteger(measures) || measures < 1 || measures > LIMITS.maxMeasures) {
      throw new Error(`"measures" deve ser um inteiro entre 1 e ${LIMITS.maxMeasures}.`);
    }
    if (raw.notes.length > LIMITS.maxNotes) {
      throw new Error(`Partitura grande demais (máximo ${LIMITS.maxNotes} notas).`);
    }

    const timeSig = sanitizeTimeSig(raw.timeSig);
    const totalBeats = measures * ((timeSig[0] * 4) / timeSig[1]);
    const usedIds = new Set();
    const notes = [];
    let dropped = 0;
    for (const n of raw.notes) {
      const clean = sanitizeNote(n, totalBeats, usedIds);
      if (clean) notes.push(clean);
      else dropped++;
    }
    const voiceOrder = { rh: 0, lh: 1, ped: 2 };
    notes.sort((a, b) => a.startBeat - b.startBeat || voiceOrder[a.voice] - voiceOrder[b.voice] || (a.midi ?? 0) - (b.midi ?? 0));

    let bpm = Number(raw.bpm);
    if (!Number.isFinite(bpm)) bpm = 72;
    bpm = Math.round(clamp(bpm, LIMITS.minBpm, LIMITS.maxBpm));

    const title =
      typeof raw.title === 'string' && raw.title.trim()
        // eslint-disable-next-line no-control-regex -- remove caracteres de controle do título importado
        ? raw.title.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120)
        : 'Partitura importada';

    const score = { title, bpm, measures, timeSig, notes, dynamics: sanitizeDynamics(raw.dynamics, totalBeats) };
    const lyrics = sanitizeLyrics(raw.lyrics);
    if (lyrics) score.lyrics = lyrics;
    const breaths = sanitizeBreaths(raw.breaths, totalBeats);
    if (breaths) score.breaths = breaths;
    const slurs = sanitizeSlurs(raw.slurs, totalBeats);
    if (slurs) score.slurs = slurs;
    const marks = sanitizeMarks(raw.marks, totalBeats);
    if (marks) score.marks = marks;
    const composer = sanitizeShortText(raw.composer, 80);
    if (composer) score.composer = composer;
    return { score, dropped };
  }

  /**
   * Valor de dinâmica no tempo `beat`. `dynamics` deve estar ordenado por `beat`.
   * "cresc."/"dim." interpolam do nível anterior até a próxima marca.
   */
  function getDynamicAtBeat(dynamics, beat) {
    if (!dynamics || dynamics.length === 0) return { mark: 'mf', value: DYNAMIC_MARKS.mf };
    let idx = 0;
    for (let i = 0; i < dynamics.length; i++) {
      if (dynamics[i].beat <= beat + 0.01) idx = i;
      else break;
    }
    const cur = dynamics[idx];
    const next = dynamics[idx + 1];
    if (isHairpin(cur.mark) && next && next.beat > cur.beat) {
      const prev = dynamics[idx - 1];
      const from = prev ? prev.value : cur.value;
      const t = clamp((beat - cur.beat) / (next.beat - cur.beat), 0, 1);
      return { mark: cur.mark, value: from + (next.value - from) * t };
    }
    return { mark: cur.mark, value: cur.value };
  }

  /**
   * Resolve ligaduras de prolongamento. Uma nota com `tie: true` é fundida com a
   * próxima nota de mesma voz/altura que comece exatamente onde ela termina.
   *
   * @returns {{ sounding: Array, continuationIds: Set<string> }}
   *   `sounding`: notas realmente articuladas (duração já somada);
   *   `continuationIds`: ids das notas absorvidas (não são re-articuladas).
   */
  function resolveTies(notes) {
    const real = notes.filter((n) => n.midi !== null && n.midi !== undefined);
    const sorted = real.slice().sort((a, b) => a.startBeat - b.startBeat);
    const byKey = new Map();
    const byId = new Map(sorted.map((n) => [n.id, n]));
    for (const n of sorted) {
      const key = `${n.voice}:${n.midi}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(n);
    }

    const continuationIds = new Set();
    const sounding = [];
    for (const note of sorted) {
      if (continuationIds.has(note.id)) continue;
      const key = `${note.voice}:${note.midi}`;
      let duration = note.duration;
      let cur = note;
      const ids = [note.id];
      while (cur.tie) {
        const expected = cur.startBeat + cur.duration;
        const next = byKey
          .get(key)
          .find((c) => c !== cur && !continuationIds.has(c.id) && Math.abs(c.startBeat - expected) < EPS);
        if (!next) break;
        continuationIds.add(next.id);
        ids.push(next.id);
        duration += next.duration;
        cur = next;
      }
      const entry = { voice: note.voice, midi: note.midi, startBeat: note.startBeat, duration, ids };
      // Fermata: sustenta o trecho marcado (a nota com a marca) por mais um valor igual.
      const fermataExtra = ids.reduce((sum, id) => sum + (byId.get(id).fermata ? byId.get(id).duration : 0), 0);
      if (fermataExtra > 0) entry.fermataExtra = fermataExtra;
      sounding.push(entry);
    }
    return { sounding, continuationIds };
  }

  /** Passos do Modo Ensino: um passo por instante de ataque. */
  function buildTutorSteps(score) {
    const { continuationIds } = resolveTies(score.notes);
    const beatMap = new Map();
    for (const n of score.notes) {
      if (n.midi === null || n.midi === undefined || continuationIds.has(n.id)) continue;
      const key = round3(n.startBeat);
      if (!beatMap.has(key)) beatMap.set(key, []);
      beatMap.get(key).push(n);
    }
    return Array.from(beatMap.keys())
      .sort((a, b) => a - b)
      .map((beat) => {
        const dyn = getDynamicAtBeat(score.dynamics, beat);
        return { beat, notes: beatMap.get(beat), dynLabel: dyn.mark, dynValue: dyn.value };
      });
  }

  const Score = {
    VOICES,
    PEDAL_TECHS,
    DYNAMIC_MARKS,
    LIMITS,
    isHairpin,
    makeNoteId,
    cloneScore,
    beatsPerMeasure,
    createEmptyScore,
    sanitizeScore,
    getDynamicAtBeat,
    resolveTies,
    buildTutorSteps,
  };

  Organum.Score = Score;
  if (typeof module !== 'undefined' && module.exports) module.exports = Score;
})(typeof window !== 'undefined' ? window : globalThis);
