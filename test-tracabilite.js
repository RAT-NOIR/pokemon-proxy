// node test-tracabilite.js — la TRAÇABILITÉ COMMUNE de la doctrine de collecte (testeur, 2026-10-17) : « source, adresse d'origine, date, et retirable: true sur chaque image ».
// UNE règle (collecte-cartes/tracabilite.js), appelée par CHAQUE collecteur d'images pour le document `images` ET l'entrée `cartes.images` (§21 bis). Écrite par ce qu'elle autorise :
// une image sans adresse d'origine ou sans date ne s'écrit pas. Aucun champ ajouté ici ne nomme une source (la source vit dans `source`, champ interne que le site ne publie pas).
const fs = require('fs');
const path = require('path');
const Tr = require('./collecte-cartes/tracabilite');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const leve = f => { try { f(); return null; } catch (e) { return e.message; } };
const D = new Date('2026-10-17T20:00:00Z');

const c = Tr.champsTracabilite({ urlOriginal: 'https://hote.example/a.png', collecteLe: D });
verifier('champsTracabilite : retirable: true, l\'adresse d\'origine, la date — et rien d\'autre', [c.retirable, c.urlOriginal, c.collecteLe.toISOString(), Object.keys(c).sort()], [true, 'https://hote.example/a.png', D.toISOString(), ['collecteLe', 'retirable', 'urlOriginal']]);
verifier('une date en chaîne ISO (cache disque) est rendue en Date', Tr.champsTracabilite({ urlOriginal: 'u', collecteLe: '2026-10-17T20:00:00.000Z' }).collecteLe instanceof Date, true);
for (const [nom, o] of [['sans adresse', { collecteLe: D }], ['adresse vide', { urlOriginal: '', collecteLe: D }], ['adresse non chaîne', { urlOriginal: 12, collecteLe: D }], ['adresse d\'espaces', { urlOriginal: '   ', collecteLe: D }], ['sans date', { urlOriginal: 'u' }], ['date invalide', { urlOriginal: 'u', collecteLe: 'pas une date' }], ['date null', { urlOriginal: 'u', collecteLe: null }]]) {
    verifier(`écriture ${nom} : LÈVE (une garde s'écrit par ce qu'elle autorise)`, /traçabilité/.test(leve(() => Tr.champsTracabilite(o)) || ''), true);
}
verifier('appel sans argument : LÈVE', /traçabilité/.test(leve(() => Tr.champsTracabilite()) || ''), true);
// l'entrée d'une jointure : elle relit le document (adresse, date de téléchargement) ; sans date connue, la date d'écriture (dite)
verifier('champsDeLEntree : reprend urlOriginal et la date de téléchargement du document', (e => [e.urlOriginal, e.collecteLe.toISOString(), e.retirable])(Tr.champsDeLEntree({ urlOriginal: 'u', telechargeLe: D }, new Date('2030-01-01'))), ['u', D.toISOString(), true]);
verifier('champsDeLEntree : `collecteLe` du document prime sur `telechargeLe`', Tr.champsDeLEntree({ urlOriginal: 'u', collecteLe: D, telechargeLe: new Date('2000-01-01') }).collecteLe.toISOString(), D.toISOString());
verifier('champsDeLEntree : document ancien sans date → la date d\'écriture (injectée)', Tr.champsDeLEntree({ urlOriginal: 'u' }, new Date('2030-01-01')).collecteLe.toISOString(), '2030-01-01T00:00:00.000Z');
verifier('champsDeLEntree : document sans adresse → LÈVE', /traçabilité/.test(leve(() => Tr.champsDeLEntree({ telechargeLe: D })) || ''), true);

// ── CHAQUE collecteur d'images l'appelle, pour le document ET pour l'entrée ──────────────────────────────────────────
const lire = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const sansCommentaires = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const COLLECTEURS = ['collecteur-images.js', 'collecteur-images-bulba.js', 'collecteur-images-tcgdex.js', 'collecteur-images-tpc.js', 'collecteur-images-pikaqian.js', 'collecteur-images-ptcgio.js', 'collecteur-images-pokumon.js', 'collecteur-images-pokemoncom.js'];
for (const f of COLLECTEURS) {
    const t = sansCommentaires(lire(f));
    verifier(`${f} : le document \`images\` (champsTracabilite) ET l'entrée de la carte (champsDeLEntree) passent par le module`, [/\bchampsTracabilite\(/.test(t), /\bchampsDeLEntree\(/.test(t)], [true, true]);
    verifier(`${f} : aucune copie de la règle (« retirable: true » écrit en dur)`, /retirable\s*:\s*true/.test(t), false);
}
// aucun champ ajouté ne nomme une source
verifier('tracabilite.js n\'écrit aucun nom de source dans ses champs', /Bulbapedia|TCGdex|artofpkm|TPC|PikaQian|pokemontcg|Pokumon|pokemon\.com/i.test(sansCommentaires(lire('collecte-cartes/tracabilite.js'))), false);

console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
process.exit(ko ? 1 : 0);
