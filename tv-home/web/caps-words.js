// The widget settings words (each setting's label and help in widget-caps.js) in every language, one
// table for the TV home and the phone pages: tv-words.js swaps them on the TV, phone-words.js on the
// phone's Home settings page, so a setting reads the same on both. widget-caps.js stays in English and
// is never changed for this: add a line here for each English label or help, with every language.
//   "Units": { es: "Unidades", "es-MX": ..., it: ..., de: ..., fr: ..., tr: ..., "sr-Latn-RS": ...,
//              pl: ..., nl: ..., cs: ..., he: ..., ar: ..., pt: ..., ro: ..., "zh-CN": ... },
// A line with a gap ({n}) keeps what was in it. es-MX may be left out where Mexico says it like Spain.
// node scripts/caps-words-todo.mjs lists every label and help that has no line here yet.
(function () {
  "use strict";
  window.CouchCapsWords = {
    words: {
    }
  };
})();
