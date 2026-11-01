// Banc de l'extraction de la règle « nom français Cardmarket » (§21 bis : une seule copie de nomSeul / cle / accents / décision).
//   node test-nom-fr-cardmarket.js          (cas fixes, aucune base)
//   node test-nom-fr-cardmarket.js --reel   (rejoue en plus la sortie de rapatrier-noms-fr.js sur les données RÉELLES, en lecture, aucune écriture)
//
// La RÉFÉRENCE ci-dessous est la copie GELÉE, mot pour mot, de la logique de rapatrier-noms-fr.js à main@4364e9d4 (avant extraction).
// Le module extrait doit rendre exactement la même chose qu'elle : c'est la preuve que l'extraction n'a rien changé.
const fs = require('fs');
const path = require('path');
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };

// ---------- RÉFÉRENCE GELÉE (main@4364e9d4, rapatrier-noms-fr.js l.36-50 et l.77-107) ----------
const PARENTHESE = /\s*\([^)]*\)\s*$/;
const NIVEAU = /\s*Lv\.?\s?\d+\s*$/i;
const refNomSeul = s => {
    let t = String(s || '').trim();
    for (let i = 0; i < 3 && PARENTHESE.test(t); i++) t = t.replace(PARENTHESE, '').trim();
    return t.replace(NIVEAU, '').replace(/\s*-\s*(?:Holo|Reverse Holo)\s*$/i, '').trim();
};
const refCle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const refAccents = s => (String(s).normalize('NFD').match(/[̀-ͯ]/g) || []).length;
function refPlan(liens, produits) {
    const avecFr = produits.filter(p => p.nomFr && String(p.nomFr).trim());
    const frDuProduit = new Map(avecFr.map(p => [p.idProduct, refNomSeul(p.nomFr)]));
    const parCarte = new Map();
    for (const l of liens) {
        const fr = frDuProduit.get(l.idProduct);
        if (!fr) continue;
        const e = parCarte.get(l.carteId) || (parCarte.set(l.carteId, new Map()), parCarte.get(l.carteId));
        const k = refCle(fr);
        const g = e.get(k) || (e.set(k, { formes: new Map(), n: 0 }), e.get(k));
        g.formes.set(fr, (g.formes.get(fr) || 0) + 1); g.n++;
    }
    const aEcrire = []; let conflits = 0, accentues = 0;
    for (const [carteId, groupes] of parCarte) {
        if (groupes.size > 1) { conflits++; aEcrire.push({ carteId, nomFr: null }); continue; }
        const g = [...groupes.values()][0];
        const formes = [...g.formes].sort((a, b) => (refAccents(b[0]) - refAccents(a[0])) || (b[1] - a[1]));
        if (formes.length > 1) accentues++;
        aEcrire.push({ carteId, nomFr: formes[0][0] });
    }
    return { aEcrire, conflits, accentues, cartes: parCarte.size };
}

const M = require('./collecte-cartes/nom-fr-cardmarket');

// ---------- 1. les trois fonctions, sur des chaînes ----------
const CHAINES = ['Dracaufeu', 'Salamèche Lv.10', 'Dialga LV.X', 'Pikachu (V.2)', 'Pikachu (Holo) (V.2)', 'Élektek - Holo', 'Elektek - Reverse Holo',
    'Énergie Feu de base', 'Dresseur (Theme Deck) (Pikachu V Box)', '', null, undefined, '  Léo  ', 'Mélo', 'Melo', "Récupération d'Énergie", 'Pi'];
egal('1 nomSeul identique à la référence', CHAINES.map(M.nomSeul), CHAINES.map(refNomSeul));
egal('2 cle identique à la référence', CHAINES.map(M.cle), CHAINES.map(refCle));
egal('3 accents identique à la référence', CHAINES.filter(Boolean).map(M.accents), CHAINES.filter(Boolean).map(refAccents));

