'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const Utils = require('../js/utils.js');
const Score = require('../js/score.js');
const PRESETS = require('../js/presets.js');
const MidiExport = require('../js/midi-export.js');
const Tutor = require('../js/tutor.js');

test('utils: nomes de nota e frequência', () => {
  assert.equal(Utils.midiToNoteName(60), 'C4');
  assert.equal(Utils.midiToNoteName(61, true), 'Db4');
  assert.ok(Math.abs(Utils.midiToFrequency(69) - 440) < 1e-9);
});

test('utils: tap tempo', () => {
  assert.equal(Utils.computeTapTempo([0]), null);
  assert.equal(Utils.computeTapTempo([0, 500, 1000, 1500]), 120);
  // pausa longa descarta o histórico antigo
  assert.equal(Utils.computeTapTempo([0, 100, 10000, 10500]), 120);
  assert.equal(Utils.computeTapTempo([0, 10], { maxBpm: 300 }), 300);
});

test('score: todas as obras predefinidas são válidas', () => {
  for (const [key, p] of Object.entries(PRESETS)) {
    const { score, dropped } = Score.sanitizeScore(p);
    assert.equal(dropped, 0, `${key} perdeu notas`);
    if (key !== 'empty') assert.ok(score.notes.length > 0, key);
  }
});

test('score: sanitizeScore rejeita formatos inválidos', () => {
  assert.throws(() => Score.sanitizeScore(null));
  assert.throws(() => Score.sanitizeScore([]));
  assert.throws(() => Score.sanitizeScore({ measures: 4 }));
  assert.throws(() => Score.sanitizeScore({ notes: [], measures: 0 }));
  assert.throws(() => Score.sanitizeScore({ notes: [], measures: 1e9 }));
});

test('score: sanitizeScore descarta notas maliciosas e limpa o título', () => {
  const { score, dropped } = Score.sanitizeScore({
    title: '<img src=x onerror=alert(1)>Obra',
    bpm: 9999,
    measures: 2,
    notes: [
      { voice: 'rh', midi: 60, startBeat: 0, duration: 1 },
      { voice: 'rh', midi: 10, startBeat: 0, duration: 1 }, // fora da extensão
      { voice: 'xx', midi: 60, startBeat: 0, duration: 1 }, // voz inválida
      { voice: 'rh', midi: 60, startBeat: 99, duration: 1 }, // fora da partitura
      { voice: 'rh', midi: 'abc', startBeat: 0, duration: 1 },
      { voice: 'rh', midi: 62, startBeat: 1, duration: 1, id: '<script>' },
      null,
    ],
  });
  assert.equal(score.notes.length, 2);
  assert.equal(dropped, 5);
  assert.ok(!/[<>]/.test(score.title));
  assert.ok(score.bpm <= Score.LIMITS.maxBpm);
  for (const n of score.notes) assert.match(n.id, /^[\w-]+$/);
});

test('score: resolveTies funde notas ligadas', () => {
  const notes = [
    { id: 'a', voice: 'rh', midi: 60, startBeat: 0, duration: 2, tie: true },
    { id: 'b', voice: 'rh', midi: 60, startBeat: 2, duration: 1, tie: false },
    { id: 'c', voice: 'rh', midi: 62, startBeat: 3, duration: 1, tie: false },
  ];
  const { sounding, continuationIds } = Score.resolveTies(notes);
  assert.equal(sounding.length, 2);
  assert.equal(sounding[0].duration, 3);
  assert.ok(continuationIds.has('b'));
});

test('score: getDynamicAtBeat interpola cresc.', () => {
  const dyn = [
    { beat: 0, mark: 'p', value: 0.3 },
    { beat: 0, mark: 'cresc.', value: 0.3 },
    { beat: 4, mark: 'ff', value: 0.9 },
  ].slice(1);
  dyn.unshift({ beat: 0, mark: 'p', value: 0.3 });
  dyn[1].beat = 0.5;
  const mid = Score.getDynamicAtBeat(dyn, 2.25);
  assert.ok(mid.value > 0.3 && mid.value < 0.9);
  assert.equal(Score.getDynamicAtBeat(dyn, 0).mark, 'p');
});

test('midi: cabeçalho SMF tipo 1 e faixas bem formadas', () => {
  const bytes = MidiExport.buildMidiFile(PRESETS.toccata);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  assert.equal(dv.getUint16(8), 1);
  const nTracks = dv.getUint16(10);
  assert.equal(nTracks, 4); // condutor + 3 vozes
  let pos = 14;
  for (let i = 0; i < nTracks; i++) {
    assert.equal(String.fromCharCode(...bytes.slice(pos, pos + 4)), 'MTrk');
    const len = dv.getUint32(pos + 4);
    assert.deepEqual(Array.from(bytes.slice(pos + 8 + len - 3, pos + 8 + len)), [0xff, 0x2f, 0x00]);
    pos += 8 + len;
  }
  assert.equal(pos, bytes.length);
});

test('midi: vlq', () => {
  assert.deepEqual(MidiExport.vlq(0), [0]);
  assert.deepEqual(MidiExport.vlq(128), [0x81, 0x00]);
  assert.deepEqual(MidiExport.vlq(0x3fff), [0xff, 0x7f]);
});

