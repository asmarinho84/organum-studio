# Organum Studio

[![CI](https://github.com/asmarinho84/organum-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/asmarinho84/organum-studio/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)

Simulador e tutor interativo de **órgão de tubos** que roda direto no navegador, sem build e sem dependências em tempo de execução. Dois manuais, pedaleira, registros, caixa expressiva, partitura editável, Modo Ensino e um **metrônomo profissional**.

**Demo:** `https://asmarinho84.github.io/organum-studio/` (após ativar o GitHub Pages)

## Recursos

- **Console de órgão:** Manual II (C3–C6), Manual I (C2–C5), pedaleira (C2–G3), 8 registros e tremulante, reverberação e caixa expressiva.
- **Entrada:** mouse/toque (com glissando e multitoque), teclado do computador e **Web MIDI** (opcional, com roteamento configurável).
- **Partitura:** três pentagramas (mão direita, esquerda, pedaleira) com ligaduras, acidentes, pausas, dinâmicas (pp–ff, cresc./dim.), técnica de pé; desfazer/refazer (Ctrl+Z / Ctrl+Y).
- **Modo Ensino:** prática passo a passo com as teclas a tocar iluminadas.
- **Arquivos:** importar/exportar JSON e exportar **MIDI** (SMF tipo 1). Salvamento automático local.
- **Obras de exemplo** (domínio público).

### Metrônomo profissional

- Agendamento *lookahead* sobre o relógio do `AudioContext` (Worker de 25 ms), sem deriva e imune ao throttling de abas.
- 20–300 BPM, **tap tempo**, campo numérico editável, indicação de andamento (Adagio, Allegro…).
- Compasso configurável, **acentos por tempo** (acento / normal / suave / mudo) e **subdivisões** (colcheias, tercinas, semicolcheias).
- Timbres, volume, **contagem de entrada** (count-in), clique junto com a partitura e **treinador de andamento** (aumenta N BPM a cada N compassos até um limite).
- Indicador visual de tempos e sincronia com a posição na partitura (compensação de latência de saída).

## Uso

Abra `index.html` no navegador (funciona via `file://`) ou sirva a pasta:

```bash
npm run serve   # http://localhost:8080
```

### Atalhos

| Tecla | Ação |
|---|---|
| `Espaço` | Tocar / pausar a obra |
| `Shift + Espaço` | Ligar / desligar o metrônomo |
| `Ctrl+Z`, `Ctrl+Y` / `Ctrl+Shift+Z` | Desfazer / refazer |
| `A S D F G H J K` | Manual II (teclas pretas: `W E T Y U`) |
| `Z X C V B N M` | Manual I |
| `1`–`8` | Pedaleira |
| `Esc` | Fechar janela de arquivo |

### MIDI

Clique em **MIDI: conectar** (Chrome, Edge ou Opera). O roteamento define quais canais vão para qual manual; o controlador CC#11 move a caixa expressiva.

## Desenvolvimento

```bash
npm install
npm test        # testes unitários (node:test)
npm run lint    # ESLint
npm run build   # gera dist/organum-studio.html (arquivo único)
```

### Arquitetura

Scripts clássicos (sem bundler) em `js/`, expostos no namespace `Organum`, também importáveis em Node para testes:

| Módulo | Função |
|---|---|
| `utils`, `score`, `presets` | Matemática musical, modelo/validação da partitura, obras |
| `synth` | Síntese do órgão (registros, filtro/ganho de caixa, reverb, tremulante) |
| `metronome`, `scheduler` | Clique e agendador único para partitura e metrônomo |
| `input`, `console-ui` | Teclado, MIDI, teclas e pedal de expressão |
| `score-view`, `tutor`, `metronome-ui` | Pentagrama SVG, Modo Ensino, painel do metrônomo |
| `midi-export`, `app` | Exportação SMF e orquestração |

Segurança: CSP restritiva (sem estilos/scripts inline) e todo JSON importado passa por `sanitizeScore`.

## English

Organum Studio is a browser-based pipe organ simulator and tutor (two manuals, pedalboard, stops, swell box, editable score, teaching mode) with a professional metronome (lookahead scheduling, tap tempo, accents, subdivisions, count-in, tempo trainer). No runtime dependencies: open `index.html`. Run `npm test` and `npm run lint` for development.

## Licença

[MIT](LICENSE). A fonte Noto Music (embutida em `css/music-font.css`) está sob a SIL OFL 1.1 (`fonts/OFL.txt`).
