# Changelog

## 1.2.0

### Adicionado
- Respirações (vírgulas) impressas e audíveis (a nota solta antes), dedilhado (inclusive circulado e 1-3), ligaduras de frase, marcas (*), compositor e painel de letras.

## 1.1.0

### Adicionado
- Fórmula de compasso configurável no JSON (`timeSig`: 3/4, 6/8, 2/4…), inclusive no MIDI exportado.
- Fermata (`fermata: true` na nota): desenhada na partitura; o player sustenta o dobro e pausa o tempo.
- Campo opcional `lyrics` (letras) validado na importação.

## 1.0.0

### Adicionado
- Metrônomo profissional (lookahead, tap tempo, acentos, subdivisões, count-in, treinador de andamento, clique com a partitura).
- Desfazer/refazer, salvamento automático, exportação MIDI, importação/exportação JSON validada.
- Testes unitários, ESLint, CI e GitHub Pages.

### Corrigido
- Notas fora da extensão e JSON malicioso agora são rejeitados na importação.
- Notas não iniciadas não eram canceladas corretamente ao parar a reprodução.
- Estilos inline incompatíveis com CSP.
- Voz da nota agora definida pelo pentagrama clicado; tempo único compartilhado entre cabeçalho, metrônomo e reprodutor.

### Mudado
- Código dividido em módulos; fonte musical embutida (sem dependência externa).

## 1.4.0
- Temas: Escuro (original), Madeira de órgão e Catedral (vinho e ouro), no menu ⚙ Ajustes.
- Padrão de teclas do PC selecionável (Atual ou Piano) com rótulos atualizados nas teclas.
- Console "órgão real": manuais C2–C7 alinhados nota sobre nota, superior recuado, pedaleira de 32 pedais centralizada e mais larga, rolagem sincronizada.

## 1.6.0
- Console "Órgão real" conforme o Giannini: manuais de 44 teclas (F a C), superior uma oitava acima e alinhado nota sobre nota; pedaleira de 13 pedais (C a C) à esquerda.
- Aviso na importação com a contagem de respirações e fermatas; respirações mais visíveis.
