/**
 * Organum Studio — aplicação (orquestra áudio, partitura, console, tutor,
 * metrônomo, histórico, persistência e atalhos).
 */
(function () {
  'use strict';

  const O = window.Organum;
  const { Utils, Score, PRESETS, PipeOrganSynth, Metronome, Scheduler, MidiExport, Input, ConsoleUI, ScoreView, Tutor, MetronomeUI } = O;
  const { clamp, midiToNoteName, expressionValueToDynamicLabel } = Utils;
  const $ = (id) => document.getElementById(id);

  const STORAGE_KEY = 'organum-studio:v1';
  const HISTORY_LIMIT = 100;
  const PRESET_KEYS = Object.keys(PRESETS);

  // ------------------------------------------------------------------ estado

  const synth = new PipeOrganSynth();
  const metronome = new Metronome(synth);

  const state = {
    score: Score.cloneScore(PRESETS.toccata),
    presetKey: 'toccata',
    editor: {
      duration: 1,
      isRest: false,
      accidental: '',
      tie: false,
      pedalTech: 'E^',
      dynMark: 'mf',
      dynValue: 0.65,
      eraser: false,
    },
    playback: { currentBeat: 0, loop: false, activeNoteIds: new Set() },
    metroPanelOpen: true,
  };

  const history = { undo: [], redo: [] };
  let noteIndex = new Map();
  let scoreView = null;
  let scheduler = null;
  let tutor = null;
  let keyPresses = null;
  let highlighter = null;
  let expressionPedal = null;
  let metronomeUI = null;
  let midi = null;
  let beatFlashing = false;

  // ------------------------------------------------------------------ toast

  function showToast(msg) {
    const toast = $('toastBanner');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // ------------------------------------------------------------ persistência

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 1,
          score: state.score,
          presetKey: state.presetKey,
          stops: synth.getStopState(),
          metronome: metronome.toJSON(),
          masterVolume: synth.masterVolume,
          loop: state.playback.loop,
          metroPanelOpen: state.metroPanelOpen,
        })
      );
    } catch (e) {
      /* armazenamento indisponível (modo privado, file://, cota): segue sem salvar */
    }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return;
      state.score = Score.sanitizeScore(data.score).score;
      state.presetKey = PRESET_KEYS.includes(data.presetKey) || data.presetKey === 'custom' ? data.presetKey : 'custom';
      synth.applyStopState(data.stops);
      metronome.applyConfig(data.metronome);
      if (typeof data.masterVolume === 'number') synth.masterVolume = clamp(data.masterVolume, 0, 1);
      state.playback.loop = data.loop === true;
      state.metroPanelOpen = data.metroPanelOpen !== false;
    } catch (e) {
      state.score = Score.cloneScore(PRESETS.toccata);
      state.presetKey = 'toccata';
    }
  }

  // --------------------------------------------------------- histórico (undo)

  function updateHistoryButtons() {
    $('btnUndo').disabled = history.undo.length === 0;
    $('btnRedo').disabled = history.redo.length === 0;
  }

  function pushUndo() {
    history.undo.push(JSON.stringify(state.score));
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
    history.redo.length = 0;
    updateHistoryButtons();
  }

  function restoreSnapshot(json) {
    state.score = JSON.parse(json);
    markCustom();
    syncBpmControls();
    afterScoreChange();
  }

  function undo() {
    if (!history.undo.length) return;
    history.redo.push(JSON.stringify(state.score));
    restoreSnapshot(history.undo.pop());
    updateHistoryButtons();
    showToast('Desfeito.');
  }

  function redo() {
    if (!history.redo.length) return;
    history.undo.push(JSON.stringify(state.score));
    restoreSnapshot(history.redo.pop());
    updateHistoryButtons();
    showToast('Refeito.');
  }

  /** Aplica uma edição na partitura com histórico, redesenho e salvamento. */
  function edit(mutator) {
    pushUndo();
    mutator(state.score);
    markCustom();
    afterScoreChange();
  }

  function markCustom() {
    if (state.presetKey === 'custom') return;
    state.presetKey = 'custom';
    $('presetSelect').value = 'custom';
  }

  function afterScoreChange() {
    noteIndex = new Map(state.score.notes.map((n) => [n.id, n]));
    scoreView.render();
    if (scheduler) scheduler.refreshScore();
    if (tutor && tutor.active) tutor.rebuild();
    refreshHighlights();
    renderLyrics();
    scheduleSave();
  }

  /** Letras (estrofes) e autoria do hino, quando o JSON as traz. */
  function renderLyrics() {
    const panel = $('lyricsPanel');
    const lyrics = state.score.lyrics;
    const composer = state.score.composer;
    panel.hidden = !((lyrics && lyrics.length) || composer);
    $('lyricsComposer').textContent = composer || '';
    const body = $('lyricsBody');
    body.textContent = '';
    for (const verse of lyrics || []) {
      const p = document.createElement('p');
      p.className = 'lyrics-verse';
      p.textContent = verse; // textContent: nunca interpreta HTML
      body.appendChild(p);
    }
  }

  // ----------------------------------------------------------------- tempo

  function syncBpmControls() {
    const bpm = state.score.bpm;
    $('bpmSlider').value = String(bpm);
    $('bpmValue').textContent = String(bpm);
    if (metronomeUI) metronomeUI.syncBpm(bpm);
  }

  function setBpm(raw) {
    const bpm = Math.round(clamp(Number(raw) || 72, 20, 300));
    state.score.bpm = bpm;
    syncBpmControls();
    scheduleSave();
  }

  // ------------------------------------------------------ pedal de expressão

  /** Atualiza só o desenho do pedal (a automação de áudio fica por conta do agendador). */
  function showExpression(level, mark) {
    expressionPedal.setDisplay(level, mark);
  }

  function setExpressionLevel(level, mark) {
    const v = clamp(level, 0.1, 1);
    synth.setExpression(v);
    showExpression(v, mark);
  }

  // ------------------------------------------------------ realce das teclas

  function refreshHighlights() {
    if (!highlighter) return;
    const active = keyPresses.keys();
    const badges = new Map();
    for (const id of state.playback.activeNoteIds) {
      const n = noteIndex.get(id);
      if (!n || n.midi === null) continue;
      const key = `${n.voice}:${n.midi}`;
      active.add(key);
      if (n.voice === 'ped' && n.pedalTech) badges.set(key, n.pedalTech);
    }
    highlighter.update(active, tutor ? tutor.pendingTargets() : new Map(), badges);
  }

  function setActiveNotes(ids) {
    state.playback.activeNoteIds = ids;
    scoreView.setActive(ids);
    refreshHighlights();
  }

  // --------------------------------------------------------------- teclas

  function pressKey(division, midiNote, source) {
    synth.ensureContext();
    const first = keyPresses.press(division, midiNote, source);
    if (first && tutor.active) tutor.handleInput(division, midiNote);
  }

  function releaseKey(division, midiNote, source) {
    keyPresses.release(division, midiNote, source);
  }

  // ----------------------------------------------------------- reprodução

  function totalBeats() {
    return state.score.measures * Score.beatsPerMeasure(state.score);
  }

  function startPlayback() {
    if (tutor.active) toggleTutor(false);
    let from = state.playback.currentBeat;
    if (from >= totalBeats() - 1e-6) from = 0;
    scheduler.start({
      mode: 'score',
      fromBeat: from,
      click: metronome.clickWithPlayback,
      countInBars: metronome.countInBars,
      loop: state.playback.loop,
    });
  }

  function pausePlayback() {
    if (!scheduler.running) return;
    const wasScore = scheduler.mode === 'score';
    const beat = scheduler.pause();
    if (wasScore) {
      state.playback.currentBeat = beat;
      scoreView.setCursor(beat);
    }
  }

  function stopPlayback() {
    scheduler.stop();
    state.playback.currentBeat = 0;
    scoreView.setCursor(0);
    $('scoreScrollContainer').scrollLeft = 0;
    setActiveNotes(new Set());
  }

  function toggleMetronome() {
    if (scheduler.running && scheduler.mode === 'metronome') {
      scheduler.stop();
      return;
    }
    scheduler.start({ mode: 'metronome' });
  }

  function onSchedulerFrame(info) {
    if (info.mode === 'score') {
      const beat = info.beat;
      state.playback.currentBeat = beat;
      const dyn = Score.getDynamicAtBeat(state.score.dynamics, beat);
      showExpression(dyn.value, dyn.mark);

      const ids = new Set();
      if (!info.countingIn) {
        for (const n of state.score.notes) {
          if (n.midi !== null && beat >= n.startBeat && beat < n.startBeat + n.duration) ids.add(n.id);
        }
      }
      const prev = state.playback.activeNoteIds;
      let changed = prev.size !== ids.size;
      if (!changed) for (const id of ids) if (!prev.has(id)) { changed = true; break; }
      if (changed) setActiveNotes(ids);

      scoreView.setCursor(beat);
      scoreView.followCursor(beat);
    }

    const showBeats = info.mode === 'metronome' || metronome.clickWithPlayback || info.countingIn;
    if (showBeats) {
      metronomeUI.onFrame(info, info.mode === 'metronome');
      beatFlashing = true;
    } else if (beatFlashing) {
      metronomeUI.clearFlash();
      beatFlashing = false;
    }
  }

  function onSchedulerState({ running, mode }) {
    $('btnPlay').classList.toggle('active', running && mode === 'score');
    metronomeUI.setRunning(running && mode === 'metronome');
    if (!running) {
      beatFlashing = false;
      metronomeUI.clearFlash();
      if (state.playback.activeNoteIds.size) setActiveNotes(new Set());
    }
  }

  function onSchedulerFinish() {
    state.playback.currentBeat = 0;
    scoreView.setCursor(0);
    $('scoreScrollContainer').scrollLeft = 0;
    showToast('Execução da obra concluída!');
  }

  // ---------------------------------------------------------------- tutor

  function renderTutor() {
    const panel = $('tutorPanel');
    const v = tutor.view();
    panel.classList.toggle('visible', v.active);
    if (!v.active) {
      refreshHighlights();
      return;
    }

    const rh = $('tutorRhList');
    const lh = $('tutorLhList');
    const ped = $('tutorPedList');
    const exp = $('tutorExpList');

    if (v.total === 0) {
      $('tutorStepBadge').textContent = 'Partitura vazia';
      $('tutorProgressFill').style.width = '0%';
      $('tutorPctLabel').textContent = '0%';
      for (const node of [rh, lh, ped]) node.textContent = '—';
      rh.textContent = 'Insira notas no pentagrama acima';
      exp.textContent = '—';
      refreshHighlights();
      return;
    }

    $('tutorStepBadge').textContent = `Passo ${v.index + 1} / ${v.total}`;
    $('tutorProgressFill').style.width = `${v.pct}%`;
    $('tutorPctLabel').textContent = `${v.pct}%`;

    const fill = (container, voice, emptyText) => {
      container.textContent = '';
      const list = v.step.notes.filter((n) => n.voice === voice);
      if (list.length === 0) {
        const s = document.createElement('span');
        s.className = 'tutor-empty';
        s.textContent = emptyText;
        container.appendChild(s);
        return;
      }
      for (const n of list) {
        const done = v.satisfied.has(n.id);
        const pill = document.createElement('span');
        pill.className = `tutor-pill ${done ? 'done' : 'pending'}`;
        const tech = n.pedalTech ? ` (${n.pedalTech.replace('E', 'PE ').replace('D', 'PD ')})` : '';
        pill.textContent = `${done ? '✓' : '●'} ${midiToNoteName(n.midi, n.acc === 'b')}${tech}`;
        container.appendChild(pill);
      }
    };
    fill(rh, 'rh', 'Aguardar / Livre');
    fill(lh, 'lh', 'Aguardar / Livre');
    fill(ped, 'ped', 'Aguardar / Livre');

    exp.textContent = '';
    const dyn = document.createElement('span');
    dyn.className = 'tutor-pill done';
    dyn.textContent = `${v.step.dynLabel} — ${Math.round(v.step.dynValue * 100)}%`;
    exp.appendChild(dyn);

    refreshHighlights();
  }

  function toggleTutor(force) {
    const next = typeof force === 'boolean' ? force : !tutor.active;
    if (next === tutor.active) return;
    const btn = $('btnTutor');
    btn.classList.toggle('active', next);
    btn.setAttribute('aria-pressed', String(next));
    btn.textContent = next ? '🎓 Ensino Ativo' : '🎓 Modo Ensino';
    $('btnTutorSkip').hidden = !next;
    if (next) {
      if (scheduler.running && scheduler.mode === 'score') stopPlayback();
      tutor.start();
      showToast('Modo Ensino iniciado! Toque as notas iluminadas no console ou via MIDI.');
    } else {
      tutor.stop();
    }
  }

  // ----------------------------------------------------- carregar partituras

  function loadScore(score, { presetKey, message }) {
    pushUndo();
    scheduler.stop();
    state.score = score;
    state.presetKey = presetKey;
    $('presetSelect').value = presetKey;
    state.playback.currentBeat = 0;
    syncBpmControls();
    const dyn = Score.getDynamicAtBeat(score.dynamics, 0);
    setExpressionLevel(dyn.value, dyn.mark);
    setActiveNotes(new Set());
    afterScoreChange();
    scoreView.setCursor(0);
    $('scoreScrollContainer').scrollLeft = 0;
    if (message) showToast(message);
  }

  // --------------------------------------------------------- modal de arquivo

  const modal = { el: null, opener: null };

  function openModal() {
    modal.opener = document.activeElement;
    const ta = $('jsonTextarea');
    ta.value = JSON.stringify({ format: 'organum-studio-score', version: 1, ...state.score }, null, 2);
    modal.el.classList.add('open');
    ta.focus();
  }

  function closeModal() {
    modal.el.classList.remove('open');
    if (modal.opener && modal.opener.focus) modal.opener.focus();
  }

  function trapFocus(e) {
    if (e.key !== 'Tab' || !modal.el.classList.contains('open')) return;
    const f = Array.from(modal.el.querySelectorAll('button, textarea, input, select')).filter((n) => !n.disabled && !n.hidden);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function fileBaseName() {
    const base = (state.score.title || 'organum-studio')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60);
    return base || 'organum-studio';
  }

  function importFromText(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      showToast('Erro: o texto não é um JSON válido.');
      return;
    }
    try {
      const { score, dropped } = Score.sanitizeScore(parsed);
      loadScore(score, { presetKey: 'custom', message: (dropped ? `Importado. ${dropped} nota(s) inválida(s) ou fora da extensão foram ignoradas.` : 'Partitura importada com sucesso! (Ctrl+Z desfaz)') + ` [${(score.breaths || []).length} respirações, ${score.notes.filter((n) => n.fermata).length} fermatas]` });
      closeModal();
    } catch (e) {
      showToast(`Erro: ${e.message}`);
    }
  }

  function bindModal() {
    modal.el = $('jsonModal');
    $('btnFileModal').addEventListener('click', openModal);
    $('btnCloseModal').addEventListener('click', closeModal);
    modal.el.addEventListener('mousedown', (e) => {
      if (e.target === modal.el) closeModal();
    });
    modal.el.addEventListener('keydown', trapFocus);

    $('btnCopyJson').addEventListener('click', async () => {
      const ta = $('jsonTextarea');
      try {
        await navigator.clipboard.writeText(ta.value);
      } catch (e) {
        ta.select();
        document.execCommand('copy');
      }
      showToast('JSON copiado para a área de transferência!');
    });
    $('btnDownloadJson').addEventListener('click', () => {
      downloadBlob(new Blob([$('jsonTextarea').value], { type: 'application/json' }), `${fileBaseName()}.json`);
    });
    $('btnDownloadMidi').addEventListener('click', () => {
      const bytes = MidiExport.buildMidiFile(state.score);
      downloadBlob(new Blob([bytes], { type: 'audio/midi' }), `${fileBaseName()}.mid`);
      showToast('Arquivo MIDI exportado.');
    });
    $('btnOpenFile').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        showToast('Arquivo grande demais (máx. 2 MB).');
        return;
      }
      importFromText(await file.text());
    });
    $('btnImportJson').addEventListener('click', () => importFromText($('jsonTextarea').value));
  }

  // ---------------------------------------------------------- barra de ferramentas

  function bindRadio(containerId, attr, onPick) {
    const buttons = Array.from($(containerId).querySelectorAll(`[${attr}]`));
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        for (const b of buttons) b.classList.remove('active');
        btn.classList.add('active');
        onPick(btn);
      });
    }
  }

  function bindToggle(id, onToggle) {
    const btn = $(id);
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('active');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
      onToggle(on);
    });
  }

  function bindToolbar() {
    const ed = state.editor;

    bindRadio('rhythmCluster', 'data-dur', (b) => { ed.duration = Number(b.dataset.dur); });
    bindRadio('accidentalCluster', 'data-acc', (b) => { ed.accidental = b.dataset.acc; });
    bindRadio('pedalTechCluster', 'data-ptech', (b) => { ed.pedalTech = b.dataset.ptech; });
    bindRadio('dynamicCluster', 'data-dyn', (b) => {
      ed.dynMark = b.dataset.dyn;
      ed.dynValue = Number(b.dataset.dval);
    });
    bindToggle('btnRestToggle', (on) => { ed.isRest = on; });
    bindToggle('btnTieToggle', (on) => { ed.tie = on; });
    bindToggle('btnEraserToggle', (on) => {
      ed.eraser = on;
      $('scoreScrollContainer').classList.toggle('eraser-mode', on);
    });

    $('btnAddMeasure').addEventListener('click', () => {
      if (state.score.measures >= Score.LIMITS.maxMeasures) {
        showToast(`Limite de ${Score.LIMITS.maxMeasures} compassos.`);
        return;
      }
      edit((s) => { s.measures++; });
      showToast(`Compasso adicionado (total: ${state.score.measures}).`);
    });
    $('btnRemoveMeasure').addEventListener('click', () => {
      if (state.score.measures <= 1) return;
      edit((s) => {
        s.measures--;
        const max = s.measures * Score.beatsPerMeasure(s);
        s.notes = s.notes.filter((n) => n.startBeat < max);
        s.dynamics = s.dynamics.filter((d) => d.beat < max);
        if (!s.dynamics.length) s.dynamics = [{ beat: 0, mark: 'mf', value: 0.65 }];
      });
      if (state.playback.currentBeat >= totalBeats()) state.playback.currentBeat = 0;
      showToast('Último compasso removido. (Ctrl+Z desfaz)');
    });
    $('btnClearScore').addEventListener('click', () => {
      stopPlayback();
      edit((s) => {
        s.notes = [];
        s.dynamics = [{ beat: 0, mark: 'mf', value: 0.65 }];
      });
      showToast('Partitura limpa. (Ctrl+Z desfaz)');
    });
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
  }

  function bindHeader() {
    $('presetSelect').addEventListener('change', (e) => {
      const key = e.target.value;
      if (!PRESETS[key]) return;
      loadScore(Score.cloneScore(PRESETS[key]), { presetKey: key, message: `Obra carregada: ${PRESETS[key].title} (Ctrl+Z desfaz)` });
    });

    $('btnPlay').addEventListener('click', startPlayback);
    $('btnPause').addEventListener('click', pausePlayback);
    $('btnStop').addEventListener('click', stopPlayback);
    bindToggle('btnLoop', (on) => {
      state.playback.loop = on;
      if (scheduler.running && scheduler.mode === 'score') scheduler.loop = on;
      scheduleSave();
    });
    $('bpmSlider').addEventListener('input', (e) => setBpm(Number(e.target.value)));

    $('btnTutor').addEventListener('click', () => toggleTutor());
    $('btnTutorSkip').addEventListener('click', () => tutor.skip());
    $('btnTutorRestart').addEventListener('click', () => tutor.rebuild());

    $('btnMetroPanel').addEventListener('click', () => {
      state.metroPanelOpen = !state.metroPanelOpen;
      applyMetroPanelVisibility();
      scheduleSave();
    });

    $('masterVolume').addEventListener('input', (e) => {
      synth.setMasterVolume(Number(e.target.value) / 100);
      scheduleSave();
    });
  }

  function applyMetroPanelVisibility() {
    $('metronomePanel').hidden = !state.metroPanelOpen;
    $('btnMetroPanel').setAttribute('aria-expanded', String(state.metroPanelOpen));
    $('btnMetroPanel').classList.toggle('active', state.metroPanelOpen);
  }

  // ---------------------------------------------------------------- MIDI

  function initMidi() {
    const badge = $('midiBadge');
    const text = $('midiText');
    const select = $('midiRouting');

    for (const [value, label] of Object.entries(Input.MIDI_ROUTING)) select.add(new Option(label, value));

    midi = new Input.MidiManager({
      onNoteOn: pressKey,
      onNoteOff: releaseKey,
      onExpression: (v) => setExpressionLevel(v),
      onPanic: () => keyPresses.releaseAll(),
      onStatus: (msg, connected) => {
        text.textContent = msg;
        badge.classList.toggle('connected', connected);
        select.hidden = !connected;
      },
    });

    select.addEventListener('change', () => { midi.routing = select.value; });
    badge.addEventListener('click', () => {
      if (!midi.supported) {
        showToast('Seu navegador não suporta Web MIDI (use Chrome, Edge ou Opera).');
        return;
      }
      midi.connect();
    });
    if (midi.supported) midi.autoConnectIfGranted();
    else text.textContent = 'MIDI: não suportado';
  }

  // ---------------------------------------------------------- atalhos globais

  function bindGlobalShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.el.classList.contains('open')) {
        closeModal();
        return;
      }
      if (modal.el.classList.contains('open') || Input.isTypingTarget(e.target)) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && !e.altKey && e.code === 'KeyY') {
        e.preventDefault();
        redo();
        return;
      }

      if (e.code === 'Space' && !mod && !e.altKey && !e.repeat) {
        const interactive = e.target.closest && e.target.closest('button, a, select, input, textarea, [role="slider"]');
        // Shift+Espaço (metrônomo) vale mesmo com um botão focado; Espaço puro respeita o botão.
        if (interactive && !e.shiftKey) return;
        e.preventDefault();
        if (e.shiftKey) toggleMetronome();
        else if (scheduler.running && scheduler.mode === 'score') pausePlayback();
        else startPlayback();
      }
    });
  }

  // ------------------------------------------------- ajustes (tema, console, teclas)

  const PREFS_KEY = 'organum-studio-prefs-v1';
  const THEMES = ['escuro', 'madeira', 'catedral'];
  const prefs = { theme: 'escuro', layout: 'compacto', pcKeys: 'atual' };
  const REAL_LAYOUT = { whiteWidthPx: 34, pedalRatio: 1.8, upper: [53, 96], lower: [41, 84], pedal: [36, 48] };

  function loadPrefs() {
    try {
      const d = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (!d || typeof d !== 'object') return;
      if (THEMES.includes(d.theme)) prefs.theme = d.theme;
      if (d.layout === 'real') prefs.layout = 'real';
      if (Object.prototype.hasOwnProperty.call(Input.PC_KEY_PRESETS, d.pcKeys)) prefs.pcKeys = d.pcKeys;
    } catch (e) {
      /* sem preferências salvas: usa o padrão */
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      /* armazenamento indisponível */
    }
  }

  function applyTheme() {
    document.documentElement.dataset.theme = prefs.theme;
  }

  const isBlackMidi = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

  function shortcutHint(division) {
    const labels = Input.pcKeyLabels(division, prefs.pcKeys);
    const mids = Object.keys(labels).map(Number).sort((a, b) => a - b);
    const whites = mids.filter((m) => !isBlackMidi(m)).map((m) => labels[m]);
    const blacks = mids.filter(isBlackMidi).map((m) => labels[m]);
    return `Atalhos PC: ${whites.join(' ')}${blacks.length ? ` (pretas: ${blacks.join(' ')})` : ''}`;
  }

  let scrollSyncBound = false;
  function bindScrollSync() {
    if (scrollSyncBound) return;
    scrollSyncBound = true;
    const scrollers = [...document.querySelectorAll('.keyboard-scroll'), document.querySelector('.pedalboard-frame')];
    let lock = false;
    for (const sc of scrollers) {
      sc.addEventListener('scroll', () => {
        if (lock || !document.querySelector('.organ-console').classList.contains('console-real')) return;
        lock = true;
        for (const other of scrollers) if (other !== sc) other.scrollLeft = sc.scrollLeft;
        lock = false;
      }, { passive: true });
    }
  }

  /** Monta (ou remonta) manuais e pedaleira conforme a disposição e o padrão de teclas. */
  function buildKeyboards() {
    Input.setPcKeyPreset(prefs.pcKeys);
    const real = prefs.layout === 'real';
    const consoleEl = document.querySelector('.organ-console');
    consoleEl.classList.toggle('console-real', real);
    const lbl = (d) => Input.pcKeyLabels(d, prefs.pcKeys);

    if (real) {
      // Medidas do órgão Giannini: dois manuais de 44 teclas (F a C), o superior uma oitava acima
      // e alinhado nota sobre nota com o inferior; pedaleira de 13 pedais (C a C) à esquerda.
      const L = REAL_LAYOUT;
      const w = L.whiteWidthPx;
      ConsoleUI.buildManual($('manualUpper'), 'rh', L.upper[0], L.upper[1], lbl('rh'), { whiteWidthPx: w, offsetPx: 7 * w });
      ConsoleUI.buildManual($('manualLower'), 'lh', L.lower[0], L.lower[1], lbl('lh'), { whiteWidthPx: w });
      ConsoleUI.buildPedalboard($('pedalboardBed'), L.pedal[0], L.pedal[1], lbl('ped'), { naturalWidthPx: Math.round(w * L.pedalRatio) });
      $('manualUpperTitle').textContent = 'MANUAL II — TECLADO SUPERIOR (Mão Direita • F3 a C7)';
      $('manualLowerTitle').textContent = 'MANUAL I — TECLADO INFERIOR (Mão Esquerda • F2 a C6)';
      $('pedalTitle').textContent = 'PEDALEIRA (C2 a C3 — 13 pedais)';
      requestAnimationFrame(() => {
        for (const sc of [...document.querySelectorAll('.keyboard-scroll'), document.querySelector('.pedalboard-frame')]) sc.scrollLeft = 0;
      });
    } else {
      ConsoleUI.buildManual($('manualUpper'), 'rh', 48, 84, lbl('rh'));
      ConsoleUI.buildManual($('manualLower'), 'lh', 36, 72, lbl('lh'));
      ConsoleUI.buildPedalboard($('pedalboardBed'), 36, 55, lbl('ped'));
      $('manualUpperTitle').textContent = 'MANUAL II — TECLADO SUPERIOR (Mão Direita • C3 a C6)';
      $('manualLowerTitle').textContent = 'MANUAL I — TECLADO INFERIOR (Mão Esquerda • C2 a C5)';
      $('pedalTitle').textContent = 'PEDALEIRA CROMÁTICA (C2 a G3 — Pés Esquerdo & Direito)';
    }
    $('manualUpperHint').textContent = shortcutHint('rh');
    $('manualLowerHint').textContent = shortcutHint('lh');
    $('pedalHint').textContent = shortcutHint('ped');
    bindScrollSync();

    highlighter = ConsoleUI.createHighlighter(consoleEl);
    if (!pointerBound) {
      pointerBound = true;
      ConsoleUI.bindPointerKeys([$('manualUpper'), $('manualLower'), $('pedalboardBed')], { press: pressKey, release: releaseKey });
    }
    refreshHighlights();
  }
  let pointerBound = false;

  function initPrefsUI() {
    const sel = $('pcKeysSelect');
    sel.textContent = '';
    for (const [key, p] of Object.entries(Input.PC_KEY_PRESETS)) {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = p.label;
      sel.appendChild(o);
    }
    $('themeSelect').value = prefs.theme;
    $('layoutSelect').value = prefs.layout;
    sel.value = prefs.pcKeys;
    $('themeSelect').addEventListener('change', (e) => {
      prefs.theme = THEMES.includes(e.target.value) ? e.target.value : 'escuro';
      applyTheme();
      savePrefs();
    });
    $('layoutSelect').addEventListener('change', (e) => {
      prefs.layout = e.target.value === 'real' ? 'real' : 'compacto';
      keyPresses.releaseAll && keyPresses.releaseAll();
      buildKeyboards();
      savePrefs();
    });
    sel.addEventListener('change', (e) => {
      if (!Object.prototype.hasOwnProperty.call(Input.PC_KEY_PRESETS, e.target.value)) return;
      prefs.pcKeys = e.target.value;
      buildKeyboards();
      savePrefs();
      showToast('Teclas do PC: ' + Input.PC_KEY_PRESETS[prefs.pcKeys].label);
    });
    const btn = $('btnPrefs');
    const panel = $('prefsPanel');
    const setOpen = (open) => {
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', () => setOpen(panel.hidden));
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
    });
  }

  // ------------------------------------------------------------ inicialização

  function init() {
    loadSaved();
    noteIndex = new Map(state.score.notes.map((n) => [n.id, n]));

    // Registros e volume
    ConsoleUI.renderStops($('stopsGrid'), synth, () => scheduleSave());
    $('masterVolume').value = String(Math.round(synth.masterVolume * 100));

    // Ajustes (tema, disposição do console, teclas do PC), manuais e pedaleira
    loadPrefs();
    applyTheme();
    initPrefsUI();
    keyPresses = new Input.KeyPresses({ synth, onChange: () => refreshHighlights() });
    buildKeyboards();
    ConsoleUI.bindPointerKeys([$('manualUpper'), $('manualLower'), $('pedalboardBed')], { press: pressKey, release: releaseKey });

    expressionPedal = ConsoleUI.createExpressionPedal(
      { well: $('swellWell'), shoe: $('swellShoe'), bar: $('expBarFill'), pctText: $('expPctText'), badge: $('expDynBadge') },
      { getLevel: () => synth.expression, onLevel: (v) => setExpressionLevel(v), labelFor: expressionValueToDynamicLabel }
    );

    // Partitura
    scoreView = new ScoreView({
      svg: $('scoreSvg'),
      scroller: $('scoreScrollContainer'),
      readout: $('hoverPitchReadout'),
      getScore: () => state.score,
      getEditor: () => state.editor,
      handlers: {
        onInsert({ voice, midi: midiNote, dia, startBeat }) {
          const ed = state.editor;
          const dupIdx = state.score.notes.findIndex(
            (n) => n.voice === voice && Math.abs(n.startBeat - startBeat) < 0.05 && n.midi === midiNote
          );
          if (dupIdx !== -1) {
            edit((s) => { s.notes.splice(dupIdx, 1); });
            showToast('Nota alternada/removida.');
            return;
          }
          const note = {
            id: Score.makeNoteId(),
            voice,
            midi: midiNote,
            startBeat,
            duration: Math.min(ed.duration, totalBeats() - startBeat),
            acc: midiNote === null ? '' : ed.accidental,
            tie: midiNote === null ? false : ed.tie,
          };
          if (dia !== undefined) note.dia = dia;
          if (voice === 'ped') note.pedalTech = ed.pedalTech;
          edit((s) => {
            s.notes.push(note);
            s.notes.sort((a, b) => a.startBeat - b.startBeat);
          });
          if (midiNote !== null) {
            synth.ensureContext();
            synth.scheduleNote(midiNote, voice, synth.ctx.currentTime, 0.28);
          }
        },
        onInsertDynamic(beat) {
          const ed = state.editor;
          edit((s) => {
            s.dynamics = s.dynamics.filter((d) => Math.abs(d.beat - beat) > 0.05);
            s.dynamics.push({ beat, mark: ed.dynMark, value: ed.dynValue });
            s.dynamics.sort((a, b) => a.beat - b.beat);
          });
          showToast(`Dinâmica "${ed.dynMark}" inserida.`);
        },
        onEraseNote(id) {
          const idx = state.score.notes.findIndex((n) => n.id === id);
          if (idx === -1) return;
          edit((s) => { s.notes.splice(idx, 1); });
          showToast('Nota removida.');
        },
        onEraseDynamic(idx) {
          if (!state.score.dynamics[idx]) return;
          edit((s) => { s.dynamics.splice(idx, 1); });
          showToast('Marca de dinâmica removida.');
        },
        onRejected: showToast,
      },
    });
    scoreView.render();

    // Tutor
    tutor = new Tutor({
      getScore: () => state.score,
      onChange: renderTutor,
      onStep: (step) => {
        state.playback.currentBeat = step.beat;
        setExpressionLevel(step.dynValue, step.dynLabel);
        scoreView.setCursor(step.beat);
        scoreView.centerOn(step.beat);
      },
      onComplete: (stats) => showToast(`Parabéns! Lição concluída — precisão de ${Math.round(stats.accuracy * 100)}%.`),
    });

    // Metrônomo e agendador
    metronomeUI = new MetronomeUI({
      metronome,
      getBpm: () => state.score.bpm,
      setBpm,
      onToggle: toggleMetronome,
      onChange: scheduleSave,
    });
    metronomeUI.init();

    scheduler = new Scheduler({
      synth,
      metronome,
      getScore: () => state.score,
      getBpm: () => state.score.bpm,
      setBpm,
      onFrame: onSchedulerFrame,
      onFinish: onSchedulerFinish,
      onStateChange: onSchedulerState,
    });

    // Controles
    bindToolbar();
    bindHeader();
    bindModal();
    bindGlobalShortcuts();
    Input.initComputerKeyboard({
      onPress: pressKey,
      onRelease: releaseKey,
      onReleaseAll: (source) => keyPresses.releaseSource(source),
    });
    initMidi();

    // Estado inicial da interface
    $('presetSelect').value = state.presetKey;
    $('btnLoop').classList.toggle('active', state.playback.loop);
    $('btnLoop').setAttribute('aria-pressed', String(state.playback.loop));
    syncBpmControls();
    applyMetroPanelVisibility();
    const dyn = Score.getDynamicAtBeat(state.score.dynamics, 0);
    showExpression(dyn.value, dyn.mark);
    synth.expression = clamp(dyn.value, 0.05, 1);
    updateHistoryButtons();
    refreshHighlights();

    // Cria o AudioContext no primeiro gesto (reduz a latência da primeira nota)
    const warm = () => {
      try { synth.ensureContext(); } catch (e) { showToast('Seu navegador não suporta Web Audio.'); }
    };
    window.addEventListener('pointerdown', warm, { once: true, capture: true });
    window.addEventListener('keydown', warm, { once: true, capture: true });

    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNow();
    });

    O.app = { state, synth, metronome, get scheduler() { return scheduler; }, get tutor() { return tutor; }, history, setBpm, startPlayback, stopPlayback, toggleMetronome, toggleTutor, undo, redo };
  }

  window.addEventListener('DOMContentLoaded', init);
})();
