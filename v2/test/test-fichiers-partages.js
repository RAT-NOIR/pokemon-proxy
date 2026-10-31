'use strict';
// LOT PERF-SCAN, P2 — le signal « partageAutreDessin » de SUR-PAR-IMAGE (sur-par-image-route.js::signauxDe) lu sur les COLONNES de la version (version.js::partageAutreDessin), à la place de l'index fichier → produits
// bâti par 134 000 petits tableaux au premier scan (+27,6 Mo vivants, et 67 000 reconstructions d'entrée). L'IDENTITÉ est le critère : pour CHAQUE produit d'une version, le même verdict que la définition d'avant
// (recopiée ici, sur l'interface publique entree/identifiants), sur des versions aux cas difficiles ET sur des versions tirées au sort (graine fixe).
const V = require('./_visuels-banc'); const SPR = require('../identifier/sur-par-image-route');
let ok = 0, ko = 0;
const v = (nom, obtenu, attendu) => { const b = JSON.stringify(obtenu) === JSON.stringify(attendu); console.log(`${b ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${b ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); b ? ok++ : ko++; };

// ── la définition d'AVANT, mot pour mot (sur-par-image-route.js, 4ca65c26) : l'index fichier → [[id, métacarte]] puis la boucle de signauxDe
function signauxAvant(version) {
    const m = new Map();
    for (const id of version.identifiants()) {
        const e = version.entree(id);
        if (!e) continue;
        for (const f of [e.vignette && e.vignette.cle, e.grande && e.grande.cle]) {
            if (!f) continue;
            let l = m.get(f); if (!l) { l = []; m.set(f, l); }
            l.push([id, e.idMetacard]);
        }
    }
    return id => {
        const e = version.entree(id);
        if (!e) return null;
        let partage = false;
        for (const f of [e.vignette && e.vignette.cle, e.grande && e.grande.cle]) {
            if (!f) continue;
            for (const [autre, mc] of m.get(f) || []) {
                if (autre === id) continue;
                if (e.idMetacard === null || e.idMetacard === undefined || mc === null || mc === undefined) { if (partage === false) partage = null; }
                else if (mc !== e.idMetacard) { partage = true; break; }
            }
            if (partage === true) break;
        }
        const basse = e.basseDefinition === true ? true : e.basseDefinition === false ? false : null;
        return { basse, partageAutreDessin: partage };
    };
}
const sansMethode = version => ({ entree: id => version.entree(id), identifiants: () => version.identifiants() });       // une version « de banc » : l'interface publique seule
const comparer = (nom, version) => {
    const avant = signauxAvant(version), apres = SPR.signauxDe(version), generique = SPR.signauxDe(sansMethode(version));
    const ids = [...version.identifiants(), 424242424];                                                                   // + un produit absent
    let dif = 0, difG = 0; const compte = { true: 0, false: 0, null: 0 };
    for (const id of ids) {
        const a = avant(id), b = apres(id), g = generique(id);
        if (JSON.stringify(a) !== JSON.stringify(b)) { dif++; if (dif <= 3) console.log('   ↳ DIFFÉRENCE', id, JSON.stringify(a), JSON.stringify(b)); }
        if (JSON.stringify(a) !== JSON.stringify(g)) difG++;
        if (a) compte[String(a.partageAutreDessin)]++;
    }
    v(`${nom} : ${ids.length} produits, verdict identique à la définition d'avant`, dif, 0);
    v(`${nom} : …et la version sans la méthode (l'interface publique seule) rend le même`, difG, 0);
    return compte;
};

// ── 1. les cas difficiles, un par un
const doc = (id, o) => V.doc(id, { vignette: { cle: `f/${id}.webp`, w: 300, h: 420 }, ...o });
const partage = (id, f) => ({ cle: f, w: 300, h: 420 });
const A = V.construire([
    doc(1, { idMetacard: 10, vignette: partage(1, 'f/commun-1.webp') }), doc(2, { idMetacard: 20, vignette: partage(2, 'f/commun-1.webp') }),          // même fichier, deux métacartes : vrai, vrai
    doc(3, { idMetacard: 30, vignette: partage(3, 'f/commun-2.webp') }), doc(4, { idMetacard: 30, vignette: partage(4, 'f/commun-2.webp') }),          // même fichier, même métacarte : faux
    doc(5, { idMetacard: null, vignette: partage(5, 'f/commun-3.webp') }), doc(6, { idMetacard: 60, vignette: partage(6, 'f/commun-3.webp') }),        // une métacarte inconnue : null des deux côtés
    doc(7, { idMetacard: 70, vignette: partage(7, 'f/commun-4.webp') }), doc(8, { idMetacard: null, vignette: partage(8, 'f/commun-4.webp') }), doc(9, { idMetacard: 90, vignette: partage(9, 'f/commun-4.webp') }),   // 7 voit null PUIS 90 : vrai
    doc(10, { idMetacard: 100, vignette: partage(10, 'f/seul-10.webp') }),                                                                           // aucun partage : faux
    doc(11, { idMetacard: 110, vignette: partage(11, 'f/11.webp'), grande: partage(11, 'f/11.webp') }),                                               // vignette = grande, personne d'autre : faux
    doc(12, { idMetacard: 120, vignette: partage(12, 'f/12-v.webp'), grande: partage(12, 'f/commun-5.webp') }), doc(13, { idMetacard: 130, vignette: partage(13, 'f/commun-5.webp') }),                       // la grande de l'un = la vignette de l'autre : vrai, vrai
    doc(14, { idMetacard: 140, vignette: partage(14, 'f/14-v.webp'), grande: partage(14, 'f/commun-6.webp') }), doc(15, { idMetacard: 140, vignette: partage(15, 'f/15-v.webp'), grande: partage(15, 'f/commun-6.webp') }),   // grandes communes, même métacarte : faux
    doc(16, { idMetacard: 160, vignette: partage(16, 'f/commun-7.webp') }), doc(17, { idMetacard: 170, vignette: partage(17, 'f/commun-7.webp') })
]);
const cA = comparer('cas difficiles', A);
v('…les trois verdicts existent dans le jeu (vrai, faux, null) : le banc peut échouer', [cA.true > 0, cA.false > 0, cA.null > 0], [true, true, true]);
v('…verdicts attendus (1,2 vrai · 3,4 faux · 5,6 null · 7 vrai · 8 null · 9 vrai · 10 faux · 11 faux · 12,13 vrai · 14,15 faux)',
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(id => SPR.signauxDe(A)(id).partageAutreDessin), [true, true, false, false, null, null, true, null, true, false, false, true, true, false, false]);

// ── 2. des versions tirées au sort (graine fixe) : beaucoup de partages, des métacartes inconnues, des grandes absentes ou égales à la vignette
function alea(graine) { let s = graine >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
for (const [graine, n, fichiers, metas] of [[1, 400, 120, 25], [2, 600, 500, 300], [3, 300, 700, 2]]) {
    const r = alea(graine), entrees = [];
    for (let i = 0; i < n; i++) {
        const id = 1000 + i * 3 + Math.floor(r() * 3), f = () => `p/${Math.floor(r() * fichiers)}.webp`;
        const g = r(); const vig = f();
        entrees.push(V.doc(id, { idMetacard: r() < 0.12 ? null : Math.floor(r() * metas) + 1, vignette: { cle: vig, w: 300, h: 420 }, grande: g < 0.35 ? null : g < 0.5 ? { cle: vig, w: 700, h: 980 } : { cle: f(), w: 700, h: 980 } }));
    }
    const vues = new Set(), uniques = entrees.filter(e => !vues.has(e.idProduct) && vues.add(e.idProduct));
    const c = comparer(`tirage au sort (graine ${graine}, ${fichiers} fichiers, ${metas} métacartes)`, V.construire(uniques));
    v(`   …répartition ${JSON.stringify(c)} : les trois verdicts sont présents`, [c.true > 0, c.false > 0, c.null > 0], [true, true, true]);
}

// ── 3. le COÛT : la méthode ne reconstruit pas une entrée par produit (c'était 67 000 `entree` et 134 000 petits tableaux)
{
    let appels = 0; const base = A;
    const espion = { identifiants: () => base.identifiants(), entree: id => { appels++; return base.entree(id); } };
    if (typeof base.partageAutreDessin === 'function') espion.partageAutreDessin = id => base.partageAutreDessin(id);
    const s = SPR.signauxDe(espion); for (const id of base.identifiants()) s(id);
    v('au plus UNE lecture d\'entrée par produit demandé (aucune passe sur tout le catalogue)', appels <= base.identifiants().length, true);
    appels = 0; const gen = SPR.signauxDe(sansMethode(espion)); gen(1);
    v('(témoin) la version sans la méthode, elle, relit TOUTES les entrées au premier appel', appels >= base.identifiants().length, true);
}
console.log(`\n${ok} réussis, ${ko} échoués`); process.exitCode = ko ? 1 : 0;
