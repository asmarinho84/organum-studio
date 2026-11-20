/**
 * Organum Studio — entradas: teclado do computador, Web MIDI e controle de
 * notas pressionadas (com contagem por fonte, para que soltar uma fonte não
 * corte a nota que outra fonte ainda segura).
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});

  // ---------------------------------------------------------------- KeyPresses

  /**
   * Registro de teclas pressionadas. Uma tecla (divisão+altura) pode ser segurada
   * por várias fontes (mouse, toque, teclado do PC, MIDI); o som só termina quando
   * a última fonte solta.
   */
  class KeyPresses {
    /**
     * @param {object} o
     * @param {object} o.synth       PipeOrganSynth
     * @param {Function} [o.onChange] chamado quando o conjunto de teclas muda
     */
    constructor({ synth, onChange }) {
      this.synth = synth;
      this.onChange = onChange || (() => {});
      this.holders = new Map(); // keyId -> Set<source>
    }

    static keyId(division, midi) {
      return `${division}:${midi}`;
    }

    /** @returns {boolean} true se a nota começou a soar agora */
    press(division, midi, source) {
      const id = KeyPresses.keyId(division, midi);
      let set = this.holders.get(id);
      const first = !set;
      if (!set) {
        set = new Set();
        this.holders.set(id, set);
      }
      if (set.has(source)) return false;
      set.add(source);
      if (first) {
        this.synth.noteOn(id, midi, division);
        this.onChange();
      }
      return first;
    }

    release(division, midi, source) {
      const id = KeyPresses.keyId(division, midi);
      const set = this.holders.get(id);
      if (!set || !set.delete(source)) return;
      if (set.size === 0) {
        this.holders.delete(id);
        this.synth.noteOff(id);
        this.onChange();
      }
    }

    /** Solta tudo o que uma fonte segurava (ex.: aba perdeu o foco). */
    releaseSource(source) {
      for (const [id, set] of Array.from(this.holders.entries())) {
        if (set.delete(source) && set.size === 0) {
          this.holders.delete(id);
          this.synth.noteOff(id);
        }
      }
      this.onChange();
    }

    releaseAll() {
      this.holders.clear();
      this.synth.allNotesOff();
      this.onChange();
    }

    keys() {
      return new Set(this.holders.keys());
    }
  }

  // ----------------------------------------------------------- Teclado do PC

  /**
   * Padrões de teclado do computador (por posição física da tecla, `KeyboardEvent.code`).
   * - atual: o padrão original (brancas na fileira ASDF/ZXCV, pretas acima, pedal 1–8).
   * - piano: duas fileiras por manual, como um teclado de piano/DAW (pretas na fileira de cima).
   */
  const PC_KEY_PRESETS = Object.freeze({
    atual: Object.freeze({
      label: 'Atual (A S D F… / Z X C V… / 1–8)',
      map: Object.freeze({
        // Manual II (Mão Direita): C4..C5
        KeyA: ['rh', 60], KeyW: ['rh', 61], KeyS: ['rh', 62], KeyE: ['rh', 63], KeyD: ['rh', 64],
        KeyF: ['rh', 65], KeyT: ['rh', 66], KeyG: ['rh', 67], KeyY: ['rh', 68], KeyH: ['rh', 69],
        KeyU: ['rh', 70], KeyJ: ['rh', 71], KeyK: ['rh', 72],
        // Manual I (Mão Esquerda): C3..B3 (teclas brancas)
        KeyZ: ['lh', 48], KeyX: ['lh', 50], KeyC: ['lh', 52], KeyV: ['lh', 53],
        KeyB: ['lh', 55], KeyN: ['lh', 57], KeyM: ['lh', 59],
        // Pedaleira: C2..C3 (teclas brancas)
        Digit1: ['ped', 36], Digit2: ['ped', 38], Digit3: ['ped', 40], Digit4: ['ped', 41],
        Digit5: ['ped', 43], Digit6: ['ped', 45], Digit7: ['ped', 47], Digit8: ['ped', 48],
      }),
    }),
    piano: Object.freeze({
      label: 'Piano (Q W E R… + números / Z X C V… + S D G H J / teclado numérico)',
      map: Object.freeze({
        // Manual II: C4..E5 — brancas Q..P, pretas na fileira dos números
        KeyQ: ['rh', 60], Digit2: ['rh', 61], KeyW: ['rh', 62], Digit3: ['rh', 63], KeyE: ['rh', 64],
        KeyR: ['rh', 65], Digit5: ['rh', 66], KeyT: ['rh', 67], Digit6: ['rh', 68], KeyY: ['rh', 69],
        Digit7: ['rh', 70], KeyU: ['rh', 71], KeyI: ['rh', 72], Digit9: ['rh', 73], KeyO: ['rh', 74],
        Digit0: ['rh', 75], KeyP: ['rh', 76],
        // Manual I: C3..E4 — brancas Z..M , . /, pretas na fileira de cima
        KeyZ: ['lh', 48], KeyS: ['lh', 49], KeyX: ['lh', 50], KeyD: ['lh', 51], KeyC: ['lh', 52],
        KeyV: ['lh', 53], KeyG: ['lh', 54], KeyB: ['lh', 55], KeyH: ['lh', 56], KeyN: ['lh', 57],
        KeyJ: ['lh', 58], KeyM: ['lh', 59], Comma: ['lh', 60], KeyL: ['lh', 61], Period: ['lh', 62],
        Semicolon: ['lh', 63], Slash: ['lh', 64],
        // Pedaleira: C2..C3 (brancas) no teclado numérico
        Numpad1: ['ped', 36], Numpad2: ['ped', 38], Numpad3: ['ped', 40], Numpad4: ['ped', 41],
        Numpad5: ['ped', 43], Numpad6: ['ped', 45], Numpad7: ['ped', 47], Numpad8: ['ped', 48],
      }),
    }),
  });
  const PC_KEY_MAP = PC_KEY_PRESETS.atual.map;
  let activePcPreset = 'atual';

  function setPcKeyPreset(name) {
    if (PC_KEY_PRESETS[name]) activePcPreset = name;
    return activePcPreset;
  }

  const CODE_LABELS = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';' };
  function codeLabel(code) {
    if (CODE_LABELS[code]) return CODE_LABELS[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return `N${code.slice(6)}`;
    return code;
  }

  /** Rótulos de atalho por altura (midi) para uma divisão, no padrão ativo. */
  function pcKeyLabels(division, presetName) {
    const map = PC_KEY_PRESETS[presetName || activePcPreset].map;
    const out = {};
    for (const [code, [div, midi]] of Object.entries(map)) if (div === division) out[midi] = codeLabel(code);
    return out;
  }

  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }

  /**
   * @param {object} o
   * @param {Function} o.onPress    (division, midi, source)
   * @param {Function} o.onRelease  (division, midi, source)
   * @param {Function} o.onReleaseAll (source)
   */
  function initComputerKeyboard({ onPress, onRelease, onReleaseAll }) {
    const down = new Map(); // code -> [division, midi]

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const entry = PC_KEY_PRESETS[activePcPreset].map[e.code];
      if (!entry || down.has(e.code)) return;
      down.set(e.code, entry);
      onPress(entry[0], entry[1], `pc:${e.code}`);
    });

    window.addEventListener('keyup', (e) => {
      const entry = down.get(e.code);
      if (!entry) return;
      down.delete(e.code);
      onRelease(entry[0], entry[1], `pc:${e.code}`);
    });

    window.addEventListener('blur', () => {
      for (const code of down.keys()) onReleaseAll(`pc:${code}`);
      down.clear();
    });
  }

  // --------------------------------------------------------------------- MIDI

  const MIDI_ROUTING = Object.freeze({
    auto: 'Automático (por região do teclado)',
    channel: 'Por canal (1=Manual II, 2=Manual I, 3=Pedaleira)',
    rh: 'Tudo no Manual II',
    lh: 'Tudo no Manual I',
    ped: 'Tudo na Pedaleira',
  });

  /** Decide a divisão do órgão para uma nota MIDI recebida. Função pura. */
  function routeMidi(routing, channel, note) {
    if (routing === 'rh' || routing === 'lh' || routing === 'ped') return routing;
    if (routing === 'channel') {
      if (channel === 0) return 'rh';
      if (channel === 1) return 'lh';
      if (channel === 2) return 'ped';
    }
    if (note < 48) return 'ped';
    if (note < 60) return 'lh';
    return 'rh';
  }

  class MidiManager {
    /**
     * @param {object} o
     * @param {Function} o.onNoteOn  (division, midi, source)
     * @param {Function} o.onNoteOff (division, midi, source)
     * @param {Function} o.onExpression (value 0–1)
     * @param {Function} o.onPanic   ()
     * @param {Function} o.onStatus  (text, connected)
     */
    constructor(o) {
      this.o = o;
      this.routing = 'auto';
      this.access = null;
      this._held = new Map(); // `${channel}:${note}` -> division (para soltar na divisão certa)
    }

    get supported() {
      return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
    }

    /** Pede acesso MIDI (só após gesto do usuário, para evitar prompt ao abrir a página). */
    async connect() {
      if (!this.supported) {
        this.o.onStatus('MIDI: não suportado', false);
        return false;
      }
      try {
        this.access = await navigator.requestMIDIAccess();
      } catch (e) {
        this.o.onStatus('MIDI: acesso negado', false);
        return false;
      }
      const refresh = () => {
        const inputs = Array.from(this.access.inputs.values());
        for (const input of inputs) input.onmidimessage = (ev) => this.handle(ev);
        if (inputs.length === 0) {
          this.o.onStatus('MIDI: nenhum dispositivo', false);
        } else {
          const name = (inputs[0].name || 'Dispositivo').slice(0, 18);
          this.o.onStatus(`MIDI: ${name}${inputs.length > 1 ? ` +${inputs.length - 1}` : ''}`, true);
        }
      };
      this.access.onstatechange = refresh;
      refresh();
      return true;
    }

    /** Tenta conectar sozinho se o usuário já concedeu permissão antes. */
    async autoConnectIfGranted() {
      if (!this.supported || !navigator.permissions || !navigator.permissions.query) return;
      try {
        const status = await navigator.permissions.query({ name: 'midi' });
        if (status.state === 'granted') await this.connect();
      } catch (e) {
        /* navegador sem suporte à permissão 'midi': aguarda clique do usuário */
      }
    }

    handle(event) {
      const data = event.data;
      if (!data || data.length < 2) return;
      const status = data[0];
      const command = status & 0xf0;
      const channel = status & 0x0f;
      const d1 = data[1];
      const d2 = data.length > 2 ? data[2] : 0;

      if (command === 0xb0) {
        if (d1 === 11 || d1 === 7) this.o.onExpression(d2 / 127); // Expression / Volume
        else if (d1 === 120 || d1 === 123) this.o.onPanic(); // All Sound/Notes Off
        return;
      }

      const held = `${channel}:${d1}`;
      if (command === 0x90 && d2 > 0) {
        const division = routeMidi(this.routing, channel, d1);
        this._held.set(held, division);
        this.o.onNoteOn(division, d1, `midi:${held}`);
      } else if (command === 0x80 || (command === 0x90 && d2 === 0)) {
        const division = this._held.get(held) || routeMidi(this.routing, channel, d1);
        this._held.delete(held);
        this.o.onNoteOff(division, d1, `midi:${held}`);
      }
    }
  }

  const Input = { KeyPresses, PC_KEY_MAP, PC_KEY_PRESETS, setPcKeyPreset, pcKeyLabels, MIDI_ROUTING, routeMidi, MidiManager, initComputerKeyboard, isTypingTarget };
  Organum.Input = Input;
  if (typeof module !== 'undefined' && module.exports) module.exports = Input;
})(typeof window !== 'undefined' ? window : globalThis);
