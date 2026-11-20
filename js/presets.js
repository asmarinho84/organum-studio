/**
 * Organum Studio — obras e exercícios pré-carregados.
 *
 * As peças de J.S. Bach são de domínio público; as partituras abaixo são
 * adaptações didáticas simplificadas, não edições críticas.
 */
(function (root) {
  'use strict';

  const Organum = (root.Organum = root.Organum || {});

  const PRESETS = {
    // Introdução da Tocata (BWV 565) — adaptação didática simplificada.
    toccata: {
      title: "Tocata em Ré Menor (Introdução, arr. simplificado) — J.S. Bach",
      bpm: 72,
      measures: 4,
      notes: [
        { id: "t1", voice: "rh", midi: 81, startBeat: 0, duration: 0.5, acc: "", tie: false },
        { id: "t2", voice: "lh", midi: 69, startBeat: 0, duration: 0.5, acc: "", tie: false },
        { id: "t3", voice: "rh", midi: 79, startBeat: 0.5, duration: 0.5, acc: "", tie: false },
        { id: "t4", voice: "lh", midi: 67, startBeat: 0.5, duration: 0.5, acc: "", tie: false },
        { id: "t5", voice: "rh", midi: 81, startBeat: 1, duration: 2, acc: "", tie: true },
        { id: "t6", voice: "lh", midi: 69, startBeat: 1, duration: 2, acc: "", tie: true },
        { id: "t7", voice: "rh", midi: 81, startBeat: 3, duration: 1, acc: "", tie: false },
        { id: "t8", voice: "lh", midi: 69, startBeat: 3, duration: 1, acc: "", tie: false },
        { id: "t9", voice: "rh", midi: 79, startBeat: 4, duration: 0.5, acc: "", tie: false },
        { id: "t10", voice: "lh", midi: 67, startBeat: 4, duration: 0.5, acc: "", tie: false },
        { id: "t11", voice: "rh", midi: 77, startBeat: 4.5, duration: 0.5, acc: "", tie: false },
        { id: "t12", voice: "lh", midi: 65, startBeat: 4.5, duration: 0.5, acc: "", tie: false },
        { id: "t13", voice: "rh", midi: 76, startBeat: 5, duration: 0.5, acc: "", tie: false },
        { id: "t14", voice: "lh", midi: 64, startBeat: 5, duration: 0.5, acc: "", tie: false },
        { id: "t15", voice: "rh", midi: 74, startBeat: 5.5, duration: 0.5, acc: "", tie: false },
        { id: "t16", voice: "lh", midi: 62, startBeat: 5.5, duration: 0.5, acc: "", tie: false },
        { id: "t17", voice: "rh", midi: 73, startBeat: 6, duration: 1, acc: "#", tie: false },
        { id: "t18", voice: "lh", midi: 61, startBeat: 6, duration: 1, acc: "#", tie: false },
        { id: "t19", voice: "rh", midi: 74, startBeat: 7, duration: 1, acc: "", tie: false },
        { id: "t20", voice: "lh", midi: 62, startBeat: 7, duration: 1, acc: "", tie: false },
        { id: "t21", voice: "ped", midi: 38, startBeat: 8, duration: 4, acc: "", tie: true, pedalTech: "E^" },
        { id: "t22", voice: "lh", midi: 50, startBeat: 8, duration: 4, acc: "", tie: false },
        { id: "t23", voice: "rh", midi: 61, startBeat: 8.5, duration: 0.5, acc: "#", tie: false },
        { id: "t24", voice: "rh", midi: 64, startBeat: 9, duration: 0.5, acc: "", tie: false },
        { id: "t25", voice: "rh", midi: 67, startBeat: 9.5, duration: 0.5, acc: "", tie: false },
        { id: "t26", voice: "rh", midi: 70, startBeat: 10, duration: 0.5, acc: "b", tie: false },
        { id: "t27", voice: "rh", midi: 73, startBeat: 10.5, duration: 0.5, acc: "#", tie: false },
        { id: "t28", voice: "rh", midi: 76, startBeat: 11, duration: 1, acc: "", tie: false },
        { id: "t29", voice: "ped", midi: 38, startBeat: 12, duration: 2, acc: "", tie: false, pedalTech: "E^" },
        { id: "t30", voice: "lh", midi: 53, startBeat: 12, duration: 2, acc: "", tie: false },
        { id: "t31", voice: "lh", midi: 57, startBeat: 12, duration: 2, acc: "", tie: false },
        { id: "t32", voice: "rh", midi: 74, startBeat: 12, duration: 2, acc: "", tie: false },
        { id: "t33", voice: "rh", midi: 77, startBeat: 12, duration: 2, acc: "", tie: false },
        { id: "t34", voice: "ped", midi: 45, startBeat: 14, duration: 1, acc: "", tie: false, pedalTech: "D^" },
        { id: "t35", voice: "lh", midi: 52, startBeat: 14, duration: 1, acc: "", tie: false },
        { id: "t36", voice: "rh", midi: 73, startBeat: 14, duration: 1, acc: "#", tie: false },
        { id: "t37", voice: "ped", midi: 38, startBeat: 15, duration: 1, acc: "", tie: false, pedalTech: "Eo" },
        { id: "t38", voice: "lh", midi: 50, startBeat: 15, duration: 1, acc: "", tie: false },
        { id: "t39", voice: "rh", midi: 74, startBeat: 15, duration: 1, acc: "", tie: false },
      ],
      dynamics: [
        { beat: 0, mark: "f", value: 0.85 },
        { beat: 4, mark: "p", value: 0.35 },
        { beat: 6, mark: "cresc.", value: 0.65 },
        { beat: 8, mark: "ff", value: 1 },
      ],
    },

    // Coral BWV 147 — adaptação didática simplificada a 3 vozes.
    jesu: {
      title: "Coral: Jesus Alegria dos Homens (arr. simplificado) — J.S. Bach",
      bpm: 82,
      measures: 4,
      notes: [
        { id: "j1", voice: "ped", midi: 43, startBeat: 0, duration: 2, acc: "", tie: false, pedalTech: "E^" },
        { id: "j2", voice: "ped", midi: 47, startBeat: 2, duration: 2, acc: "", tie: false, pedalTech: "D^" },
        { id: "j3", voice: "lh", midi: 50, startBeat: 0, duration: 1, acc: "", tie: false },
        { id: "j4", voice: "lh", midi: 55, startBeat: 1, duration: 1, acc: "", tie: false },
        { id: "j5", voice: "lh", midi: 50, startBeat: 2, duration: 1, acc: "", tie: false },
        { id: "j6", voice: "lh", midi: 55, startBeat: 3, duration: 1, acc: "", tie: false },
        { id: "j7", voice: "rh", midi: 67, startBeat: 0, duration: 0.5, acc: "", tie: false },
        { id: "j8", voice: "rh", midi: 69, startBeat: 0.5, duration: 0.5, acc: "", tie: false },
        { id: "j9", voice: "rh", midi: 71, startBeat: 1, duration: 0.5, acc: "", tie: false },
        { id: "j10", voice: "rh", midi: 74, startBeat: 1.5, duration: 0.5, acc: "", tie: false },
        { id: "j11", voice: "rh", midi: 72, startBeat: 2, duration: 1, acc: "", tie: false },
        { id: "j12", voice: "rh", midi: 76, startBeat: 3, duration: 0.5, acc: "", tie: false },
        { id: "j13", voice: "rh", midi: 74, startBeat: 3.5, duration: 0.5, acc: "", tie: false },
        { id: "j14", voice: "ped", midi: 48, startBeat: 4, duration: 2, acc: "", tie: false, pedalTech: "Do" },
        { id: "j15", voice: "ped", midi: 50, startBeat: 6, duration: 2, acc: "", tie: false, pedalTech: "D^" },
        { id: "j16", voice: "lh", midi: 52, startBeat: 4, duration: 1, acc: "", tie: false },
        { id: "j17", voice: "lh", midi: 55, startBeat: 5, duration: 1, acc: "", tie: false },
        { id: "j18", voice: "lh", midi: 54, startBeat: 6, duration: 1, acc: "#", tie: false },
        { id: "j19", voice: "lh", midi: 57, startBeat: 7, duration: 1, acc: "", tie: false },
        { id: "j20", voice: "rh", midi: 74, startBeat: 4, duration: 0.5, acc: "", tie: false },
        { id: "j21", voice: "rh", midi: 79, startBeat: 4.5, duration: 0.5, acc: "", tie: false },
        { id: "j22", voice: "rh", midi: 78, startBeat: 5, duration: 0.5, acc: "#", tie: false },
        { id: "j23", voice: "rh", midi: 79, startBeat: 5.5, duration: 0.5, acc: "", tie: false },
        { id: "j24", voice: "rh", midi: 74, startBeat: 6, duration: 0.5, acc: "", tie: false },
        { id: "j25", voice: "rh", midi: 71, startBeat: 6.5, duration: 0.5, acc: "", tie: false },
        { id: "j26", voice: "rh", midi: 67, startBeat: 7, duration: 0.5, acc: "", tie: false },
        { id: "j27", voice: "rh", midi: 69, startBeat: 7.5, duration: 0.5, acc: "", tie: false },
        { id: "j28", voice: "ped", midi: 40, startBeat: 8, duration: 2, acc: "", tie: false, pedalTech: "E^" },
        { id: "j29", voice: "ped", midi: 48, startBeat: 10, duration: 2, acc: "", tie: false, pedalTech: "D^" },
        { id: "j30", voice: "lh", midi: 55, startBeat: 8, duration: 2, acc: "", tie: false },
        { id: "j31", voice: "lh", midi: 52, startBeat: 10, duration: 2, acc: "", tie: false },
        { id: "j32", voice: "rh", midi: 71, startBeat: 8, duration: 0.5, acc: "", tie: false },
        { id: "j33", voice: "rh", midi: 72, startBeat: 8.5, duration: 0.5, acc: "", tie: false },
        { id: "j34", voice: "rh", midi: 74, startBeat: 9, duration: 0.5, acc: "", tie: false },
        { id: "j35", voice: "rh", midi: 76, startBeat: 9.5, duration: 0.5, acc: "", tie: false },
        { id: "j36", voice: "rh", midi: 74, startBeat: 10, duration: 0.5, acc: "", tie: false },
        { id: "j37", voice: "rh", midi: 72, startBeat: 10.5, duration: 0.5, acc: "", tie: false },
        { id: "j38", voice: "rh", midi: 71, startBeat: 11, duration: 0.5, acc: "", tie: false },
        { id: "j39", voice: "rh", midi: 69, startBeat: 11.5, duration: 0.5, acc: "", tie: false },
        { id: "j40", voice: "ped", midi: 38, startBeat: 12, duration: 2, acc: "", tie: false, pedalTech: "Eo" },
        { id: "j41", voice: "ped", midi: 43, startBeat: 14, duration: 2, acc: "", tie: false, pedalTech: "E^" },
        { id: "j42", voice: "lh", midi: 54, startBeat: 12, duration: 2, acc: "#", tie: false },
        { id: "j43", voice: "lh", midi: 50, startBeat: 14, duration: 2, acc: "", tie: false },
        { id: "j44", voice: "rh", midi: 71, startBeat: 12, duration: 0.5, acc: "", tie: false },
        { id: "j45", voice: "rh", midi: 67, startBeat: 12.5, duration: 0.5, acc: "", tie: false },
        { id: "j46", voice: "rh", midi: 69, startBeat: 13, duration: 0.5, acc: "", tie: false },
        { id: "j47", voice: "rh", midi: 66, startBeat: 13.5, duration: 0.5, acc: "#", tie: false },
        { id: "j48", voice: "rh", midi: 67, startBeat: 14, duration: 2, acc: "", tie: false },
      ],
      dynamics: [
        { beat: 0, mark: "mf", value: 0.65 },
        { beat: 4, mark: "f", value: 0.85 },
        { beat: 8, mark: "p", value: 0.35 },
        { beat: 12, mark: "f", value: 0.85 },
      ],
    },

    // Exercício original de coordenação mãos + pés + expressão.
    exercise: {
      title: "Exercício Guiado: Coordenação Mãos + Pedaleira + Expressão",
      bpm: 64,
      measures: 4,
      notes: [
        { id: "e1", voice: "ped", midi: 36, startBeat: 0, duration: 2, acc: "", tie: false, pedalTech: "E^" },
        { id: "e2", voice: "ped", midi: 38, startBeat: 2, duration: 2, acc: "", tie: false, pedalTech: "Eo" },
        { id: "e3", voice: "lh", midi: 48, startBeat: 0, duration: 4, acc: "", tie: false },
        { id: "e4", voice: "rh", midi: 64, startBeat: 0, duration: 1, acc: "", tie: false },
        { id: "e5", voice: "rh", midi: 67, startBeat: 1, duration: 1, acc: "", tie: false },
        { id: "e6", voice: "rh", midi: 65, startBeat: 2, duration: 1, acc: "", tie: false },
        { id: "e7", voice: "rh", midi: 69, startBeat: 3, duration: 1, acc: "", tie: false },
        { id: "e8", voice: "ped", midi: 40, startBeat: 4, duration: 2, acc: "", tie: false, pedalTech: "D^" },
        { id: "e9", voice: "ped", midi: 41, startBeat: 6, duration: 2, acc: "", tie: false, pedalTech: "Do" },
        { id: "e10", voice: "lh", midi: 52, startBeat: 4, duration: 2, acc: "", tie: false },
        { id: "e11", voice: "lh", midi: 53, startBeat: 6, duration: 2, acc: "", tie: false },
        { id: "e12", voice: "rh", midi: 67, startBeat: 4, duration: 1, acc: "", tie: false },
        { id: "e13", voice: "rh", midi: 72, startBeat: 5, duration: 1, acc: "", tie: false },
        { id: "e14", voice: "rh", midi: 69, startBeat: 6, duration: 1, acc: "", tie: false },
        { id: "e15", voice: "rh", midi: 74, startBeat: 7, duration: 1, acc: "", tie: false },
        { id: "e16", voice: "ped", midi: 43, startBeat: 8, duration: 1, acc: "", tie: false, pedalTech: "D^" },
        { id: "e17", voice: "ped", midi: 40, startBeat: 9, duration: 1, acc: "", tie: false, pedalTech: "E^" },
        { id: "e18", voice: "ped", midi: 45, startBeat: 10, duration: 1, acc: "", tie: false, pedalTech: "D^" },
        { id: "e19", voice: "ped", midi: 47, startBeat: 11, duration: 1, acc: "", tie: false, pedalTech: "Do" },
        { id: "e20", voice: "lh", midi: 55, startBeat: 8, duration: 2, acc: "", tie: false },
        { id: "e21", voice: "lh", midi: 53, startBeat: 10, duration: 2, acc: "", tie: false },
        { id: "e22", voice: "rh", midi: 71, startBeat: 8, duration: 2, acc: "", tie: false },
        { id: "e23", voice: "rh", midi: 74, startBeat: 10, duration: 2, acc: "", tie: false },
        { id: "e24", voice: "ped", midi: 48, startBeat: 12, duration: 4, acc: "", tie: false, pedalTech: "D^" },
        { id: "e25", voice: "lh", midi: 48, startBeat: 12, duration: 4, acc: "", tie: false },
        { id: "e26", voice: "lh", midi: 55, startBeat: 12, duration: 4, acc: "", tie: false },
        { id: "e27", voice: "rh", midi: 72, startBeat: 12, duration: 4, acc: "", tie: false },
        { id: "e28", voice: "rh", midi: 76, startBeat: 12, duration: 4, acc: "", tie: false },
      ],
      dynamics: [
        { beat: 0, mark: "pp", value: 0.2 },
        { beat: 4, mark: "mp", value: 0.5 },
        { beat: 8, mark: "f", value: 0.85 },
        { beat: 12, mark: "ff", value: 1 },
      ],
    },

    // Partitura em branco.
    empty: {
      title: "Partitura Vazia (Composição Própria)",
      bpm: 80,
      measures: 4,
      notes: [
      ],
      dynamics: [
        { beat: 0, mark: "mf", value: 0.65 },
      ],
    },

  };

  Organum.PRESETS = PRESETS;
  if (typeof module !== 'undefined' && module.exports) module.exports = PRESETS;
})(typeof window !== 'undefined' ? window : globalThis);
