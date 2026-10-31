'use strict';
// PERF-SCAN P2 — PREUVE D'IDENTITÉ des trois structures réduites, et leur COÛT MESURÉ. LECTURE SEULE des fichiers, 0 $, aucun réseau, aucune base. Compare la version de référence (--racine-ref : le dépôt à 4ca65c26, un autre dossier) au code d'ICI.
//   1. SUR-PAR-IMAGE : `partageAutreDessin` (colonnes) contre l'index fichier → produits d'avant, pour CHAQUE produit de l'archive (pas un échantillon) ; puis les décisions de SUR-PAR-IMAGE (sur-par-image.js::decider, les mêmes
//      entrées que la route : rejouer-temps-etapes.js) sur les lignes « question » des bancs avec les signaux de la référence et ceux d'ici : identiques ou le script sort en code 1 ;
//   2. DESIGNATION : l'index des familles construit par tableaux (référence) et par curseurs (ici) sur l'instantané complet du catalogue ; famille(id) comparé produit par produit (tous les candidats des bancs + un produit sur --pas) ;
//   3. LE COÛT : tas vivant (après gc), temps de construction, de chacune des deux constructions.
// Usage : node --expose-gc v2/mesures/rejouer-identite-perf-scan.js --racine-ref=<dépôt de référence> --index=<.rmei> --archive=<.rmv> --nav=<nav-bancs.json> --resultats=<resultats-avecG.json> --hmac=<secret LOCAL> --instantane=<dossier> [--pas=9] [--sortie=<rapport.json>]
const fs = require('fs'), path = require('path'), readline = require('readline');
const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const necessaire = n => { const v = arg(n); if (!v) { console.error(`argument --${n}= manquant`); process.exit(2); } return v; };
const ICI = path.join(__dirname, '..', '..'), REF = path.resolve(necessaire('racine-ref'));
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mo = o => Math.round(o / 1048576 * 10) / 10;
const vivant = () => { global.gc(); global.gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };      // le tas ET les tampons hors tas (tableaux typés, octets de noms) : une structure en colonnes vit surtout dans les seconds
const modules = racine => ({ SPR: require(path.join(racine, 'v2', 'identifier', 'sur-par-image-route.js')), SPI: require(path.join(racine, 'v2', 'identifier', 'sur-par-image.js')), DES: require(path.join(racine, 'v2', 'identifier', 'designation.js')) });
async function* lire(dossier, nom) {
    const { EJSON } = require(path.join(ICI, 'node_modules', 'bson'));
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dossier, `test.${nom}.ejson`)), crlfDelay: Infinity });
    for await (const l of rl) if (l) yield EJSON.parse(l, { relaxed: true });                                 // des nombres JavaScript (relaxed), pas des Int32 enveloppés
}

