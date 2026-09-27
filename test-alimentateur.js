// node test-alimentateur.js — la DÉCISION de l'alimentateur de file (collecte-cartes/alimentateur.js), pure, sans base.
// Demande du testeur (2026-09-25) : « je ne veux plus jamais constater moi-même qu'il dort ». La file se remplit toute seule
// sous un seuil, des plus gros manques aux plus petits, toutes sources légales confondues ; et elle ne tourne JAMAIS en rond :
// une unité déjà passée ne revient que sur une CAUSE NEUVE (le texte du set recollecté après elle), une fois par cause.
const { choisirUnites } = require('./collecte-cartes/alimentateur');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const J = new Date('2026-09-20T00:00:00Z'), K = new Date('2026-09-24T00:00:00Z');
const lignes = {
    'Set-JP': { code: 'jp1', slugSet: 'Set-JP', region: 'japonais', bulba: { tirage: 'jp' } },
    'Set-JP-sans': { code: 'jp2', slugSet: 'Set-JP-sans', region: 'japonais', bulba: { tirage: 'jp' } },
    'Set-EN': { code: 'en1', slugSet: 'Set-EN', region: 'occidental', bulba: { tirage: 'intl' } },
    'Set-EN-sansTcg': { code: 'en2', slugSet: 'Set-EN-sansTcg', region: 'occidental', bulba: { tirage: 'intl' } },
    'Set-ZH': { code: 'zh1', slugSet: 'Set-ZH', region: null, bulba: { tirage: 'zh-hans' } },
    'Set-TH': { code: 'th1', slugSet: 'Set-TH', region: null, bulba: { tirage: 'th' } }
};
const base = {
    ligneDe: slug => lignes[slug] || null,
    sourceArtofpkm: code => code === 'jp1',
    setTcgdex: L => L.code === 'en1' ? { id: 'sv1', name: 'Set EN' } : null,
    texteFini: () => null,
    max: 10
};
const manques = [
    { slug: 'Set-EN', n: 100, sans: 5 }, { slug: 'Set-JP', n: 80, sans: 80 }, { slug: 'Set-ZH', n: 200, sans: 200 },
    { slug: 'Set-JP-sans', n: 50, sans: 50 }, { slug: 'Set-EN-sansTcg', n: 30, sans: 30 }, { slug: 'Set-TH', n: 10, sans: 10 }, { slug: 'Inconnu', n: 3, sans: 3 }
];

const R = choisirUnites({ ...base, manques, unites: new Map() });
verifier('les plus gros manques d\'abord, une unité par set, la bonne source', R.inserer.map(u => `${u._id}:${u.source}`), ['jp1:artofpkm', 'en2:bulbapedia', 'tcgdex/en1:tcgdex']);
verifier('une unité TCGdex porte son set TCGdex et son code', R.inserer.find(u => u.source === 'tcgdex'), { _id: 'tcgdex/en1', code: 'en1', source: 'tcgdex', tcgdexSet: 'sv1', tcgdexNom: 'Set EN', slug: 'Set-EN', sans: 5 });
verifier('chinois et thaï : « sans source légale », jamais enfilés', R.ecartes.filter(e => /sans source légale/.test(e.raison)).map(e => e.slug), ['Set-ZH', 'Set-TH']);
verifier('japonais sans source artofpkm : écarté et NOMMÉ', R.ecartes.find(e => e.slug === 'Set-JP-sans')?.raison, 'japonais : aucune source artofpkm déclarée');
verifier('set sans ligne de table : écarté et nommé', R.ecartes.find(e => e.slug === 'Inconnu')?.raison, 'aucune ligne de table');

const unites = new Map([
    ['jp1', { _id: 'jp1', etat: 'attente' }],
    ['tcgdex/en1', { _id: 'tcgdex/en1', etat: 'fait', fini: J }],
    ['en1', { _id: 'en1', etat: 'fait', fini: J }],
    ['en2', { _id: 'en2', etat: 'refuse', fini: J }]
]);
const R2 = choisirUnites({ ...base, manques, unites });
verifier('déjà en attente : rien de plus pour ce set', R2.inserer.concat(R2.reprendre).some(u => u._id === 'jp1'), false);
verifier('toutes les sources légales ont tourné, sans cause neuve : rien, et la raison le dit', R2.ecartes.find(e => e.slug === 'Set-EN')?.raison, 'toutes les sources légales ont tourné (tcgdex/en1 fait, en1 fait) : aucune cause neuve');
verifier('occidental : TCGdex passé sans tout rendre → Bulbapedia ensuite', choisirUnites({ ...base, manques, unites: new Map([['tcgdex/en1', { _id: 'tcgdex/en1', etat: 'fait', fini: J }]]) }).inserer.map(u => u._id), ['jp1', 'en2', 'en1']);

