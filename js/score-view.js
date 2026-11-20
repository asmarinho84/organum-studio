/**
 * Organum Studio — partitura SVG interativa (3 pentagramas + faixa de dinâmicas).
 *
 * A vista é "burra": desenha o que recebe e avisa o app por callbacks. Durante a
 * execução só alterna classes/atributos (notas ativas, cursor) — não redesenha.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});
  const Utils = Organum.Utils || (typeof require === 'function' ? require('./utils.js') : null);
  const Score = Organum.Score || (typeof require === 'function' ? require('./score.js') : null);
  const { RANGES, clamp, midiToDiatonicInfo, diatonicIndexToMidi, midiToNoteName } = Utils;

  const LAYOUT = Object.freeze({
    leftMargin: 105,
    beatWidth: 68,
    staffSpacing: 10, // 10 px entre linhas → 5 px por grau diatônico
    rhTopY: 44, // Clave de Sol: linha inferior = E4 (diatônico 30)
    lhTopY: 148, // Clave de Fá: linha inferior = G2 (diatônico 18)
    pedTopY: 244, // Clave de Fá (pedaleira): linha inferior = G2 (diatônico 18)
    staffLeft: 32, // início das linhas e da chave de sistema
    dynY: 354, // faixa de dinâmicas (abaixo dos pentagramas)
    zoneRhLh: 116, // fronteiras de clique entre pentagramas
    zoneLhPed: 216,
    zoneDyn: 336,
    svgHeight: 386,
    techOffset: 78, // etiqueta de técnica de pé: abaixo das notas mais graves
    beatsPerMeasure: 4,
  });

  const VOICE_REF = Object.freeze({
    rh: { y: LAYOUT.rhTopY + 40, dia: 30 },
    lh: { y: LAYOUT.lhTopY + 40, dia: 18 },
    ped: { y: LAYOUT.pedTopY + 40, dia: 18 },
  });
  const STAFF_TOP = Object.freeze({ rh: LAYOUT.rhTopY, lh: LAYOUT.lhTopY, ped: LAYOUT.pedTopY });
  const COLORS = Object.freeze({ rh: '#38bdf8', lh: '#34d399', ped: '#fb923c' });
  const VOICE_NAMES = Object.freeze({ rh: 'Mão Direita', lh: 'Mão Esquerda', ped: 'Pedaleira' });
  const REST_GLYPH = (d) => (d >= 4 ? '\u{1D13B}' : d >= 2 ? '\u{1D13C}' : d >= 1 ? '\u{1D13D}' : '\u{1D13E}');

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const f1 = (n) => n.toFixed(1);

  const noteDia = (n) => (Number.isInteger(n.dia) ? n.dia : midiToDiatonicInfo(n.midi, n.acc).diatonicIndex);
  const diaToY = (voice, dia) => VOICE_REF[voice].y - (dia - VOICE_REF[voice].dia) * 5;

  function beatToX(beat) {
    return LAYOUT.leftMargin + beat * LAYOUT.beatWidth + 18;
  }

  /** Converte o Y do clique em { zone, voice, dia }. */
  function locate(y) {
    if (y >= LAYOUT.zoneDyn) return { zone: 'dyn', voice: null, dia: null };
    const voice = y < LAYOUT.zoneRhLh ? 'rh' : y < LAYOUT.zoneLhPed ? 'lh' : 'ped';
    const ref = VOICE_REF[voice];
    return { zone: 'staff', voice, dia: ref.dia + Math.round((ref.y - y) / 5) };
  }

  class ScoreView {
    /**
     * @param {object} o
     * @param {SVGElement} o.svg
     * @param {HTMLElement} o.scroller
     * @param {HTMLElement} o.readout
     * @param {Function} o.getScore  () => partitura
     * @param {Function} o.getEditor () => estado do editor
     * @param {object} o.handlers    onInsert, onInsertDynamic, onEraseNote, onEraseDynamic, onRejected
     */
    constructor(o) {
      this.svg = o.svg;
      this.scroller = o.scroller;
      this.readout = o.readout;
      this.getScore = o.getScore;
      this.getEditor = o.getEditor;
      this.h = o.handlers;
      this.noteEls = new Map();
      this.activeIds = new Set();
      this.cursorEl = null;
      this.ghost = null;
      this._bind();
    }

    get totalBeats() {
      const sc = this.getScore();
      return sc.measures * Score.beatsPerMeasure(sc);
    }

    xToSnapBeat(x) {
      const raw = (x - LAYOUT.leftMargin - 18) / LAYOUT.beatWidth;
      return clamp(Math.round(raw * 2) / 2, 0, this.totalBeats - 0.5); // grade de colcheia
    }

    // ----------------------------------------------------------- renderização

    render() {
      const score = this.getScore();
      const totalBeats = this.totalBeats;
      const width = LAYOUT.leftMargin + totalBeats * LAYOUT.beatWidth + 45;
      this.svg.setAttribute('width', width);
      this.svg.setAttribute('height', LAYOUT.svgHeight);
      this.svg.setAttribute('viewBox', `0 0 ${width} ${LAYOUT.svgHeight}`);

      let out = `<defs><filter id="glowNote" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;

      // Fundo alternado por compasso + numeração
      const bpmeas = Score.beatsPerMeasure(score);
      const ts = score.timeSig || [4, 4];
      for (let m = 0; m < score.measures; m++) {
        const mx = LAYOUT.leftMargin + m * bpmeas * LAYOUT.beatWidth;
        const mw = bpmeas * LAYOUT.beatWidth;
        if (m % 2 === 1) {
          out += `<rect x="${mx}" y="16" width="${mw}" height="${LAYOUT.svgHeight - 24}" fill="rgba(255,255,255,0.018)"/>`;
        }
        out += `<text class="measure-no" x="${mx + 6}" y="26">Comp. ${m + 1}</text>`;
      }

      // Pentagramas
      const staves = [
        { top: LAYOUT.rhTopY, stroke: 'rgba(56,189,248,0.32)', label: 'MÃO DIR.', sub: 'Manual II', color: '#38bdf8' },
        { top: LAYOUT.lhTopY, stroke: 'rgba(52,211,153,0.32)', label: 'MÃO ESQ.', sub: 'Manual I', color: '#34d399' },
        { top: LAYOUT.pedTopY, stroke: 'rgba(251,146,60,0.32)', label: 'PEDALEIRA', sub: 'Pés', color: '#fb923c' },
      ];
      for (const st of staves) {
        for (let i = 0; i < 5; i++) {
          const ly = st.top + i * LAYOUT.staffSpacing;
          out += `<line x1="${LAYOUT.staffLeft}" y1="${ly}" x2="${width - 16}" y2="${ly}" stroke="${st.stroke}" stroke-width="1.2"/>`;
        }
        const cy = st.top + 20;
        out += `<text class="staff-label" transform="rotate(-90 21 ${cy})" x="21" y="${cy}" text-anchor="middle" fill="${st.color}">${st.label}</text>`;
        out += `<text class="staff-sub" transform="rotate(-90 10 ${cy})" x="10" y="${cy}" text-anchor="middle">${st.sub}</text>`;
      }

      // Chave de sistema, claves e fórmula de compasso
      out += `<line x1="${LAYOUT.staffLeft}" y1="${LAYOUT.rhTopY}" x2="${LAYOUT.staffLeft}" y2="${LAYOUT.pedTopY + 40}" stroke="#94a3b8" stroke-width="2.2"/>`;
      out += `<text class="clef" x="46" y="${LAYOUT.rhTopY + 32}" font-size="56" fill="#38bdf8">\u{1D11E}</text>`;
      out += `<text class="clef" x="48" y="${LAYOUT.lhTopY + 14}" font-size="56" fill="#34d399">\u{1D122}</text>`;
      out += `<text class="clef" x="48" y="${LAYOUT.pedTopY + 14}" font-size="56" fill="#fb923c">\u{1D122}</text>`;
      for (const top of [LAYOUT.rhTopY, LAYOUT.lhTopY, LAYOUT.pedTopY]) {
        out += `<text class="timesig" x="88" y="${top + 17}">${ts[0]}</text><text class="timesig" x="88" y="${top + 34}">${ts[1]}</text>`;
      }

      // Barras de compasso
      for (let m = 0; m <= score.measures; m++) {
        const bx = LAYOUT.leftMargin + m * bpmeas * LAYOUT.beatWidth;
        const final = m === score.measures;
        out += `<line x1="${bx}" y1="${LAYOUT.rhTopY}" x2="${bx}" y2="${LAYOUT.pedTopY + 40}" stroke="${final ? '#fbbf24' : 'rgba(148,163,184,0.35)'}" stroke-width="${final ? 2.5 : 1.2}"/>`;
      }

      // Faixa de dinâmicas
      out += `<line x1="${LAYOUT.leftMargin}" y1="${LAYOUT.dynY}" x2="${width - 16}" y2="${LAYOUT.dynY}" stroke="rgba(192,132,252,0.22)" stroke-dasharray="4 4"/>`;
      out += `<text class="staff-label" x="6" y="${LAYOUT.dynY - 2}" fill="#c084fc">DINÂMICA</text>`;
      out += `<text class="staff-sub" x="6" y="${LAYOUT.dynY + 10}">Expressão</text>`;
      score.dynamics.forEach((dyn, idx) => {
        const dx = beatToX(dyn.beat);
        out += `<g class="score-dyn-item" data-dyn-idx="${idx}">
          <rect x="${dx - 22}" y="${LAYOUT.dynY - 12}" width="${dyn.mark.length > 3 ? 54 : 38}" height="20" rx="5" fill="#1e1629" stroke="#c084fc"/>
          <text class="dyn-text" x="${dx - 22 + (dyn.mark.length > 3 ? 27 : 19)}" y="${LAYOUT.dynY + 2}">${esc(dyn.mark)}</text></g>`;
      });

      out += this._renderPhraseMarks(score);
      out += this._renderNotes(score);

      out += `<g id="svgGhostNote" display="none" pointer-events="none"></g>`;
      const cx = beatToX(0);
      out += `<line id="scoreCursor" x1="${cx}" y1="14" x2="${cx}" y2="${LAYOUT.pedTopY + LAYOUT.techOffset + 4}" stroke="#fbbf24" stroke-width="2.2" pointer-events="none"/>`;

      this.svg.innerHTML = out;
      this.cursorEl = this.svg.querySelector('#scoreCursor');
      this.ghost = this.svg.querySelector('#svgGhostNote');
      this.noteEls = new Map();
      this.svg.querySelectorAll('.score-note-item').forEach((g) => this.noteEls.set(g.dataset.noteId, g));
      this._reapplyActive();
    }

    /** Respirações (vírgulas), ligaduras de frase e marcas (*) impressas no hinário. */
    _renderPhraseMarks(score) {
      let out = '';
      for (const b of score.breaths || []) {
        const x = beatToX(b) - 7;
        for (const voice of ['rh', 'lh', 'ped']) {
          const y = STAFF_TOP[voice] - 9;
          out += `<g class="breath" pointer-events="none"><circle cx="${x}" cy="${y}" r="2.6" fill="#e2e8f0"/><path d="M ${x + 1.4} ${y + 1} Q ${x + 1.6} ${y + 4.5} ${x - 1.4} ${y + 6}" fill="none" stroke="#e2e8f0" stroke-width="2" stroke-linecap="round"/></g>`;
        }
      }
      for (const s of score.slurs || []) {
        const x1 = beatToX(s.startBeat);
        const x2 = beatToX(s.endBeat);
        const top = STAFF_TOP[s.voice];
        const y = s.above ? top - 14 : top + 54;
        const c = s.above ? y - 12 : y + 12;
        out += `<path class="slur" d="M ${x1} ${y} Q ${(x1 + x2) / 2} ${c} ${x2} ${y}" fill="none" stroke="${COLORS[s.voice]}" stroke-width="1.5" pointer-events="none"/>`;
      }
      for (const m of score.marks || []) {
        out += `<text class="mark-text" x="${beatToX(m.beat)}" y="${STAFF_TOP[m.voice] - 14}" text-anchor="middle" pointer-events="none">${esc(m.text)}</text>`;
      }
      return out;
    }

    _renderNotes(score) {
      // Agrupa notas de mesma voz e tempo (acordes) para hastes e segundas.
      const groups = new Map();
      const items = score.notes.map((n) => {
        const it = {
          n,
          x: beatToX(n.startBeat),
          y: n.midi === null ? null : diaToY(n.voice, noteDia(n)),
          dx: 0,
        };
        if (it.y !== null) {
          const key = `${n.voice}|${n.startBeat}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(it);
        }
        return it;
      });

      let stems = '';
      for (const group of groups.values()) {
        const voice = group[0].n.voice;
        const top = STAFF_TOP[voice];
        const mid = top + 20;
        group.sort((a, b) => b.y - a.y); // do mais grave (maior y) ao mais agudo
        const avgY = group.reduce((s, it) => s + it.y, 0) / group.length;
        const stemUp = avgY > mid; // abaixo da linha central → haste para cima

        // Segundas: a nota superior vai para a direita para não sobrepor.
        let prevDia = null;
        let prevShifted = false;
        for (const it of group) {
          const dia = noteDia(it.n);
          const shifted = prevDia !== null && dia - prevDia === 1 && !prevShifted;
          if (shifted) it.dx = 12;
          prevDia = dia;
          prevShifted = shifted;
          it.stemUp = stemUp;
        }

        const stemmed = group.filter((it) => it.n.duration < 4);
        if (stemmed.length) {
          const ys = stemmed.map((it) => it.y);
          const lo = Math.max(...ys);
          const hi = Math.min(...ys);
          const baseX = group[0].x;
          const color = COLORS[voice];
          const sx = stemUp ? baseX + 5.8 : baseX - 5.8;
          const y1 = stemUp ? lo : hi;
          const y2 = stemUp ? hi - 26 : lo + 26;
          stems += `<line x1="${sx}" y1="${y1}" x2="${sx}" y2="${y2}" stroke="${color}" stroke-width="1.6" pointer-events="none"/>`;
          if (stemmed.some((it) => it.n.duration <= 0.5)) {
            const d = stemUp
              ? `M ${sx} ${y2} Q ${sx + 9} ${y2 + 6} ${sx + 5} ${y2 + 15}`
              : `M ${sx} ${y2} Q ${sx + 9} ${y2 - 6} ${sx + 5} ${y2 - 15}`;
            stems += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" pointer-events="none"/>`;
          }
        }
      }

      let out = stems;
      for (const it of items) {
        const { n } = it;
        const color = COLORS[n.voice];
        const nx = it.x;
        out += `<g class="score-note-item" data-note-id="${esc(n.id)}">`;

        if (n.midi === null) {
          const restY = STAFF_TOP[n.voice] + 25;
          out += `<rect x="${nx - 12}" y="${STAFF_TOP[n.voice]}" width="24" height="40" fill="transparent"/>`;
          out += `<text class="rest" x="${nx}" y="${restY}" text-anchor="middle" fill="${color}" font-size="30">${REST_GLYPH(n.duration)}</text></g>`;
          continue;
        }

        const hx = nx + it.dx;
        const top = STAFF_TOP[n.voice];
        const bottom = top + 40;

        out += `<rect x="${hx - 12}" y="${it.y - 8}" width="24" height="16" fill="transparent"/>`;

        // Linhas suplementares
        if (it.y < top) {
          for (let ly = top - 10; ly >= it.y - 2; ly -= 10) {
            out += `<line x1="${hx - 11}" y1="${ly}" x2="${hx + 11}" y2="${ly}" stroke="${color}" stroke-width="1.2"/>`;
          }
        } else if (it.y > bottom) {
          for (let ly = bottom + 10; ly <= it.y + 2; ly += 10) {
            out += `<line x1="${hx - 11}" y1="${ly}" x2="${hx + 11}" y2="${ly}" stroke="${color}" stroke-width="1.2"/>`;
          }
        }

        if (n.acc) {
          out += `<text class="acc" x="${nx - 14}" y="${it.y + 4}">${n.acc === '#' ? '♯' : '♭'}</text>`;
        }

        const open = n.duration >= 2;
        out += `<ellipse class="note-head" cx="${hx}" cy="${it.y}" rx="6.5" ry="4.6" transform="rotate(-16 ${hx} ${it.y})" fill="${open ? '#14171f' : color}" stroke="${color}" stroke-width="2"/>`;

        if (n.fermata) {
          const below = n.voice === 'lh';
          const fy = below ? bottom + 16 : top - 16;
          const arc = below
            ? `M ${hx - 9} ${fy} Q ${hx} ${fy + 14} ${hx + 9} ${fy}`
            : `M ${hx - 9} ${fy} Q ${hx} ${fy - 14} ${hx + 9} ${fy}`;
          out += `<path class="fermata" d="${arc}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`;
          out += `<circle class="fermata" cx="${hx}" cy="${below ? fy + 2 : fy - 2}" r="1.8" fill="${color}"/>`;
        }

        if (n.finger) {
          const fy = n.fingerSide === 'b' ? bottom + 13 : top - 7;
          out += `<text class="finger" x="${hx}" y="${fy}" text-anchor="middle" pointer-events="none">${esc(n.finger)}</text>`;
        }

        if (n.tie) {
          const endX = nx + n.duration * LAYOUT.beatWidth;
          out += `<path d="M ${nx + 5} ${it.y + 5} Q ${(nx + endX) / 2} ${it.y + 18} ${endX - 5} ${it.y + 5}" fill="none" stroke="${color}" stroke-width="1.6"/>`;
        }

        if (n.voice === 'ped' && n.pedalTech) {
          const techY = LAYOUT.pedTopY + LAYOUT.techOffset;
          const label = n.pedalTech.replace('E', 'E ').replace('D', 'D ');
          out += `<rect x="${nx - 14}" y="${techY - 11}" width="28" height="15" rx="4" fill="rgba(251,146,60,0.18)" stroke="#fb923c" stroke-width="0.9"/>`;
          out += `<text class="tech" x="${nx}" y="${techY}" text-anchor="middle">${esc(label)}</text>`;
        }
        out += `</g>`;
      }
      return out;
    }

    // ------------------------------------------------ estado dinâmico (rápido)

    /** Realça as notas que estão soando (sem redesenhar a partitura). */
    setActive(ids) {
      for (const id of this.activeIds) {
        if (!ids.has(id)) this._toggleActive(id, false);
      }
      for (const id of ids) {
        if (!this.activeIds.has(id)) this._toggleActive(id, true);
      }
      this.activeIds = new Set(ids);
    }

    _toggleActive(id, on) {
      const g = this.noteEls.get(id);
      if (!g) return;
      g.classList.toggle('active', on);
      if (on) g.setAttribute('filter', 'url(#glowNote)');
      else g.removeAttribute('filter');
    }

    _reapplyActive() {
      for (const id of this.activeIds) this._toggleActive(id, true);
    }

    setCursor(beat) {
      if (!this.cursorEl) return;
      const x = beatToX(beat);
      this.cursorEl.setAttribute('x1', x);
      this.cursorEl.setAttribute('x2', x);
    }

    /** Rola suavemente para manter o cursor visível durante a execução. */
    followCursor(beat) {
      const x = beatToX(beat);
      const s = this.scroller;
      if (x > s.scrollLeft + s.clientWidth - 140) s.scrollLeft = x - 140;
      else if (x < s.scrollLeft + 60) s.scrollLeft = Math.max(0, x - 140);
    }

    centerOn(beat) {
      this.scroller.scrollLeft = Math.max(0, beatToX(beat) - this.scroller.clientWidth / 2);
    }

    // -------------------------------------------------------------- interação

    _pointer(e) {
      const rect = this.svg.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _bind() {
      this.svg.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        const { x, y } = this._pointer(e);
        if (x < LAYOUT.leftMargin || !this.ghost) return this._hideGhost();
        const ed = this.getEditor();
        if (ed.eraser) {
          this._hideGhost();
          this.readout.textContent = 'Borracha: clique em uma nota ou dinâmica para remover';
          return;
        }
        const beat = this.xToSnapBeat(x);
        const pos = locate(y);
        const sx = beatToX(beat);

        if (pos.zone === 'dyn') {
          this.ghost.style.display = 'block';
          this.ghost.innerHTML = `<rect x="${sx - 22}" y="${LAYOUT.dynY - 12}" width="38" height="20" rx="5" fill="rgba(192,132,252,0.35)" stroke="#c084fc" stroke-dasharray="3 2"/>
            <text class="dyn-text" x="${sx - 3}" y="${LAYOUT.dynY + 2}">${esc(ed.dynMark)}</text>`;
          this.readout.textContent = `Inserir dinâmica "${ed.dynMark}" no tempo ${(beat + 1).toFixed(1)}`;
          return;
        }

        const sy = diaToY(pos.voice, pos.dia);
        const midi = diatonicIndexToMidi(pos.dia, ed.accidental);
        this.ghost.style.display = 'block';
        this.ghost.innerHTML = `<ellipse cx="${sx}" cy="${f1(sy)}" rx="6.5" ry="4.6" transform="rotate(-16 ${sx} ${f1(sy)})" fill="${COLORS[pos.voice]}" opacity="0.55"/>`;
        const range = RANGES[pos.voice];
        const label = ed.isRest ? 'Pausa' : midiToNoteName(midi, ed.accidental === 'b');
        const warn = !ed.isRest && (midi < range.min || midi > range.max) ? ' • fora da extensão' : '';
        this.readout.textContent = `${VOICE_NAMES[pos.voice]} • ${label} • tempo ${(beat + 1).toFixed(1)} (${ed.duration}t)${warn}`;
      });

      this.svg.addEventListener('pointerleave', () => this._hideGhost());

      this.svg.addEventListener('click', (e) => {
        const ed = this.getEditor();
        const noteG = e.target.closest('.score-note-item');
        const dynG = e.target.closest('.score-dyn-item');

        if (ed.eraser) {
          if (noteG) this.h.onEraseNote(noteG.dataset.noteId);
          else if (dynG) this.h.onEraseDynamic(Number(dynG.dataset.dynIdx));
          return;
        }

        const { x, y } = this._pointer(e);
        if (x < LAYOUT.leftMargin) return;
        const beat = this.xToSnapBeat(x);
        const pos = locate(y);

        if (pos.zone === 'dyn') {
          this.h.onInsertDynamic(beat);
          return;
        }

        const midi = ed.isRest ? null : diatonicIndexToMidi(pos.dia, ed.accidental);
        if (midi !== null) {
          const range = RANGES[pos.voice];
          if (midi < range.min || midi > range.max) {
            this.h.onRejected(`Fora da extensão d${pos.voice === 'ped' ? 'a' : 'o'} ${VOICE_NAMES[pos.voice]} (${midiToNoteName(range.min)}–${midiToNoteName(range.max)}).`);
            return;
          }
        }
        this.h.onInsert({ voice: pos.voice, midi, dia: midi === null ? undefined : pos.dia, startBeat: beat });
      });
    }

    _hideGhost() {
      if (this.ghost) this.ghost.style.display = 'none';
    }
  }

  const ScoreViewModule = { ScoreView, LAYOUT, locate, beatToX, noteDia };
  Organum.ScoreView = ScoreView;
  Organum.ScoreLayout = { LAYOUT, locate, beatToX, diaToY };
  if (typeof module !== 'undefined' && module.exports) module.exports = ScoreViewModule;
})(typeof window !== 'undefined' ? window : globalThis);
