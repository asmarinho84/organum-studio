/**
 * Organum Studio — interface do console: registros, manuais, pedaleira e pedal
 * de expressão. Só manipula DOM; o som é responsabilidade de quem chama.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});
  const Utils = Organum.Utils || (typeof require === 'function' ? require('./utils.js') : null);
  const { clamp, isBlackKey, midiToNoteName } = Utils;

  const DIVISION_LABEL = { rh: 'Mão direita', lh: 'Mão esquerda', ped: 'Pedaleira' };
  const KEY_SELECTOR = '[data-division][data-midi]';

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function span(className, text) {
    const s = el('span', className);
    s.textContent = text;
    return s;
  }

  // ------------------------------------------------------------- Registros

  function renderStops(container, synth, onToggle) {
    container.textContent = '';
    for (const stop of synth.stops) {
      const btn = el('button', `stop-knob${stop.active ? ' active' : ''}`, {
        type: 'button',
        title: `Ativar/desativar registro ${stop.name}`,
        'aria-pressed': String(stop.active),
      });
      btn.appendChild(span('knob-face', stop.short));
      btn.appendChild(span('knob-title', stop.name));
      btn.addEventListener('click', () => {
        const on = synth.toggleStop(stop.id);
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
        onToggle(stop, on);
      });
      container.appendChild(btn);
    }
  }

  // --------------------------------------------------------------- Teclados

  function decorateKey(node, division, midi) {
    node.dataset.division = division;
    node.dataset.midi = String(midi);
    node.setAttribute('role', 'button');
    node.setAttribute('aria-pressed', 'false');
    node.setAttribute('aria-label', `${DIVISION_LABEL[division]} ${midiToNoteName(midi)}`);
  }

  /** Teclado de manual com teclas brancas em flex e pretas posicionadas em %. */
  function buildManual(container, division, startMidi, endMidi, shortcuts, opts) {
    container.textContent = '';
    const fixed = opts && opts.whiteWidthPx ? opts.whiteWidthPx : 0;
    const whiteRow = el('div', 'white-keys-row');
    container.appendChild(whiteRow);

    const whites = [];
    for (let m = startMidi; m <= endMidi; m++) if (!isBlackKey(m)) whites.push(m);
    const whiteWidth = 100 / whites.length;
    // Largura fixa por tecla (console real: mesma escala nos dois manuais); senão preenche o contêiner.
    container.style.width = fixed ? `${whites.length * fixed}px` : '';
    container.style.minWidth = fixed ? `${whites.length * fixed}px` : '';
    container.style.marginLeft = fixed && opts.offsetPx ? `${opts.offsetPx}px` : '';

    whites.forEach((midi, idx) => {
      const key = el('div', 'key-white');
      decorateKey(key, division, midi);
      if (shortcuts[midi]) key.appendChild(span('shortcut-lbl', shortcuts[midi]));
      key.appendChild(span('note-lbl', midiToNoteName(midi)));
      whiteRow.appendChild(key);

      const next = midi + 1;
      if (next <= endMidi && isBlackKey(next)) {
        const black = el('div', 'key-black');
        decorateKey(black, division, next);
        const w = whiteWidth * 0.62;
        black.style.width = `${w}%`;
        black.style.left = `${(idx + 1) * whiteWidth - w / 2}%`;
        black.appendChild(span('note-lbl', midiToNoteName(next)));
        container.appendChild(black);
      }
    });
  }

  /** Pedaleira cromática (naturais em fileira + sustenidos elevados). */
  function buildPedalboard(container, startMidi, endMidi, shortcuts, opts) {
    container.textContent = '';
    const fixed = opts && opts.naturalWidthPx ? opts.naturalWidthPx : 0;
    const row = el('div', 'pedal-naturals-row');
    container.appendChild(row);

    const naturals = [];
    for (let m = startMidi; m <= endMidi; m++) if (!isBlackKey(m)) naturals.push(m);
    const width = 100 / naturals.length;
    container.style.width = fixed ? `${naturals.length * fixed}px` : '';
    container.style.minWidth = fixed ? `${naturals.length * fixed}px` : '';
    container.style.marginLeft = fixed && opts.offsetPx ? `${opts.offsetPx}px` : '';

    naturals.forEach((midi, idx) => {
      const pedal = el('div', 'pedal-natural');
      decorateKey(pedal, 'ped', midi);
      const sc = shortcuts[midi] ? ` [${shortcuts[midi]}]` : '';
      pedal.appendChild(span('ped-lbl', `${midiToNoteName(midi)}${sc}`));
      row.appendChild(pedal);

      const next = midi + 1;
      if (next <= endMidi && isBlackKey(next)) {
        const sharp = el('div', 'pedal-sharp');
        decorateKey(sharp, 'ped', next);
        const w = width * 0.56;
        sharp.style.width = `${w}%`;
        sharp.style.left = `${(idx + 1) * width - w / 2}%`;
        sharp.appendChild(span('ped-lbl', midiToNoteName(next)));
        container.appendChild(sharp);
      }
    });
  }

  // ------------------------------------------------- Ponteiro (mouse/toque)

  /**
   * Liga mouse/toque/caneta às teclas. Suporta vários dedos (acordes) e glissando
   * com o mouse (arrastar por cima das teclas). Em toque, deslizar na horizontal
   * rola o teclado (o navegador cancela o ponteiro e a nota é solta).
   */
  function bindPointerKeys(roots, { press, release }) {
    const active = new Map(); // pointerId -> { key, division, midi }
    const keyFrom = (node) => (node && node.closest ? node.closest(KEY_SELECTOR) : null);
    const inRoots = (node) => roots.some((r) => r.contains(node));

    const startKey = (pid, key) => {
      const division = key.dataset.division;
      const midi = Number(key.dataset.midi);
      active.set(pid, { key, division, midi });
      press(division, midi, `ptr:${pid}`);
    };
    const endKey = (pid) => {
      const cur = active.get(pid);
      if (!cur) return;
      active.delete(pid);
      release(cur.division, cur.midi, `ptr:${pid}`);
    };

    for (const rootEl of roots) {
      rootEl.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const key = keyFrom(e.target);
        if (!key) return;
        e.preventDefault();
        endKey(e.pointerId);
        startKey(e.pointerId, key);
      });
      rootEl.addEventListener('contextmenu', (e) => {
        if (keyFrom(e.target)) e.preventDefault();
      });
    }

    window.addEventListener('pointermove', (e) => {
      const cur = active.get(e.pointerId);
      if (!cur || e.pointerType === 'touch') return;
      const under = keyFrom(document.elementFromPoint(e.clientX, e.clientY));
      if (under === cur.key) return;
      endKey(e.pointerId);
      if (under && inRoots(under)) startKey(e.pointerId, under);
    });

    const finish = (e) => endKey(e.pointerId);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', () => {
      for (const pid of Array.from(active.keys())) endKey(pid);
    });
  }

  // -------------------------------------------------------------- Realce

  /**
   * Mantém o realce visual das teclas. Indexa as teclas uma única vez e só toca
   * no DOM quando o estado de uma tecla realmente muda.
   */
  function createHighlighter(rootEl) {
    const keys = new Map(); // keyId -> { el, active, target, badge, badgeText }
    rootEl.querySelectorAll(KEY_SELECTOR).forEach((node) => {
      keys.set(`${node.dataset.division}:${node.dataset.midi}`, {
        el: node,
        active: false,
        target: false,
        badge: null,
        badgeText: '',
      });
    });

    const techLabel = (tech) => tech.replace('E', 'PE ').replace('D', 'PD ');

    return {
      /**
       * @param {Set<string>} activeKeys keyIds soando
       * @param {Map<string,string|null>} targets keyIds a tocar (Modo Ensino) -> técnica de pé
       * @param {Map<string,string>} badges keyIds -> técnica de pé (rótulo PE/PD)
       */
      update(activeKeys, targets, badges) {
        for (const [id, k] of keys) {
          const isActive = activeKeys.has(id);
          const isTarget = targets.has(id);
          if (isActive !== k.active) {
            k.active = isActive;
            k.el.classList.toggle('active', isActive);
            k.el.setAttribute('aria-pressed', String(isActive));
          }
          if (isTarget !== k.target) {
            k.target = isTarget;
            k.el.classList.toggle('tutor-target', isTarget);
          }
          if (id.startsWith('ped:')) {
            const tech = badges.get(id) || targets.get(id) || null;
            const text = tech ? techLabel(tech) : '';
            if (text !== k.badgeText) {
              k.badgeText = text;
              if (text) {
                if (!k.badge) {
                  k.badge = el('span', 'foot-badge');
                  k.el.appendChild(k.badge);
                }
                k.badge.textContent = text;
              } else if (k.badge) {
                k.badge.remove();
                k.badge = null;
              }
            }
          }
        }
      },
    };
  }

  // -------------------------------------------------- Pedal de expressão

  /**
   * Pedal de expressão (caixa expressiva): arrastar na vertical, roda do mouse e
   * teclado (setas/Page/Home/End). Devolve `setDisplay(level, mark)`.
   */
  function createExpressionPedal(els, { getLevel, onLevel, labelFor }) {
    const { well, shoe, bar, pctText, badge } = els;

    function setDisplay(level, mark) {
      const v = clamp(level, 0.1, 1);
      const pct = Math.round(v * 100);
      shoe.style.transform = `rotateX(${(26 - v * 42).toFixed(1)}deg)`; // +26° fechado … −16° aberto
      bar.style.width = `${pct}%`;
      pctText.textContent = `Caixa: ${pct}%`;
      badge.textContent = mark || labelFor(v);
      well.setAttribute('aria-valuenow', String(pct));
      well.setAttribute('aria-valuetext', `${pct}% (${badge.textContent})`);
    }

    let dragging = false;
    let startY = 0;
    let startVal = 0;

    well.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startVal = getLevel();
      try { well.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      well.focus({ preventScroll: true });
    });
    well.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      onLevel(clamp(startVal + (startY - e.clientY) / 95, 0.1, 1)); // arrastar p/ cima abre
    });
    const end = () => { dragging = false; };
    well.addEventListener('pointerup', end);
    well.addEventListener('pointercancel', end);
    well.addEventListener('wheel', (e) => {
      e.preventDefault();
      onLevel(clamp(getLevel() + (e.deltaY < 0 ? 0.06 : -0.06), 0.1, 1));
    }, { passive: false });
    well.addEventListener('keydown', (e) => {
      const steps = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.15, PageDown: -0.15 };
      if (e.key in steps) {
        e.preventDefault();
        onLevel(clamp(getLevel() + steps[e.key], 0.1, 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        onLevel(0.1);
      } else if (e.key === 'End') {
        e.preventDefault();
        onLevel(1);
      }
    });

    return { setDisplay };
  }

  const ConsoleUI = {
    renderStops,
    buildManual,
    buildPedalboard,
    bindPointerKeys,
    createHighlighter,
    createExpressionPedal,
  };
  Organum.ConsoleUI = ConsoleUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = ConsoleUI;
})(typeof window !== 'undefined' ? window : globalThis);
