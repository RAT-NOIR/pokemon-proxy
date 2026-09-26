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
    console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
    process.exit(ko ? 1 : 0);
})();