(async () => {
    if (typeof global.gc !== 'function') { console.error('lancer avec node --expose-gc'); process.exit(2); }
    const A = modules(REF), B = modules(ICI);
    const S = require(path.join(ICI, 'v2', 'chargeur', 'scellement')), F = require(path.join(ICI, 'v2', 'chargeur', 'format')), X = require(path.join(ICI, 'v2', 'identifier', 'index-empreintes.js'));
    const VE = require(path.join(ICI, 'v2', 'identifier', 'voisins-empreinte.js')), EV = require(path.join(ICI, 'v2', 'identifier', 'empreinte-vecteur.js'));
    const HMAC = necessaire('hmac'), MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
    let code = 0; const rapport = {};

    // ── 1a. le partage de fichiers, produit par produit, sur l'archive ENTIÈRE
    const brut = fs.readFileSync(necessaire('archive'));                                                      // .gz : l'archive de banc (non scellée, comme V2_VISUELS_BANC_FICHIER) ; sinon scellée par le HMAC
    const V = F.deserialiser(await F.decompresser(necessaire('archive').endsWith('.gz') ? brut : S.ouvrir(brut, HMAC)));
    const ids = V.identifiants();
    const sigRef = A.SPR.signauxDe({ entree: id => V.entree(id), identifiants: () => V.identifiants() });      // la référence : l'interface publique seule = l'index d'avant, même quand la version d'ici expose la méthode
    const sigIci = B.SPR.signauxDe(V);
    // COÛT : l'index d'avant (premier appel) contre la méthode d'ici (premier appel), tas vivant APRÈS gc
    const v0 = vivant(); let t = process.hrtime.bigint(); sigRef(ids[0]); const msRef = Number(process.hrtime.bigint() - t) / 1e6; const vRef = vivant() - v0;
    const v1 = vivant(); t = process.hrtime.bigint(); sigIci(ids[0]); const msIci = Number(process.hrtime.bigint() - t) / 1e6; const vIci = vivant() - v1;
    let dif = 0; const compte = { true: 0, false: 0, null: 0, absent: 0 }; const exemples = [];
    for (const id of ids) {
        const a = sigRef(id), b = sigIci(id);
        if (!a) compte.absent++; else compte[String(a.partageAutreDessin)]++;
        if (!egal(a, b)) { dif++; if (exemples.length < 3) exemples.push({ id, a, b }); }
    }
    console.log(`1a. PARTAGE DE FICHIERS — ${ids.length} produits de l'archive : verdicts ${JSON.stringify(compte)} · différences ${dif}`);
    console.log(`    coût (1er appel) : référence ${Math.round(msRef)} ms, tas vivant +${mo(vRef)} Mo · ici ${Math.round(msIci)} ms, tas vivant +${mo(vIci)} Mo`);
    rapport.partage = { produits: ids.length, verdicts: compte, differences: dif, premierAppelMs: { reference: msRef, ici: msIci }, tasVivantMo: { reference: mo(vRef), ici: mo(vIci) } };
    if (dif) { code = 1; console.log('    ↳', JSON.stringify(exemples)); }

    // ── 1b. les décisions de SUR-PAR-IMAGE sur les lignes « question » des bancs
    const R = JSON.parse(fs.readFileSync(necessaire('resultats'), 'utf8'));
    const nav = JSON.parse(fs.readFileSync(necessaire('nav'), 'utf8')).photos;
    const o = X.ouvrir(fs.readFileSync(necessaire('index')), HMAC, { modeleAttendu: MODELE });
    const courant = Object.freeze({ index: o.index, meta: o.meta }), etatFixe = { courante: () => courant };
    const enveloppe = p => VE.lireEnveloppe({ empreintes: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: p.redressee === true }], modeleEmpreinte: { id: MODELE.id, sha256: MODELE.sha256 } }, 1);
    const jumeauxOk = V.colonneJumeaux === true && typeof V.jumeauxDe === 'function', partagesOk = V.colonneMarquages === true && typeof V.partagesDe === 'function';
    const decider = (M, sig, p, x) => {
        const idsQ = x.et.choix, cles = new Map();
        for (const id of idsQ) { const e = V.entree(id); if (e && e.grande && typeof e.grande.cle === 'string' && e.grande.cle) cles.set(id, e.grande.cle); }
        const ordre = [...new Set(cles.values())], cos = new Map();
        if (ordre.length) { const r = p.courant.index.similarites(p.v.vecteur, ordre); ordre.forEach((c, i) => cos.set(c, r[i])); }
        return M.SPI.decider({ ids: idsQ, cles, signaux: sig, emprunte: B.SPR.emprunteDe(V), cosinus: c => (cos.has(c) ? cos.get(c) : null), top1: p.trouve.top.length ? p.trouve.top[0][0] : null, contexte: p.courant.index.contexteG,
            partages: partagesOk ? id => V.partagesDe(id) : () => null, jumeaux: jumeauxOk ? id => { const j = V.jumeauxDe(id); return j ? { conclu: true, ids: [id, ...j.filter(i => i !== id)] } : { conclu: false, ids: [] }; } : null,
            produits: new Map(idsQ.map(id => [id, { idProduct: id }])), lu: null, marquesLues: null, redressee: p.e0.redressee === true });
    };
    const lignes = R.ref.filter(x => x.banc !== 'hors-banc' && x.et && x.et.type === 'question' && Array.isArray(x.et.choix) && x.et.choix.length >= 2);
    let nQ = 0, nDif = 0, nSurs = 0;
    for (const x of lignes) {
        const p0 = nav[x.cle.split(':')[0]]; if (!p0 || !Array.isArray(p0.emb)) continue;
        const p = VE.preparerVecteur({ entree: { empreintes: enveloppe(p0) }, voulu: { id: MODELE.id, sha256: MODELE.sha256 }, etat: etatFixe });
        if (!p.ok) continue;
        nQ++;
        const da = decider(A, sigRef, p, x), db = decider(B, sigIci, p, x);
        if (da.sur) nSurs++;
        if (!egal(da, db)) { nDif++; code = 1; console.log('    ↳ DÉCISION DIFFÉRENTE', x.cle, JSON.stringify(da), JSON.stringify(db)); }
    }
    console.log(`1b. DÉCISIONS SUR-PAR-IMAGE — ${nQ} questions rejouées (${nSurs} sûres), décision différente : ${nDif}`);
    rapport.decisions = { questions: nQ, sures: nSurs, differentes: nDif };

    // ── 2. les familles : tableaux (référence) contre curseurs (ici), sur le catalogue entier de l'instantané
    const dossier = necessaire('instantane'), pas = Number(arg('pas') || 9);
    const nums = [], prods = [];
    for await (const d of lire(dossier, 'numeros_cartes')) nums.push({ idProduct: d.idProduct, codeSet: d.codeSet, numero: d.numero, numeroUrl: d.numeroUrl, setTcgdex: d.setTcgdex });
    for await (const d of lire(dossier, 'catalogue_produits')) prods.push({ idProduct: d.idProduct, idMetacard: d.idMetacard, name: d.name });
    const vis = id => (id % 4 === 0 ? { total: '064', tirage: 'intl' } : id % 7 === 0 ? { total: null, tirage: 'jp' } : null);
    async function* flux(l) { for (let i = 0; i < l.length; i += 500) { await new Promise(r => setImmediate(r)); for (const d of l.slice(i, i + 500)) yield d; } }
    // les deux tableaux d'entrée sont déjà en mémoire AVANT les deux mesures : le tas vivant mesuré est celui de l'INDEX seul (les lignes d'avant référencent les chaînes des documents, qui restent vivantes ici : la mesure de la
    // référence est donc un PLANCHER — en production, les documents lus ne vivraient plus que par l'index)
    const f0 = vivant(); t = process.hrtime.bigint(); const idxRef = A.DES.creerIndexFamilles(nums, prods, () => vis); const msFRef = Number(process.hrtime.bigint() - t) / 1e6;
    const fRefVivant = vivant() - f0;
    const f1 = vivant(); t = process.hrtime.bigint();
    const idxB = await B.DES.creerIndexFamillesDepuisFlux(flux(nums), flux(prods), () => vis, { numerosAttendus: nums.length, produitsAttendus: prods.length });
    const msFIci = Number(process.hrtime.bigint() - t) / 1e6; const fIciVivant = vivant() - f1;
    console.log(`2.  FAMILLES — taille référence ${idxRef.taille}, ici ${idxB.taille}`);
    console.log(`    construction : référence ${Math.round(msFRef)} ms, tas vivant de l'index +${mo(fRefVivant)} Mo · ici ${Math.round(msFIci)} ms, tas vivant de l'index +${mo(fIciVivant)} Mo`);
    rapport.familles = { taille: { reference: idxRef.taille, ici: idxB.taille }, constructionMs: { reference: msFRef, ici: msFIci }, tasVivantIndexMo: { reference: mo(fRefVivant), ici: mo(fIciVivant) } };
    if (idxRef.taille !== idxB.taille) code = 1;
    // l'identité : les candidats des bancs (tous) + un produit sur `pas`
    const candidats = new Set(); for (const x of R.ref) { if (x.verite) candidats.add(x.verite); if (x.et && Array.isArray(x.et.choix)) x.et.choix.forEach(i => candidats.add(i)); if (x.et && Number.isInteger(x.et.id)) candidats.add(x.et.id); }
    const echant = new Set([...candidats]); const tousIds = []; for await (const d of lire(dossier, 'catalogue_produits')) tousIds.push(d.idProduct);
    tousIds.forEach((id, i) => { if (i % pas === 0) echant.add(id); });
    echant.add(-1); echant.add(999999999);
    let dF = 0, nF = 0, lignesVues = 0, inconnus = 0;
    for (const id of echant) {
        const a = idxRef.famille(id), b = idxB.famille(id);
        nF++; if (a === null) inconnus++; else lignesVues += a.length;
        if (!egal(a, b)) { dF++; code = 1; if (dF <= 3) console.log('    ↳ FAMILLE DIFFÉRENTE', id, JSON.stringify(a).slice(0, 200), JSON.stringify(b).slice(0, 200)); }
    }
    console.log(`    IDENTITÉ — famille() comparée sur ${nF} produits (dont ${candidats.size} candidats des bancs, ${inconnus} inconnus), ${lignesVues} lignes de famille, différences : ${dF}`);
    rapport.familles.identite = { compares: nF, candidatsDesBancs: candidats.size, lignes: lignesVues, differences: dF };
    if (arg('sortie')) fs.writeFileSync(arg('sortie'), JSON.stringify(rapport, null, 1));
    console.log(code === 0 ? '\n✅ IDENTIQUE partout.' : '\n🔴 DIFFÉRENCES.');
    process.exit(code);
})().catch(e => { console.error('ERREUR', e && e.stack || e); process.exit(1); });