const R3 = choisirUnites({ ...base, manques, unites, texteFini: slug => slug === 'Set-EN' ? K : null });
verifier('texte recollecté APRÈS l\'unité : cause neuve, reprise de la 1re source', R3.reprendre.map(u => `${u._id}←${u.cause}`), ['tcgdex/en1←texte du set recollecté le 2026-09-24T00:00:00.000Z, après l\'unité (2026-09-20T00:00:00.000Z)']);
const unitesDejaReprises = new Map([...unites, ['tcgdex/en1', { _id: 'tcgdex/en1', etat: 'fait', fini: new Date('2026-09-24T01:00:00Z'), alimCause: K.toISOString() }], ['en1', { _id: 'en1', etat: 'fait', fini: new Date('2026-09-24T02:00:00Z'), alimCause: K.toISOString() }]]);
verifier('une cause ne sert qu\'UNE fois : pas de boucle', choisirUnites({ ...base, manques, unites: unitesDejaReprises, texteFini: slug => slug === 'Set-EN' ? K : null }).reprendre.length, 0);
verifier('le plafond `max` est tenu', choisirUnites({ ...base, manques, unites: new Map(), max: 1 }).inserer.length, 1);

// ── LE MANQUE RÉEL, CARTE PAR CARTE (2026-09-26, soir) : « la file ne doit pas rester vide tant qu'un b) existe ». Le compte
// par SET (`images.set`) laissait passer White Flare pour servi (Victini n°172 : une image dans le set, à un AUTRE numéro) ;
// le manque se lit désormais sur le PLAN de la source — les impressions qu'elle sert et qu'aucun document `images` n'a tentées.
const { choisirManqueReel, idImageTcgdex } = require('./collecte-cartes/manque-reel');
verifier('id d\'image TCGdex : la forme du collecteur, numéro ENTIER', [idImageTcgdex('White-Flare', 333440, '172'), idImageTcgdex('Brilliant-Stars', 5, 'TG07'), idImageTcgdex('X', 1, null)], ['tcgdex/White-Flare/333440/172', 'tcgdex/Brilliant-Stars/5/TG07', 'tcgdex/X/1/sans-numero']);
const mq = [
    { slug: 'White-Flare', code: 'WHT', tcgdexSet: 'sv10.5w', tcgdexNom: 'White Flare', n: 11, cle: 'tcgdex:aaa' },
    { slug: 'Black-Bolt', code: 'BLK', tcgdexSet: 'sv10.5b', tcgdexNom: 'Black Bolt', n: 10, cle: 'tcgdex:bbb' },
    { slug: 'Set-Neuf', code: 'NEU', tcgdexSet: 'neu', tcgdexNom: 'Neuf', n: 40, cle: 'tcgdex:ccc' },
    { slug: 'Set-Occupe', code: 'OCC', tcgdexSet: 'occ', tcgdexNom: 'Occupé', n: 5, cle: 'tcgdex:ddd' },
    { slug: 'Set-NonLu', code: 'NLU', tcgdexSet: 'nlu', tcgdexNom: 'Non lu', n: 0, nonLu: true, cle: 'tcgdex:nonlu:nlu' }
];
const uMq = new Map([
    ['tcgdex/WHT', { _id: 'tcgdex/WHT', etat: 'fait', fini: J }],
    ['tcgdex/BLK', { _id: 'tcgdex/BLK', etat: 'fait', fini: J, alimCause: 'tcgdex:bbb' }],
    ['tcgdex/OCC', { _id: 'tcgdex/OCC', etat: 'attente' }]
]);
const RM = choisirManqueReel({ manques: mq, unites: uMq, max: 10 });
verifier('manque réel : unité absente → insérée, avec son set TCGdex et la clé du manque', RM.inserer.map(u => `${u._id}:${u.source}:${u.tcgdexSet}:${u.alimCause}:${u.sans}`), ['tcgdex/NEU:tcgdex:neu:tcgdex:ccc:40', 'tcgdex/NLU:tcgdex:nlu:tcgdex:nonlu:nlu:0']);
verifier('manque réel : unité faite, manque NEUF → reprise, la cause dit le nombre', RM.reprendre.map(u => `${u._id}←${u.cause}`), ['tcgdex/WHT←11 impression(s) que TCGdex sert (sv10.5w), jamais tentée(s)']);
verifier('manque réel : même manque déjà repris une fois → rien (pas de boucle), et la raison le dit', RM.ecartes.find(e => e.slug === 'Black-Bolt')?.raison, 'tcgdex/BLK a déjà été repris pour ce manque exact (tcgdex:bbb)');
verifier('manque réel : unité déjà en attente → rien de plus', RM.inserer.concat(RM.reprendre).some(u => u._id === 'tcgdex/OCC'), false);
verifier('manque réel : set TCGdex jamais lu → l\'unité le lira, la cause le dit', RM.inserer.find(u => u._id === 'tcgdex/NLU')?.ajouteMotif, 'alimentateur : set TCGdex nlu jamais lu — l\'unité le lira');
verifier('manque réel : plus gros manques d\'abord, plafond tenu', choisirManqueReel({ manques: mq, unites: new Map(), max: 2 }).inserer.map(u => u._id), ['tcgdex/NEU', 'tcgdex/WHT']);
// revue du 2026-09-26 : une galerie compagnon jamais lue (Shining Fates Shiny Vault) laissait le manque à 0, en silence
const gal = [{ slug: 'Shining-Fates', code: 'SHF', tcgdexSet: 'swsh4.5', tcgdexNom: 'Shining Fates', n: 0, nonLus: ['swsh4.5sv'], cle: 'tcgdex:nonlu:swsh4.5sv@v1' }];
verifier('manque réel : galerie compagnon jamais lue → reprise, la cause la nomme', choisirManqueReel({ manques: gal, unites: new Map([['tcgdex/SHF', { _id: 'tcgdex/SHF', etat: 'fait' }]]) }).reprendre.map(u => u.cause), ['galerie(s) TCGdex swsh4.5sv jamais lue(s) — l\'unité la lira']);
// revue du 2026-09-26 : la clé porte la VERSION du code — une unité passée sous un code qui ne savait pas faire le travail
// (AR sans le préfixe « Platinum: ») ne bloque pas pour toujours la reprise sous le code qui sait
const { cleDuManque, estTentee } = require('./collecte-cartes/manque-reel');
verifier('la clé du manque change avec la version du code, pas avec l\'ordre', [cleDuManque(['b', 'a'], 'v1') === cleDuManque(['a', 'b'], 'v1'), cleDuManque(['a'], 'v1') === cleDuManque(['a'], 'v2')], [true, false]);
// revue du 2026-09-26 : un échec PASSAGER n'est pas un verdict — il reste dans le manque ; un 404, un trop-petit, un ok en sortent
verifier('« tentée » : ok, trop-petit, 404 oui ; 503 et coupure réseau non ; absent non',
    [{ etat: 'ok' }, { etat: 'trop-petit' }, { etat: 'echec', erreur: 'absent chez TCGdex (404)' }, { etat: 'echec', erreur: '503 https://assets.tcgdex.net/x/high.png' }, { etat: 'echec', erreur: 'ECONNRESET https://x' }, null].map(estTentee),
    [true, true, true, false, false, false]);