// ---------- 2. la décision par carte, sur des produits ----------
const produits = [
    { idProduct: 1, nomFr: 'Élektek' }, { idProduct: 2, nomFr: 'Elektek (V.2)' },                       // accents départagés
    { idProduct: 3, nomFr: 'Double Énergie Incolore' }, { idProduct: 4, nomFr: 'Double Colorless Energy' }, // conflit
    { idProduct: 5, nomFr: 'Léo' }, { idProduct: 6, nomFr: null }, { idProduct: 7, nomFr: '   ' },
    { idProduct: 8, nomFr: 'Salamèche Lv.10' }, { idProduct: 9, nomFr: 'Salamèche' }];
const liens = [{ carteId: 10, idProduct: 1 }, { carteId: 10, idProduct: 2 }, { carteId: 11, idProduct: 3 }, { carteId: 11, idProduct: 4 },
    { carteId: 12, idProduct: 5 }, { carteId: 13, idProduct: 6 }, { carteId: 13, idProduct: 7 }, { carteId: 14, idProduct: 8 }, { carteId: 14, idProduct: 9 }];
const ref = refPlan(liens, produits);
const frDuProduit = M.frParProduit(produits);
const parCarte = M.grouperParCarte(liens, frDuProduit);
const sortie = [...parCarte].map(([carteId, groupes]) => { const d = M.decider(groupes); return { carteId, nomFr: d.nomFr }; });
egal('4 décision identique à la référence (synthétique)', sortie, ref.aEcrire);
egal('5 accents : la forme accentuée gagne, sans conflit', M.decider(parCarte.get(10)).nomFr, 'Élektek');
egal('6 conflit : null', M.decider(parCarte.get(11)).conflit, true);
egal('7 produit sans nomFr : la carte n\'est pas dans le groupement', parCarte.has(13), false);
egal('8 Lv.10 retiré, donc pas de conflit', M.decider(parCarte.get(14)).nomFr, 'Salamèche');

// ---------- 3. rapatrier-noms-fr.js IMPORTE le module au lieu de recopier la règle (§21 bis) ----------
const src = fs.readFileSync(path.join(__dirname, 'rapatrier-noms-fr.js'), 'utf8');
egal('9 rapatrier importe le module', /require\('\.\/collecte-cartes\/nom-fr-cardmarket'\)/.test(src), true);
egal('10 rapatrier ne redéfinit plus nomSeul', /const nomSeul\s*=/.test(src), false);
egal('11 rapatrier ne redéfinit plus cle', /const cle\s*=/.test(src), false);
egal('12 rapatrier ne redéfinit plus accents', /const accents\s*=/.test(src), false);

(async () => {
    if (process.argv.includes('--reel')) {
        const { ouvrirLecture } = require('./audit-catalogue/lecture-audit');
        const b = await ouvrirLecture();
        try {
            const prod = await b.prod.collection('numeros_cartes').find({}, { projection: { idProduct: 1, nomFr: 1 } }).toArray();
            const lr = await b.cartes.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1 } }).toArray();
            if (!prod.length || !lr.length) throw new Error('lecture vide : le banc réel ne mesure rien (§41)');
            const r = refPlan(lr, prod);
            const fp = M.frParProduit(prod), pc = M.grouperParCarte(lr, fp);
            const n = [...pc].map(([carteId, groupes]) => ({ carteId, nomFr: M.decider(groupes).nomFr }));
            egal(`R1 ${r.aEcrire.length} cartes : décision réelle identique à la référence`, n, r.aEcrire);
            egal('R2 conflits comptés pareil', [...pc.values()].filter(g => M.decider(g).conflit).length, r.conflits);
            egal('R3 accents comptés pareil', [...pc.values()].filter(g => M.decider(g).accentue).length, r.accentues);
            console.log(`   réel : ${prod.length} produits, ${lr.length} lignes, ${r.cartes} cartes, ${r.conflits} conflits, ${r.accentues} départagées par les accents`);
        } finally { await b.fermer(); }
    }
    console.log(`${ko ? '❌' : '✅'} test-nom-fr-cardmarket : ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(String(e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>')); process.exit(1); });
