// ============================================================
// CALIBRATION À BLANC D'UNE CLÉ PROPOSÉE : la désignation croisée (métacarte ∧ nom + attaques) SANS la clause « déjà imprimée dans le tirage »
// ============================================================
//   $env:NODE_PATH='C:\Users\Yung\Desktop\pokemon-proxy\node_modules'
//   node calibrer-croise-sans-tirage.js --cache=<dossier>
//
// Pourquoi : designerCroise (cle-nom-attaques.js) refuse « la carte n'a jamais été imprimée en <tirage> » — c'est la clause qui bloque les
// RÉIMPRESSIONS NEUVES (Chasing Glory Together, Happy Set 6, SV-P/CS 354+) dont le texte est chez nous sous un autre tirage. En SUPPRIMANT la clause
// (`tirage` nul, comportement prévu par la fonction), que désigne la clé, et se trompe-t-elle ? La règle du dépôt (§48, §67) : une clé qui contient le nom
// ne se juge que sur une population dont on connaît la vérité (produits joints par le numéro), numéro caché, puis VRAIE CARTE RETIRÉE (`sauf`).
// Les fonctions sont celles de la production (indexer, designerCroise, indexerMetacartes). Aucune écriture, aucune requête.
const fs = require('fs');
const path = require('path');
const J = require('./collecte-cartes/jointure');
const N = require('./collecte-cartes/cle-nom-attaques');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const CACHE = arg('cache'); if (!CACHE) { console.error('--cache=<dossier> requis'); process.exit(2); }
const L = n => JSON.parse(fs.readFileSync(path.join(CACHE, `${n}.json`), 'utf8'));
const cat = L('catalogue_produits'), cartes = L('cartes'), cp = L('cartes_produits');
const metaDe = new Map(cat.map(c => [c.idProduct, c.idMetacard ?? null]));
const nomDe = new Map(cat.map(c => [c.idProduct, c.name]));
const index = N.indexer(cartes);
const parMeta = N.indexerMetacartes(cp, id => metaDe.get(id) ?? null);
const ctx = { index, parMeta, metacarteDe: id => metaDe.get(id) ?? null };
console.log(`DÉNOMINATEURS : catalogue ${cat.length} · cartes ${cartes.length} · lignes ${cp.length}`);
if (!cat.length || !cartes.length || !cp.length) throw new Error('jeu vide');

// la vérité : produits dont les lignes désignent UNE carte, par une preuve qui repose sur le numéro (pas sur le nom), carte à page
const parProduit = new Map();
for (const l of cp) (parProduit.get(l.idProduct) || parProduit.set(l.idProduct, []).get(l.idProduct)).push(l);
const verite = [];
for (const [id, ls] of parProduit) {
    const cs = new Set(ls.map(l => l.carteId));
    if (cs.size !== 1) continue;
    const l = ls[0];
    if (!(l.carteId > 0) || !['set+numero', 'setlist+numero'].includes(l.preuve) || !nomDe.has(id) || J.estCarteCode(nomDe.get(id))) continue;
    verite.push({ id, carteId: l.carteId, tirage: l.tirage || 'inconnu' });
}
console.log(`VÉRITÉ : ${verite.length} produits joints à UNE carte à page par le numéro (sur ${parProduit.size} produits ayant une ligne)`);

const mesures = {};
const note = (cle, k) => { (mesures[cle] || (mesures[cle] = {}))[k] = ((mesures[cle] || {})[k] || 0) + 1; };
for (const v of verite) {
    const d = J.decomposerNomCardmarket(nomDe.get(v.id));
    const p = { idProduct: v.id, nom: d.nom, attaques: d.attaques };
    for (const cle of ['tous', v.tirage]) {
        // A : vraie carte PRÉSENTE
        const a = N.designerCroise(ctx, p, { tirage: null });
        note(`A ${cle}`, 'cas');
        if (a.carte) note(`A ${cle}`, a.carte._id === v.carteId ? 'justes' : 'FAUX'); else note(`A ${cle}`, 'silences');
        // B : vraie carte RETIRÉE du monde (le texte n'est pas chez nous) : toute désignation est un autre texte
        const b = N.designerCroise(ctx, p, { tirage: null, sauf: v.carteId });
        note(`B ${cle}`, 'cas');
        if (b.carte) note(`B ${cle}`, 'FAUX-autre-texte'); else note(`B ${cle}`, 'silences');
        // variante « ≥ 2 frères » : la désignation sans clause de tirage ne vaut que si au moins DEUX autres produits de la métacarte sont joints à la carte désignée
        // (le garde-fou de cle-freres-metacarte.js, lot M2 : un seul frère peut lui-même être mal joint)
        const freres = (carteId, sauf) => { let n = 0; for (const [idp, cs] of parMeta.get(metaDe.get(v.id)) || []) if (idp !== v.id && cs.has(carteId) && carteId !== sauf) n++; return n; };
        if (cle === 'tous') {
            const a3 = N.designerCroise(ctx, p, { tirage: null });
            note('A tous SANS clause, >= 2 frères', 'cas'); if (a3.carte && freres(a3.carte._id, null) >= 2) note('A tous SANS clause, >= 2 frères', a3.carte._id === v.carteId ? 'justes' : 'FAUX'); else note('A tous SANS clause, >= 2 frères', 'silences');
            const b3 = N.designerCroise(ctx, p, { tirage: null, sauf: v.carteId });
            note('B tous SANS clause, >= 2 frères', 'cas'); if (b3.carte && freres(b3.carte._id, v.carteId) >= 2) note('B tous SANS clause, >= 2 frères', 'FAUX-autre-texte'); else note('B tous SANS clause, >= 2 frères', 'silences');
        }
        // les deux avec la clause de tirage de la production, pour comparer
        if (cle === 'tous') {
            const a2 = N.designerCroise(ctx, p, { tirage: v.tirage });
            note('A tous AVEC clause (production)', 'cas'); if (a2.carte) note('A tous AVEC clause (production)', a2.carte._id === v.carteId ? 'justes' : 'FAUX'); else note('A tous AVEC clause (production)', 'silences');
            const b2 = N.designerCroise(ctx, p, { tirage: v.tirage, sauf: v.carteId });
            note('B tous AVEC clause (production)', 'cas'); if (b2.carte) note('B tous AVEC clause (production)', 'FAUX-autre-texte'); else note('B tous AVEC clause (production)', 'silences');
        }
    }
}
for (const [k, m] of Object.entries(mesures).sort()) {
    const cas = m.cas || 0, desig = (m.justes || 0) + (m.FAUX || 0) + (m['FAUX-autre-texte'] || 0);
    console.log(`${k.padEnd(40)} cas ${String(cas).padStart(6)} · désigne ${String(desig).padStart(6)} · justes ${m.justes || 0} · FAUX ${m.FAUX || 0} · faux (autre texte, vraie carte retirée) ${m['FAUX-autre-texte'] || 0} · silences ${m.silences || 0}${desig ? ` · précision ${(100 * (m.justes || 0) / desig).toFixed(2)} %` : ''}`);
}