// deux lignes sous un même code : UNE unité, une clé sur l'ensemble — choisies séparément, leurs clés s'écraseraient à chaque tour
const deuxSlugs = [{ slug: 'A', code: 'X', tcgdexSet: 'x1', n: 3, cle: 'k1' }, { slug: 'B', code: 'X', tcgdexSet: 'x1', n: 2, cle: 'k2' }];
const G1 = choisirManqueReel({ manques: deuxSlugs, unites: new Map(), max: 10 });
const G2 = choisirManqueReel({ manques: [...deuxSlugs].reverse(), unites: new Map([['tcgdex/X', { _id: 'tcgdex/X', etat: 'fait', alimCause: G1.inserer[0]?.alimCause }]]), max: 10 });
verifier('deux slugs sous un code : une seule unité, 5 impressions, et la même clé ne se reprend pas', [G1.inserer.length, G1.inserer[0]?.sans, G2.reprendre.length, G2.ecartes.length], [1, 5, 0, 1]);
// troisième relecture : `alimCause` ne gardait que la DERNIÈRE clé — deux ensembles qui alternent (un 503 tantôt sur un fichier, tantôt
// sur l'autre) reprenaient l'unité à chaque mesure, sans fin. L'historique (`alimCauses`) et un PLAFOND par version bornent tout.
const uAlt = (causes, etat = 'refuse') => new Map([['tcgdex/X', { _id: 'tcgdex/X', etat, alimCause: causes[causes.length - 1], alimCauses: causes }]]);
const mq1 = k => [{ slug: 'A', code: 'X', tcgdexSet: 'x1', n: 1, cle: k }];
verifier('une clé DÉJÀ reprise (même ancienne) ne se reprend pas ; au-delà de 3 reprises sous une version, plus aucune ; une version neuve rouvre',
    [choisirManqueReel({ manques: mq1('tcgdex:a@v1'), unites: uAlt(['tcgdex:a@v1', 'tcgdex:b@v1']) }).reprendre.length,
     choisirManqueReel({ manques: mq1('tcgdex:c@v1'), unites: uAlt(['tcgdex:a@v1', 'tcgdex:b@v1']) }).reprendre.length,
     choisirManqueReel({ manques: mq1('tcgdex:d@v1'), unites: uAlt(['tcgdex:a@v1', 'tcgdex:b@v1', 'tcgdex:c@v1']) }).reprendre.length,
     choisirManqueReel({ manques: mq1('tcgdex:a@v2'), unites: uAlt(['tcgdex:a@v1', 'tcgdex:b@v1', 'tcgdex:c@v1']) }).reprendre.length],
    [0, 1, 0, 1]);

