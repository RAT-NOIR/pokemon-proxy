'use strict';
const DONNEES = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\essais-repli';      // dossier des données de mesure (hors dépôt)
// GUICHET 01/11 — TAMPONNÉES : la PREUVE À L'IMAGE, par la règle de e14-classes-orb.js (celle des emprunts déjà classés) appliquée aux produits refusés par le repli (t1-refuses.json).
//   L'image refusée (la carte normale, ou l'emprunt du catalogue) est comparée à TOUS les autres scans de la même carte (hors langue japonaise pour un tirage non japonais) :
//   cosinus d'empreinte (index du 24/10, modèle p8000) ET inliers ORB+RANSAC de la fenêtre d'illustration (departage-image.js, fenêtre calée à l'œil en e12).
//   « concorde » : fenêtre >= 30 inliers OU cosinus >= 0,9 ; « contredit » : fenêtre <= 15 ET cosinus < 0,7 (ou inconnu) ; sinon « hésite ».
//   classe « meme » (preuve) : TOUS les scans de référence concordent ; « different » : tous contredisent ; sinon « indecidable » (aucun autre scan, scan non mesurable, mixte, hésitant).
//   Le NOMBRE minimal de références n'est pas fixé par la règle des emprunts ; ici une carte SANS autre scan est indécidable (rien à comparer), jamais admise.
// Sortie : t2-preuve.json ; liste fermée candidate : tamponnees-empruntees-2026-11-01.json ({ decision, le, produits: [{ idProduct, preuve }] }). Lecture seule, rien n'est publié.
const path = require('path'), fs = require('fs');
const { ENV, API } = require('C:\\Users\\Yung\\rat-market-travail\\api\\atlas\\garde-secrets');
const WT = 'C:\\Users\\Yung\\rat-market-travail\\api\\v2-guichet', ARCH = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\';
const X = require(path.join(API, 'v2', 'identifier', 'index-empreintes.js'));
const EV = require(path.join(API, 'v2', 'identifier', 'empreinte-vecteur.js'));
const O = require('./e12-orb');
const E = 'C:\\Users\\Yung\\rat-market-travail\\api\\index-empreintes-essai\\';
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
const env = { ...process.env, ...ENV };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
(async () => {
    const o = X.ouvrir(fs.readFileSync(E + 'sortie\\index-empreintes-2026-10-24.rmei'), ENV.V2_VISUELS_HMAC, { modeleAttendu: MODELE });
    const idx = o.index, ligne = new Map(idx.cles.map((c, i) => [c, i])); const cv_ = new Map();
    const vec = c => { if (cv_.has(c)) return cv_.get(c); const r = ligne.get(c); let v = null; if (r !== undefined) { v = new Float32Array(256); for (let j = 0; j < 256; j++) v[j] = EV.demiVersFlottant(idx.mat16[r * 256 + j]); } cv_.set(c, v); return v; };
    const { sourceCartes } = require(path.join(WT, 'v2', 'chargeur', 'source'));
    const src = await sourceCartes({ env }); if (!src.ok) { console.log('ARRÊT source :', src.raison); process.exit(1); }
    const tirDe = new Map(src.sets.map(s => [s._id, s.tirage ?? s.region]));
    const carteDe = new Map(src.docs.map(d => [d._id, d]));
    const refuses = JSON.parse(fs.readFileSync(path.join(DONNEES, 't1-refuses.json'), 'utf8'));
    const lignes = new Map(src.lignes.map(l => [l.idProduct, l]));
    const { cv } = await O.D.outils();
    const res = []; let n = 0;
    const portee = r => r.refus !== 'wcd' && r.refus !== 'tamponnees-nommees' ? true : (r.refus === 'tamponnees-nommees' && /^Trick-or-Trade/.test(r.set));
    for (const r of refuses.filter(portee)) {
        const cle = r.im && r.im.cleR2; const l = lignes.get(r.idProduct); const c = l && carteDe.get(l.carteId);
        if (!cle || !c) { res.push({ ...r, classe: 'indecidable', sous: 'pas d\'image refusée ou carte absente', mesures: [] }); continue; }
        const tir = r.tirage;
        const autres = [...new Map((c.images || []).filter(m => m && m.cleR2 && m.cleR2 !== cle && !(tir !== 'jp' && m.langue === 'ja')).map(m => [m.cleR2, { cle: m.cleR2, set: m.set, tir: tirDe.get(m.set), langue: m.langue }])).values()];
        const memeTir = autres.filter(m => m.tir === tir);
        let niveau = 'tirage', refs = memeTir; if (!refs.length) { niveau = 'autres-tirages'; refs = autres; }
        const ve = vec(cle), da = await O.desc(cle, 'fen');
        let mesures = refs.map(m => { const vm = vec(m.cle); return { cle: m.cle, set: m.set, tir: m.tir, cos: ve && vm ? +dot(ve, vm).toFixed(4) : null, local: !!O.local(m.cle) }; });
        if (niveau === 'autres-tirages' && mesures.length > 40) mesures = mesures.sort((a, b) => (b.cos ?? -1) - (a.cos ?? -1)).filter((_, i) => i < 20 || i >= mesures.length - 20);
        for (const m of mesures) { const db = da && m.local ? await O.desc(m.cle, 'fen') : null; m.fen = da && db ? O.D.inliers(cv, da, db) : null; }
        const conc = m => (m.fen !== null && m.fen >= 30) || (m.cos !== null && m.cos >= 0.9);
        const contr = m => m.fen !== null && m.fen <= 15 && (m.cos === null || m.cos < 0.7);
        const mesurable = m => m.fen !== null || m.cos !== null;
        let classe, sous;
        if (!da && !ve) { classe = 'indecidable'; sous = 'image refusée non mesurable (ni image locale ni empreinte)'; }
        else if (!mesures.length) { classe = 'indecidable'; sous = 'la carte n\'a aucun autre scan'; }
        else if (!mesures.every(mesurable)) { classe = 'indecidable'; sous = 'un scan de référence non mesurable'; }
        else if (mesures.every(conc)) { classe = 'meme'; sous = niveau === 'tirage' ? 'tous les scans du tirage (' + mesures.length + ') concordent' : 'aucun scan du tirage ; tous les scans des autres tirages (' + mesures.length + ') concordent'; }
        else if (mesures.every(contr)) { classe = 'different'; sous = 'tous les scans de référence (' + mesures.length + ') contredisent'; }
        else if (mesures.some(conc)) { classe = 'indecidable'; sous = 'mixte : la carte porte plusieurs dessins'; }
        else { classe = 'indecidable'; sous = 'mesure hésitante'; }
        res.push({ idProduct: r.idProduct, refus: r.refus, set: r.set, visuel: r.visuel, imSet: r.im.set, imSource: r.im.source, emp: r.im.emp, niveau, classe, sous, nRefs: mesures.length, nConc: mesures.filter(conc).length, mesures });
        if (++n % 100 === 0) console.log(n);
    }
    fs.writeFileSync(path.join(DONNEES, 't2-preuve.json'), JSON.stringify(res));
    const T = {}; for (const r of res) { const k = r.refus + (r.set && /^Trick/.test(r.set) ? ' (ToT)' : '') + ' | ' + r.classe; T[k] = (T[k] || 0) + 1; }
    console.log('dénominateur', res.length); console.log(JSON.stringify(Object.entries(T).sort(), null, 1));
    const S = {}; for (const r of res) { const k = r.classe + ' / ' + String(r.sous).replace(/\(\d+\)/g, '(n)'); S[k] = (S[k] || 0) + 1; } console.log(JSON.stringify(Object.entries(S).sort((a, b) => b[1] - a[1]), null, 1));
    const admis = res.filter(r => r.classe === 'meme').map(r => ({ idProduct: r.idProduct, preuve: `${r.sous} (fenêtre >= 30 inliers ou cosinus >= 0,9 ; règle de e14-classes-orb.js)` })).sort((a, b) => a.idProduct - b.idProduct);
    fs.writeFileSync(ARCH + 'tamponnees-empruntees-2026-11-01.json', JSON.stringify({ decision: 'GUICHET 01/11 : tamponnées servies EMPRUNTÉES, prouvées à l\'image', le: '2026-11-01', produits: admis }, null, 1));
    console.log('liste fermée :', admis.length);
    try { await src.fermer(); } catch { }
    process.exit(0);
})().catch(e => { console.log('ERREUR', e && e.message, String(e && e.stack).split('\n').slice(1, 4).join('|')); process.exit(1); });
