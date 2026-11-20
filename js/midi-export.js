/**
 * Organum Studio — exportação para Standard MIDI File (formato 1).
 *
 * Faixas: 0 = andamento/compasso; 1 = Mão Direita (canal 1); 2 = Mão Esquerda
 * (canal 2); 3 = Pedaleira (canal 3). Programa 20 (Church Organ). As dinâmicas
 * viram CC#11 (Expression), incluindo rampas de cresc./dim.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});
  const Score = Organum.Score || (typeof require === 'function' ? require('./score.js') : null);

  const PPQ = 480;
  const CHURCH_ORGAN = 19; // programa GM 20 (0‑based)
  const VELOCITY = 90;
  const CHANNELS = { rh: 0, lh: 1, ped: 2 };
  const TRACK_NAMES = { rh: 'Mao Direita (Manual II)', lh: 'Mao Esquerda (Manual I)', ped: 'Pedaleira' };

  function vlq(value) {
    let v = Math.max(0, Math.floor(value));
    const bytes = [v & 0x7f];
    while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
    return bytes;
  }

  const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff];
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0) & 0x7f);

  function trackChunk(events) {
    // events: { tick, order, bytes }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const body = [];
    let prev = 0;
    for (const ev of events) {
      body.push(...vlq(ev.tick - prev), ...ev.bytes);
      prev = ev.tick;
    }
    body.push(...vlq(0), 0xff, 0x2f, 0x00); // fim da faixa
    return [...ascii('MTrk'), ...u32(body.length), ...body];
  }

  const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];

  /**
   * @param {{title:string,bpm:number,measures:number,notes:Array,dynamics:Array}} score
   * @returns {Uint8Array}
   */
  function buildMidiFile(score) {
    const totalBeats = score.measures * Score.beatsPerMeasure(score);
    const ts = score.timeSig || [4, 4];
    const tick = (beat) => Math.round(beat * PPQ);

    const tempoUs = Math.round(60000000 / score.bpm);
    const conductor = [
      { tick: 0, order: 0, bytes: meta(0x03, ascii((score.title || 'Organum Studio').replace(/[^\x20-\x7e]/g, '?').slice(0, 100))) },
      { tick: 0, order: 1, bytes: meta(0x58, [ts[0], Math.log2(ts[1]), 24, 8]) },
      { tick: 0, order: 2, bytes: meta(0x51, [(tempoUs >> 16) & 0xff, (tempoUs >> 8) & 0xff, tempoUs & 0xff]) },
    ];

    const { sounding } = Score.resolveTies(score.notes);
    const tracks = [trackChunk(conductor)];

    for (const voice of Score.VOICES) {
      const ch = CHANNELS[voice];
      const events = [
        { tick: 0, order: 0, bytes: meta(0x03, ascii(TRACK_NAMES[voice])) },
        { tick: 0, order: 1, bytes: [0xc0 | ch, CHURCH_ORGAN] },
      ];

      // Expressão (CC#11): amostra a cada 1/4 de tempo e emite só quando muda.
      let lastCc = -1;
      for (let b = 0; b < totalBeats; b += 0.25) {
        const cc = Math.round(Score.getDynamicAtBeat(score.dynamics, b).value * 127);
        if (cc !== lastCc) {
          events.push({ tick: tick(b), order: 1, bytes: [0xb0 | ch, 11, Math.max(0, Math.min(127, cc))] });
          lastCc = cc;
        }
      }

      for (const n of sounding) {
        if (n.voice !== voice) continue;
        const on = tick(n.startBeat);
        const off = Math.max(on + 1, tick(n.startBeat + n.duration));
        events.push({ tick: on, order: 3, bytes: [0x90 | ch, n.midi, VELOCITY] });
        events.push({ tick: off, order: 2, bytes: [0x80 | ch, n.midi, 0] });
      }
      tracks.push(trackChunk(events));
    }

    const header = [...ascii('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
    return Uint8Array.from([...header, ...tracks.flat()]);
  }

  const MidiExport = { PPQ, buildMidiFile, vlq };
  Organum.MidiExport = MidiExport;
  if (typeof module !== 'undefined' && module.exports) module.exports = MidiExport;
})(typeof window !== 'undefined' ? window : globalThis);