// ── L'ALERTE « file vide » (2026-09-26) : `depuis` datait la PREMIÈRE panne (25/09 05:02) et survivait à sa résolution (19:03) ;
// le second épisode (file vide vers 21:26) s'affichait « depuis 05:02 ». Une collection minimale, les seuls opérateurs utilisés.
const { ecrireAlerte } = require('./collecte-cartes/alimentateur');
const faux = () => { const docs = new Map(); return { docs, async updateOne(f, u, o = {}) {
    let d = docs.get(f._id);
    const passe = x => !x || f.active === undefined || (f.active === true ? x.active === true : (f.active && f.active.$ne === true ? x.active !== true : x.active === f.active));
    if (d && !passe(d)) return { matchedCount: 0 };
    if (!d) { if (!o.upsert || f.active !== undefined) return { matchedCount: 0 }; d = { _id: f._id, ...(u.$setOnInsert || {}) }; docs.set(f._id, d); }
    Object.assign(d, u.$set || {}); return { matchedCount: 1 };
} }; };
(async () => {
    const E = faux(), t = h => new Date(`2026-09-25T${h}:00Z`);
    await ecrireAlerte(E, { vide: true, setsSans: 5, cartesSans: 50, raisons: {}, maintenant: t('05:02') });
    await ecrireAlerte(E, { vide: true, setsSans: 5, cartesSans: 50, raisons: {}, maintenant: t('06:00') });
    verifier('un épisode qui dure garde son début', E.docs.get('alerte/file-vide').depuis.toISOString(), t('05:02').toISOString());
    await ecrireAlerte(E, { vide: false, maintenant: t('19:03') });
    verifier('la file se remplit : alerte fermée, résolution datée', [E.docs.get('alerte/file-vide').active, E.docs.get('alerte/file-vide').resolueLe.toISOString()], [false, t('19:03').toISOString()]);
    await ecrireAlerte(E, { vide: true, setsSans: 3, cartesSans: 30, raisons: {}, maintenant: t('21:30') });
    verifier('un NOUVEL épisode repart de son propre début', [E.docs.get('alerte/file-vide').active, E.docs.get('alerte/file-vide').depuis.toISOString()], [true, t('21:30').toISOString()]);

    // ── `alimenter` DE BOUT EN BOUT sur une base fabriquée (revue du 2026-09-26) : (1) une exception du manque réel ne fait
    // perdre ni la reprise choisie par la règle par set ni l'alerte, et elle s'écrit ; (2) une reprise efface les compteurs
    // d'une surcharge passée (`tentatives`, `pasAvant`) — sinon elle reviendrait refusée au premier incident.
    const { alimenter, tirageDe } = require('./collecte-cartes/alimentateur');
    const { TABLE } = require('./collecte-cartes/table-sets');
    const L = TABLE.find(l => l.slugSet && l.code && tirageDe(l) === 'intl');
    const accepte = (d, f) => Object.entries(f).every(([k, v]) => k === '$or' ? v.some(g => accepte(d, g))
        : v && typeof v === 'object' && !(v instanceof Date)
            ? ('$in' in v ? v.$in.includes(d[k]) : '$ne' in v ? d[k] !== v.$ne : '$exists' in v ? (d[k] !== undefined) === v.$exists : '$lte' in v ? d[k] != null && d[k] <= v.$lte : false)
            : d[k] === v);
    const collection = docs => ({
        docs,
        async countDocuments(f) { return [...docs.values()].filter(d => accepte(d, f)).length; },
        async findOne(f) { return [...docs.values()].find(d => accepte(d, f)) || null; },
        find() { const tous = [...docs.values()]; return { toArray: async () => tous, sort: () => ({ limit: n => ({ toArray: async () => tous.slice(0, n) }) }) }; },
        async updateOne(f, u, o = {}) {
            let d = [...docs.values()].find(x => accepte(x, f));
            if (!d) { if (!o.upsert || docs.has(f._id)) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }; d = { _id: f._id, ...(u.$setOnInsert || {}) }; docs.set(f._id, d); Object.assign(d, u.$set || {}); return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }; }
            Object.assign(d, u.$set || {}); for (const k of Object.keys(u.$unset || {})) delete d[k];
            for (const [k, v] of Object.entries(u.$addToSet || {})) { const a = d[k] || (d[k] = []); for (const x of (v && v.$each ? v.$each : [v])) if (!a.includes(x)) a.push(x); }
            return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        }
    });
    const cols = {
        file_images: collection(new Map([[L.code, { _id: L.code, etat: 'refuse', source: 'bulbapedia', fini: J, tentatives: 3, pasAvant: J, ordre: 1 }]])),
        collecte_images_etat: collection(new Map()),
        tcgdex_sets: collection(new Map([['en/__liste__', { _id: 'en/__liste__', sets: [] }]])),     // liste vide → le manque réel LÈVE
        collecte_etat: collection(new Map([[L.slugSet, { _id: L.slugSet, fin: K }]])),
        cartes: { aggregate: () => ({ toArray: async () => [{ slug: L.slugSet, n: 10, sans: 4 }] }) }
    };
    const db = { collection: n => { if (!cols[n]) throw new Error(`collection inattendue ${n}`); return cols[n]; } };
    const silencieux = { log() { }, error() { } };
    const B = await alimenter(db, { M: {}, journal: silencieux, version: 'v-test', maintenant: K });
    const u = cols.file_images.docs.get(L.code), etatManque = cols.collecte_images_etat.docs.get('alimentateur/manque-reel');
    verifier('manque réel en échec : la reprise de la règle par set a quand même lieu', [B.repris, u.etat], [1, 'attente']);
    verifier('une reprise efface tentatives et pasAvant, et garde sa clé dans l\'historique (alimCauses)', ['tentatives' in u, 'pasAvant' in u, u.alimCauses], [false, false, [K.toISOString()]]);
    // l'outil à la main écrit son PLAN (ce qu'il a imprimé), sans seconde mesure : la reprise du plan est appliquée telle quelle
    cols.file_images.docs.set(L.code, { _id: L.code, etat: 'fait', source: 'bulbapedia', fini: J, ordre: 1 });
    const Pl = await alimenter(db, { simuler: true, M: null, journal: silencieux, version: 'v-test', maintenant: K, seuil: 99 });
    cols.cartes.aggregate = () => { throw new Error('seconde mesure : le plan devait suffire'); };
    const Bp = await alimenter(db, { plan: Pl, M: null, journal: silencieux, version: 'v-test', maintenant: K, seuil: 99 });
    verifier('un PLAN s\'écrit tel quel, sans relire les manques (aucune seconde mesure)', [Pl.reprendre.length, Bp.repris, cols.file_images.docs.get(L.code).etat], [1, 1, 'attente']);
    // revue du 2026-09-27 : trois unités en attente DIFFÉRÉE (pasAvant futur : une source inconnue du worker, une surcharge) ne sont pas
    // prenables — les compter dans le seuil affamait la file sans alerte. Seules les unités PRÊTES comptent.
    cols.file_images.docs.clear();
    for (let n = 0; n < 3; n++) cols.file_images.docs.set(`x/${n}`, { _id: `x/${n}`, etat: 'attente', pasAvant: new Date(K.getTime() + 3600e3), resultat: 'source-inconnue', ordre: n });
    cols.file_images.docs.set(L.code, { _id: L.code, etat: 'refuse', source: 'bulbapedia', fini: J, ordre: 9 });
    cols.cartes.aggregate = () => ({ toArray: async () => [{ slug: L.slugSet, n: 10, sans: 4 }] });
    const Bd = await alimenter(db, { M: null, journal: silencieux, version: 'v-test', maintenant: K });
    verifier('trois unités différées ne bloquent pas l\'alimentateur : il reprend ce qui manque', [Bd.rien ?? false, Bd.repris], [false, 1]);
    verifier('l\'échec du manque réel s\'écrit (état et raison), sans compter comme une mesure', [/liste TCGdex absente/.test(etatManque?.erreur || ''), etatManque?.enfilees, Object.keys(B.raisons).some(k => k.startsWith('manque réel NON MESURÉ'))], [true, undefined, true]);
    console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
    process.exit(ko ? 1 : 0);
})();
