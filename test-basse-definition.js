// node test-basse-definition.js — la marque `basseDefinition` et le remplacement automatique (décision du testeur, 2026-10-12). Pur : faux modèles en
// mémoire, aucune base, aucun réseau. Ce que le banc garde :
//   · la marque se pose sur la largeur de l'ORIGINAL, par UNE fonction (seuils-images.js) — jamais un nombre recopié ;
//   · une image NON marquée, de la MÊME langue, au même (carte, set, numéro), remplace l'entrée marquée ; jamais l'inverse ;
//   · le document `images` de l'entrée remplacée RESTE (marqué remplacé), l'entrée sort de `cartes.images` ;
//   · une langue différente, inconnue (null) ou absente, un autre set, un autre numéro : rien ne bouge (une garde s'écrit par ce qu'elle autorise).
const fs = require('fs');
const path = require('path');
const B = require('./collecte-cartes/basse-definition');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// ── la marque, d'après la largeur de l'original ────────────────────────────────────────────────────────────────────
verifier('marqueDe : 300 px d\'original → { basseDefinition: true }', B.marqueDe({ wOriginal: 300, w: 300 }), { basseDefinition: true });
verifier('marqueDe : 349 → marquée ; 350 → rien ; 734 → rien', [B.marqueDe({ wOriginal: 349 }), B.marqueDe({ wOriginal: 350 }), B.marqueDe({ wOriginal: 734 })], [{ basseDefinition: true }, {}, {}]);
verifier('marqueDe : c\'est l\'ORIGINAL qui compte, pas le fichier servi (original 1000, servi 700 → pas basse définition)', B.marqueDe({ wOriginal: 1000, w: 700 }), {});
verifier('marqueDe : sans wOriginal, `w` sous le plafond servi (300) est l\'original', B.marqueDe({ w: 300 }), { basseDefinition: true });
verifier('marqueDe : largeur inconnue → pas de marque (inconnu n\'est pas bas)', [B.marqueDe({}), B.marqueDe(null)], [{}, {}]);

// ── la règle de remplacement (pure) ────────────────────────────────────────────────────────────────────────────────
const basse = (o = {}) => ({ set: 'S', source: 'tpc-asie', numero: '001', cleR2: 'tpc-asie/S/001-1-id.webp', w: 300, langue: 'id', basseDefinition: true, ...o });
const bonne = (o = {}) => ({ set: 'S', source: 'tcgdex', numero: '001', cleR2: 'tcgdex/S/001-1.webp', w: 600, langue: 'id', ...o });
const rem = (images, cand) => B.entreesARemplacer(images, cand).map(e => e.cleR2);
verifier('une entrée marquée + une candidate non marquée, même set, même numéro, même langue → l\'entrée marquée est à remplacer', rem([basse()], bonne()), ['tpc-asie/S/001-1-id.webp']);
verifier('le numéro se compare par la clé de la jointure (« 001 » = « 1 »)', rem([basse({ numero: '001' })], bonne({ numero: '1' })), ['tpc-asie/S/001-1-id.webp']);
verifier('un autre numéro → rien', rem([basse()], bonne({ numero: '002' })), []);
verifier('un autre set → rien', rem([basse()], bonne({ set: 'Autre' })), []);
verifier('une autre langue → rien (« de la langue servie » : un visuel d\'une autre langue ne remplace pas)', rem([basse()], bonne({ langue: 'th' })), []);
verifier('langue de la candidate inconnue (null) → rien : on ne remplace pas ce qu\'on ne sait pas être de la même langue', rem([basse()], bonne({ langue: null })), []);
verifier('langue de la candidate ABSENTE → rien', rem([basse()], (({ langue, ...r }) => r)(bonne())), []);
verifier('langue de l\'entrée marquée inconnue (null) → rien', rem([basse({ langue: null })], bonne({ langue: null })), []);
verifier('JAMAIS L\'INVERSE : une candidate marquée ne remplace rien', rem([basse({ cleR2: 'autre.webp', source: 'pikaqian' })], basse({ source: 'tpc-asie' })), []);
verifier('une candidate marquée ne remplace pas non plus une entrée NON marquée', rem([bonne()], basse()), []);
verifier('une candidate dont la largeur est basse sans marque (entrée ancienne) ne remplace rien', rem([basse()], bonne({ w: 300 })), []);
verifier('une entrée NON marquée n\'est jamais remplacée', rem([bonne({ cleR2: 'x.webp' })], bonne({ source: 'artofpkm', cleR2: 'y.webp' })), []);
verifier('la candidate n\'est pas son propre remplacement (même source, même cleR2)', rem([basse({ basseDefinition: true })], { ...basse(), basseDefinition: undefined, w: 600 }), []);
verifier('plusieurs entrées marquées au même (set, numéro, langue) : toutes sortent', rem([basse(), basse({ source: 'pikaqian', cleR2: 'p.webp' })], bonne()), ['tpc-asie/S/001-1-id.webp', 'p.webp']);
verifier('images absentes / non tableau → rien, sans exception', [rem(undefined, bonne()), rem(null, bonne()), rem('x', bonne())], [[], [], []]);
verifier('candidate absente → rien, sans exception', [rem([basse()], null), rem([basse()], undefined)], [[], []]);