test('tutor: avança ao tocar todas as notas do passo', () => {
  const timers = [];
  let changes = 0;
  const score = Score.sanitizeScore({
    measures: 1,
    notes: [
      { voice: 'rh', midi: 60, startBeat: 0, duration: 1 },
      { voice: 'lh', midi: 48, startBeat: 0, duration: 1 },
      { voice: 'rh', midi: 62, startBeat: 1, duration: 1 },
    ],
  }).score;
  const t = new Tutor({
    getScore: () => score,
    onChange: () => changes++,
    onStep: () => {},
    onComplete: () => {},
    setTimeout: (fn) => timers.push(fn),
  });
  t.start();
  assert.equal(t.view().total, 2);
  t.handleInput('rh', 60);
  assert.equal(t.view().index, 0, 'ainda falta a mão esquerda');
  t.handleInput('lh', 48);
  timers.splice(0).forEach((fn) => fn());
  assert.equal(t.view().index, 1);
  assert.ok(changes > 0);
});

test('score: fermata é preservada e o scheduler pausa o tempo', () => {
  const Scheduler = require('../js/scheduler.js');
  const { score } = Score.sanitizeScore({
    format: 'organum-studio-score', version: 1, title: 't', bpm: 60, measures: 2,
    notes: [
      { id: 'a', voice: 'rh', midi: 60, startBeat: 0, duration: 2 },
      { id: 'b', voice: 'rh', midi: 62, startBeat: 2, duration: 2, fermata: true },
      { id: 'c', voice: 'rh', midi: 64, startBeat: 4, duration: 4, fermata: 'sim' },
    ],
    dynamics: [],
  });
  assert.equal(score.notes[0].fermata, undefined);
  assert.equal(score.notes[1].fermata, true);
  assert.equal(score.notes[2].fermata, undefined, 'só booleano true vale');
  const fake = Object.create(Scheduler.prototype);
  fake.score = score; fake.playNotes = true;
  fake._buildHolds(0);
  assert.deepEqual(fake.holds, [{ at: 4, extra: 2 }]);
  fake._buildHolds(4);
  assert.equal(fake.holdIdx, 1, 'começar depois da fermata não a repete');
});

test('score: fórmula de compasso (3/4, 6/8) e letras', () => {
  const base = { format: 'organum-studio-score', version: 1, title: 'v', bpm: 80, measures: 2, notes: [{ id: 'a', voice: 'rh', midi: 60, startBeat: 6, duration: 1 }], dynamics: [] };
  const w = Score.sanitizeScore({ ...base, timeSig: [3, 4], lyrics: ['1. a - <b>', '', 7] }).score;
  assert.equal(Score.beatsPerMeasure(w), 3);
  assert.equal(w.notes.length, 0, 'nota além do fim de 2 compassos de 3/4 é descartada');
  assert.deepEqual(w.lyrics, ['1. a - b']);
  assert.equal(Score.beatsPerMeasure(Score.sanitizeScore({ ...base, timeSig: [6, 8] }).score), 3);
  assert.deepEqual(Score.sanitizeScore({ ...base, timeSig: [5, 3] }).score.timeSig, [4, 4]);
  const midi = MidiExport.buildMidiFile(Score.sanitizeScore({ ...base, timeSig: [6, 8] }).score);
  const hex = Buffer.from(midi).toString('hex');
  assert.ok(hex.includes('ff580406031808'), 'meta 6/8 no MIDI');
});

test('score: respirações, dedilhado, frases, marcas e compositor', () => {
  const { score } = Score.sanitizeScore({
    format: 'organum-studio-score', version: 1, title: 'x', bpm: 60, measures: 2,
    notes: [{ id: 'a', voice: 'rh', midi: 60, startBeat: 0, duration: 1, finger: '1-3', fingerSide: 'b' },
      { id: 'b', voice: 'rh', midi: 62, startBeat: 1, duration: 1, finger: '<script>' }],
    dynamics: [], breaths: [1, 1, 99, -2, 'x'], slurs: [{ voice: 'rh', startBeat: 0, endBeat: 2 }, { voice: 'zz', startBeat: 0, endBeat: 1 }],
    marks: [{ beat: 1, text: '*' }, { beat: 1, text: '<b>' }], composer: 'Fulana <i>de Tal',
  });
  assert.equal(score.notes[0].finger, '1-3');
  assert.equal(score.notes[0].fingerSide, 'b');
  assert.equal(score.notes[1].finger, undefined);
  assert.deepEqual(score.breaths, [1]);
  assert.equal(score.slurs.length, 1);
  assert.deepEqual(score.marks, [{ beat: 1, text: '*', voice: 'rh' }]);
  assert.equal(score.composer, 'Fulana i de Tal'.replace('i de', 'ide'));
});

test('presets de teclas do PC: rótulos e troca de padrão', () => {
  const Input = require('../js/input.js');
  assert.ok(Input.PC_KEY_PRESETS.atual && Input.PC_KEY_PRESETS.piano);
  const a = Input.pcKeyLabels('rh', 'atual');
  const p = Input.pcKeyLabels('rh', 'piano');
  assert.equal(typeof a, 'object');
  assert.notDeepEqual(a, p);
  assert.equal(p[60], 'Q');
});
