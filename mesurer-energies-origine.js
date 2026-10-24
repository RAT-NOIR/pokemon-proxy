// ============================================================
// PHASE 3a — la clé « énergie de base : CODE D'ORIGINE + NOM » (candidate, MESURE SEULE) sur les énergies SANS_LIGNE dont le numéro Cardmarket est un code de lettres
// ============================================================
//   node mesurer-energies-origine.js --diag=<diag-produits.json> --cache=<dossier> --sortie=<fichier.json>
// Cardmarket écrit, pour une énergie de deck/coffret, le code du set d'ORIGINE à la place du numéro (« Fire Energy #RS », « Basic Grass Energy #GRA »).
// Le code désigne une expansion (codes_set.codeSet → idExpansion) ; l'énergie de CE nom a, dans le set d'origine, UNE carte à impression (sets, tirage, expansion).
// Les fonctions sont celles de la production (clesNom, nomJointDe, cleNumero…) ; aucune écriture.
const fs = require('fs');
const path = require('path');
const J = require('./collecte-cartes/jointure');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const DIAG = arg('diag'), CACHE = arg('cache'), SORTIE = arg('sortie');
if (!DIAG || !CACHE || !SORTIE) { console.error('usage : --diag= --cache= --sortie='); process.exit(2); }
const L = n => JSON.parse(fs.readFileSync(path.join(CACHE, `${n}.json`), 'utf8'));
const d = JSON.parse(fs.readFileSync(DIAG, 'utf8'));
const codes = L('codes_set'), sets = L('sets'), cartes = L('cartes');
const parCode = new Map(); for (const c of codes) (parCode.get(String(c.codeSet)) || parCode.set(String(c.codeSet), new Set()).get(String(c.codeSet))).add(c.idExpansion);
const setsDeExp = new Map(); for (const s of sets) for (const e of [].concat(s.idExpansion ?? [])) (setsDeExp.get(e) || setsDeExp.set(e, []).get(e)).push(s);
const parSlug = new Map(); for (const c of cartes) for (const s of c.sets || []) (parSlug.get(s) || parSlug.set(s, []).get(s)).push(c);
console.log(`DÉNOMINATEURS : codes_set ${codes.length} (${parCode.size} codes) · sets ${sets.length} · cartes ${cartes.length}`);
if (!codes.length || !sets.length || !cartes.length) throw new Error('jeu vide');
const res = {}; const stat = { energies: 0, codeLettres: 0, codeConnu: 0, uneCarte: 0, plusieurs: 0, aucune: 0, codeInconnu: 0 };
for (const e of d) for (const p of e.produits) {
    if (!p.energie) continue; stat.energies++;
    if (!(p.numero != null && /^[A-Za-z]{2,5}$/.test(p.numero))) continue;
    stat.codeLettres++;
    const exps = parCode.get(p.numero);
    if (!exps) { stat.codeInconnu++; res[p.idProduct] = { raison: 'code absent de codes_set' }; continue; }
    stat.codeConnu++;
    const kp = J.clesNom(J.decomposerNomCardmarket(p.name).nom);
    const trouvees = new Map();
    for (const x of exps) for (const s of setsDeExp.get(x) || []) {
        const noms = [].concat(s.bulba?.expansion ?? []).filter(v => typeof v === 'string');
        for (const c of parSlug.get(s._id) || []) {
            if (!c.nomEn || !J.clesNom(J.nomJointDe(c)).some(k => kp.includes(k))) continue;
            if ((c.impressions || []).some(i => i && i.tirage === (s.tirage ?? s.region) && noms.includes(i.expansion))) trouvees.set(c._id, { slug: s._id, nom: c.nomEn });
        }
    }
    if (trouvees.size === 1) { stat.uneCarte++; res[p.idProduct] = { carteId: [...trouvees.keys()][0], ...[...trouvees.values()][0] }; }
    else if (trouvees.size > 1) { stat.plusieurs++; res[p.idProduct] = { raison: `${trouvees.size} cartes de ce nom dans le set d'origine` }; }
    else { stat.aucune++; res[p.idProduct] = { raison: 'aucune carte de ce nom à impression dans le set d\'origine' }; }
}
console.log(JSON.stringify(stat));
fs.writeFileSync(SORTIE, JSON.stringify(res));
