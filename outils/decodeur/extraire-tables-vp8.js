'use strict';
// Extrait les tables NUMÉRIQUES du format VP8 depuis le texte de la RFC 6386 (fichier lu par la porte réseau : domaine public du format, code source sous licence BSD du dépôt de la RFC) et écrit
// v2/banc-telephone/public/decodeur-webp-tables.mjs. Les tables ne sont pas retapées : elles sont LUES, comptées (dénominateur imprimé) et leur somme est écrite dans le fichier.
// Usage : node extraire-tables-vp8.js <rfc6386.txt> <sortie.mjs>
const fs = require('fs');
const [, , entree, sortie] = process.argv;
let t = fs.readFileSync(entree, 'utf8').split(/\r?\n/).filter(l => !/^Bankoski, et al\./.test(l) && !/^RFC 6386 VP8 Data Format/.test(l)).join('\n');
t = t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
function table(marqueur, attendu, depuis = 0) {
    const i = t.indexOf(marqueur, depuis);
    if (i < 0) throw new Error('marqueur absent : ' + marqueur);
    const debut = t.indexOf('{', t.indexOf('=', i));
    let prof = 0, fin = debut;
    for (; fin < t.length; fin++) { if (t[fin] === '{') prof++; else if (t[fin] === '}') { prof--; if (!prof) break; } }
    const nombres = (t.slice(debut, fin + 1).match(/-?\d+/g) || []).map(Number);
    if (nombres.length !== attendu) throw new Error(`${marqueur} : ${nombres.length} nombres lus, ${attendu} attendus`);
    return nombres;
}
const T = {
    DC_Q: table('dc_q_lookup[128]', 128),
    AC_Q: table('ac_q_lookup[128]', 128),
    KF_BMODE_PROBS: table('kf_b_mode_probs[10][10][9]', 900),
    COEFF_UPDATE_PROBS: table('k_coeff_entropy_update_probs[BLOCK_TYPES][COEFF_BANDS]', 1056),
    COEFF_PROBS: table('k_default_coeff_probs [BLOCK_TYPES][COEFF_BANDS]', 1056)
};
const somme = a => a.reduce((s, x) => s + x, 0);
let s = '// GÉNÉRÉ par outils/decodeur/extraire-tables-vp8.js depuis la RFC 6386 (VP8) : ne pas éditer à la main. Tables numériques du format (quantification, probabilités).\n';
for (const [k, v] of Object.entries(T)) s += `export const ${k} = Uint8Array.from([${v.join(',')}]);   // ${v.length} valeurs, somme ${somme(v)}\n`;
// DC_Q et AC_Q dépassent 255 : en Int16Array
s = s.replace('export const DC_Q = Uint8Array', 'export const DC_Q = Int16Array').replace('export const AC_Q = Uint8Array', 'export const AC_Q = Int16Array');
fs.writeFileSync(sortie, s);
for (const [k, v] of Object.entries(T)) console.log(k, v.length, 'somme', somme(v), 'max', Math.max(...v));