// ── l'effet sur les modèles : l'entrée sort de `cartes.images`, le document `images` reste, marqué remplacé ──────────
function fauxModeles(carte, docs) {
    const journal = [];
    const accepte = (d, f) => Object.entries(f).every(([k, v]) => d[k] === v);
    const M = {
        Carte: {
            findById: id => ({ select: () => ({ lean: async () => structuredClone(id === carte._id ? carte : null) }) }),
            updateOne: async (f, u) => { journal.push(['carte', f, u]); for (const [k, v] of Object.entries(u.$pull || {})) carte[k] = carte[k].filter(e => !accepte(e, v)); return { modifiedCount: 1 }; }
        },
        Image: {
            updateOne: async (f, u) => { journal.push(['image', f, u]); const d = docs.find(x => accepte(x, f)); if (d) Object.assign(d, u.$set || {}); return { modifiedCount: d ? 1 : 0 }; }
        }
    };
    return { M, journal };
}
(async () => {
    const carte = { _id: 1, images: [basse(), { set: 'S', source: 'tcgdex', numero: '002', cleR2: 'z.webp', w: 600, langue: 'id' }, { set: 'Autre', source: 'tpc-asie', numero: '001', cleR2: 'a.webp', w: 300, langue: 'id', basseDefinition: true }] };
    const docs = [{ _id: 'tpc-asie/S/1/001/id', source: 'tpc-asie', set: 'S', cleR2: 'tpc-asie/S/001-1-id.webp', etat: 'ok', wOriginal: 300 }, { _id: 'autre', source: 'tpc-asie', set: 'Autre', cleR2: 'a.webp', etat: 'ok' }];
    const { M, journal } = fauxModeles(carte, docs);
    const maintenant = new Date('2026-10-12T10:00:00Z');
    const n = await B.remplacerBasseDefinition(M, 1, bonne(), { maintenant });
    verifier('remplacerBasseDefinition rend le nombre d\'entrées remplacées', n, 1);
    verifier('l\'entrée marquée sort de cartes.images ; les autres (autre numéro, autre set) restent', carte.images.map(e => `${e.set}:${e.source}:${e.numero}`), ['S:tcgdex:002', 'Autre:tpc-asie:001']);
    verifier('le document `images` RESTE, marqué remplacé, avec par quoi', [docs[0].etat, docs[0].remplacePar, docs[0].remplaceLe?.toISOString?.()], ['remplace', { source: 'tcgdex', cleR2: 'tcgdex/S/001-1.webp' }, '2026-10-12T10:00:00.000Z']);
    verifier('le document d\'un autre set n\'est pas touché', docs[1].etat, 'ok');
    verifier('le $pull est précis : il porte set, source, cleR2 ET la marque (jamais une entrée non marquée)', journal.find(j => j[0] === 'carte')[2].$pull.images, { set: 'S', source: 'tpc-asie', cleR2: 'tpc-asie/S/001-1-id.webp', basseDefinition: true });
    const n2 = await B.remplacerBasseDefinition(M, 1, bonne(), { maintenant });
    verifier('rejouée : rien à remplacer, aucune écriture de plus', [n2, journal.length], [0, 2]);
    const avant = JSON.stringify(carte);
    const n3 = await B.remplacerBasseDefinition(M, 1, basse({ source: 'pikaqian', cleR2: 'pk.webp', numero: '002' }), { maintenant });
    verifier('une candidate marquée n\'écrit rien', [n3, JSON.stringify(carte) === avant], [0, true]);
    verifier('une carte inconnue → 0, sans exception', await B.remplacerBasseDefinition(M, 999, bonne(), { maintenant }), 0);

    // ── les appelants : chaque collecteur qui joint une image NON marquée appelle LE module (une règle, pas une copie par collecteur) ───────────────
    const lire = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
    const sansCommentaires = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    for (const f of ['collecteur-images.js', 'collecteur-images-bulba.js', 'collecteur-images-tcgdex.js']) {
        verifier(`${f} appelle remplacerBasseDefinition (le module)`, /remplacerBasseDefinition\(/.test(sansCommentaires(lire(f))), true);
    }
    for (const f of ['collecteur-images-tpc.js', 'collecteur-images-pikaqian.js']) {
        verifier(`${f} pose la marque par marqueDe (jamais un nombre recopié)`, /marqueDe\(/.test(sansCommentaires(lire(f))), true);
    }
    // ptcgio, TPC et PikaQian ne comblent que les visuels MANQUANTS (dejaServi) : une entrée marquée compte comme « servie », ils n'atteignent jamais le remplacement
    for (const f of ['collecteur-images-ptcgio.js', 'collecteur-images-tpc.js', 'collecteur-images-pikaqian.js']) {
        verifier(`${f} reste additif (dejaServi) : il ne remplace rien`, /dejaServi\(/.test(sansCommentaires(lire(f))) && !/remplacerBasseDefinition\(/.test(sansCommentaires(lire(f))), true);
    }
    const regles = lire('remettre-en-file.js').match(/const REGLES = \[([\s\S]*?)\];/)?.[1] ?? '';
    verifier('REGLES surveille collecte-cartes/basse-definition.js (les collecteurs l\'appellent : la remise en file en dépend)', regles.includes("'collecte-cartes/basse-definition.js'"), true);

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})();
