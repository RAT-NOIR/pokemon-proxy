// node test-plan-taiwan.js — LE PLAN TAIWAN (plan-taiwan.js) : lecture seule, zéro requête. Base EN MÉMOIRE, fiche TPC tw réelle (fixture asie-tw-fiche-14091 : Bulbasaur 001/M-P).
// Ce que le banc garde : le DÉNOMINATEUR (produits Cardmarket du tirage zh-hant), ce qui est servi (une entrée existante, quelle qu'elle soit, SERT son numéro), ce qui manque, ce que
// TPC tw peut couvrir (ligne de table + fiches du cache), et le compte qui se compare à l'annonce — avec son explication, dans un sens comme dans l'autre.
const fs = require('fs');
const path = require('path');
const T = require('./collecte-cartes/tpc');
const { planTaiwan, lignesDuRapport } = require('./plan-taiwan');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? ('$in' in v ? v.$in.includes(lire(d, k)) : false) : lire(d, k) === v);
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const ecritures = [];
    const collection = n => ({
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        find(f) { return { toArray: async () => structuredClone(tous(n, f)) }; },
        async countDocuments(f) { return tous(n, f).length; },
        async updateOne() { ecritures.push(n); throw new Error('le plan ne doit rien écrire'); }
    });
    return { col, db: { collection }, ecritures };
}
const MP = 'M-P-Traditional-Chinese-Promos', PROD = 'Traditional-Chinese-Products';
const B = fausseBase();
B.col('sets').set(MP, { _id: MP, tirage: 'zh-hant', region: 'intl', idExpansion: [6391] });
B.col('sets').set(PROD, { _id: PROD, tirage: 'zh-hant', region: 'intl', idExpansion: [5960] });
B.col('sets').set('Autre', { _id: 'Autre', tirage: 'jp', region: 'jp', idExpansion: [1] });
B.col('cartes').set(1, { _id: 1, nomEn: 'Bulbasaur', categorie: 'pokemon', ndex: 1, pv: 80, images: [] });                                                                      // manque, prouvable
B.col('cartes').set(2, { _id: 2, nomEn: 'Ivysaur', categorie: 'pokemon', ndex: 2, pv: 100, images: [{ set: MP, source: 'pikaqian', numero: '002', cleR2: 'x.webp', langue: 'zh-hant', basseDefinition: true }] });   // servi par une basse définition
B.col('cartes').set(3, { _id: 3, nomEn: 'Venusaur', categorie: 'pokemon', ndex: 3, pv: 160, images: [{ set: 'Autre', source: 'tcgdex', numero: '003', cleR2: 'y.webp' }] });                  // manque (l'entrée est d'un autre set)
B.col('cartes').set(4, { _id: 4, nomEn: 'Fuecoco', categorie: 'pokemon', images: [] });
B.col('cartes').set(5, { _id: 5, nomEn: 'Sprigatito', categorie: 'pokemon', images: [] });
const lien = (c, p, s, n) => B.col('cartes_produits').set(`${c}|${p}`, { _id: `${c}|${p}`, carteId: c, idProduct: p, numeroFiche: n, slugSet: s });
lien(1, 101, MP, '001'); lien(2, 102, MP, '002'); lien(3, 103, MP, '003'); lien(4, 201, PROD, null); lien(5, 202, PROD, null);
const fiche = T.lireFicheAsie(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'tpc-fixtures', 'asie-tw-fiche-14091.html'), 'utf8'));
B.col('collecte_images_etat').set(`tpc-asie/${MP}`, { _id: `tpc-asie/${MP}`, liste: { code: 'M-P', langue: 'tw', ids: [14091], total: 1, complete: true } });
B.col('tpc_fiches').set('tpc-asie/tw/14091', { _id: 'tpc-asie/tw/14091', site: 'tpc-asie', langue: 'tw', idFiche: 14091, url: 'https://asia.pokemon-card.com/tw/card-search/detail/14091/', fiche });

(async () => {
    const R = await planTaiwan({ db: B.db, produitsDuCatalogue: async ids => ({ 6391: 4, 5960: 2 }[ids[0]]), ligneDe: (s, slug) => { const L = T.SITES && require('./collecte-cartes/tpc-sets').ligneTpc(s, slug); return L && { ...L, cartes: 1 }; } });
    const m = R.sets.find(s => s.slug === MP), p = R.sets.find(s => s.slug === PROD);
    verifier('seuls les sets de tirage zh-hant sont pris', R.sets.map(s => s.slug).sort(), [PROD, MP].sort());
    verifier('M-P : catalogue 4, joints 3, SANS FICHE 1 (produit jamais joint à une carte)', [m.catalogue, m.joints, m.sansFiche], [4, 3, 1]);
    verifier('M-P : servis 1 (la basse définition SERT son numéro : aucun remplacement), sans visuel 2', [m.servis, m.sansVisuel], [1, 2]);
    verifier('M-P : la ligne tw existe, 1 fiche en cache, 2 trous, 1 PROUVÉ (Bulbasaur 001, Pokédex + PV), 1 reste « absente-de-la-source »', [m.ligne, m.fichesEnCache, m.trous, m.prouves, m.restes], [true, 1, 2, 1, { 'absente-de-la-source': 1 }]);
    verifier('Produits : 2 produits, aucune ligne TPC tw — rien à couvrir sans mesure', [p.catalogue, p.joints, p.sansVisuel, p.ligne, p.prouves], [2, 2, 2, false, 0]);
    verifier('TOTAL : dénominateur 6, sans visuel (joints) 4, prouvés 1, sans ligne 2, sans fiche 1', [R.total.catalogue, R.total.sansVisuel, R.total.prouves, R.total.horsLigne, R.total.sansFiche], [6, 4, 1, 2, 1]);
    verifier('AUCUNE écriture dans la base', B.ecritures, []);
    const ecart = (att) => lignesDuRapport(R, att).join('\n');
    verifier('annonce égale (4) : « concorde »', /concorde/.test(ecart(4)) && !/écart/i.test(ecart(4)), true);
    verifier('annonce différente (7) : l\'écart est CHIFFRÉ dans le sens où il va', /écart de -3/.test(ecart(7)) || /3 de moins/.test(ecart(7)), true);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
