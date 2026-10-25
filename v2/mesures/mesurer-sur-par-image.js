'use strict';
// MESURE SUR-PAR-IMAGE — LECTURE SEULE, 0 $, aucun réseau, aucune écriture. Rejoue la règle de PRODUCTION (v2/identifier/sur-par-image.js, via IndexEmpreintes.similarites et le contexte G de l'index) sur les questions des deux
// bancs (resultats-B-1025.json, variante LIVRÉ), avec les vecteurs de photo de l'extension (nav-bancs.json) et l'archive candidate. Sans, puis avec la simulation de l'exclusion de deux produits (une liste temporaire, ici : --exclure=).
// ⚠️ Ce que le banc ne porte pas : la LECTURE de la chaîne (numéro, code, langue, marques) — la condition (6) ne peut qu'ôter des sûrs, jamais en ajouter ; le faux mesuré ici est donc un MAJORANT.
// Usage : node v2/mesures/mesurer-sur-par-image.js --index=<.rmei> --archive=<.rmv> --nav=<nav-bancs.json> --resultats=<resultats-*.json> [--avecG=<resultats-essai-avecG.json>] [--exclure=744655,743194] [--marge=0.2] [--secret-env=<.env>]
const fs = require('fs'), path = require('path');
const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const racine = path.join(__dirname, '..', '..');
const X = require(path.join(racine, 'v2', 'identifier', 'index-empreintes.js')), S = require(path.join(racine, 'v2', 'chargeur', 'scellement')), F = require(path.join(racine, 'v2', 'chargeur', 'format'));
const SPI = require(path.join(racine, 'v2', 'identifier', 'sur-par-image.js'));
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
const necessaire = n => { const v = arg(n); if (!v) { console.error(`argument --${n}= manquant`); process.exit(2); } return v; };
const secret = () => { const f = necessaire('secret-env'); const m = /^V2_VISUELS_HMAC=(.*)$/m.exec(fs.readFileSync(f, 'utf8')); if (!m) { console.error('V2_VISUELS_HMAC absent du fichier d\'environnement'); process.exit(2); } return m[1].trim().replace(/^["']|["']$/g, ''); };

(async () => {
    const HMAC = secret();
    const R = JSON.parse(fs.readFileSync(necessaire('resultats'), 'utf8'));
    const tampons = arg('tampons') ? new Set(JSON.parse(fs.readFileSync(arg('tampons'), 'utf8')).lignes.flatMap(l => l.scans.flatMap(s => s.cartes.map(k => k.cle)))) : new Set();
    const LIVRE = Object.keys(R.bancs).find(k => /LIVRÉ/.test(k));
    const parse = s => { if (/^sûr (\d+)/.test(s)) return { type: 'sur' }; let m; if ((m = /^question (\[.*\])$/.exec(s))) return { type: 'question', choix: JSON.parse(m[1]) }; return { type: s }; };
    const d = new Map((R.diffs[LIVRE] || []).map(x => [x.cle, parse(x.apres)]));
    const lignes = R.ref.map(x => ({ ...x, et: d.has(x.cle) ? d.get(x.cle) : x.et })).filter(x => x.banc !== 'hors-banc');
    const fam = x => (x.banc === 'reglage' ? 'reglage' : tampons.has(x.cle) ? 'tamponnee' : 'ordinaire');
    const o = X.ouvrir(fs.readFileSync(necessaire('index')), HMAC, { modeleAttendu: MODELE });
    const idx = o.index, ctx = idx.contexteG;
    const V = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(necessaire('archive')), HMAC)));
    const exclusAvant = new Set((arg('exclure') || '').split(',').filter(Boolean).map(Number));
    // l'exclusion SIMULÉE se comporte comme la vraie (calcul.js) : un produit exclu n'a plus aucune entrée d'archive, donc il ne partage plus aucun fichier non plus
    const Vx = exclusAvant.size ? Object.create(V, { entree: { value: id => (exclusAvant.has(id) ? null : V.entree(id)) }, identifiants: { value: () => V.identifiants().filter(i => !exclusAvant.has(i)) } }) : V;
    const { signauxDe } = require(path.join(racine, 'v2', 'identifier', 'sur-par-image-route.js'));
    const signauxBruts = signauxDe(Vx);
    const marqueReelle = require(path.join(racine, 'v2', 'identifier', 'sur-par-image-route.js')).emprunteDe(Vx) || (() => null);
    console.log(`marque des emprunts : colonne ${V.colonneEmprunts === true ? 'OUI' : 'NON (archive d\'avant : toute la règle se tait)'}`);
    // --null-propre : HYPOTHÈSE de mesure seulement (lire basseDefinition null comme « propre », ce que la production ne fait PLUS) pour dire combien de questions le null fait taire
    const signaux = process.argv.includes('--null-propre') ? (id => { const s = signauxBruts(id); return s && s.basse === null ? { ...s, basse: false } : s; }) : signauxBruts;
    const nav = JSON.parse(fs.readFileSync(necessaire('nav'), 'utf8')).photos;
    const exclus = new Set((arg('exclure') || '').split(',').filter(Boolean).map(Number));
    const voir = new Set((arg('voir') || '').split(',').filter(Boolean).map(Number));
    const marge = arg('marge') ? Number(arg('marge')) : undefined;
    const jumeauxOk = V.colonneJumeaux === true && typeof V.jumeauxDe === 'function', partagesOk = V.colonneMarquages === true && typeof V.partagesDe === 'function';
    console.log(`archive : jumeaux ${jumeauxOk ? 'oui' : 'NON'}, partages ${partagesOk ? 'oui' : 'NON'} ; exclus ${[...exclus].join(',') || 'aucun'} ; marge ${marge === undefined ? SPI.MARGE + ' (code)' : marge}`);
    const qs = lignes.filter(x => x.et.type === 'question' && x.et.choix.length >= 2);
    const T = {}, motifs = {}, sûrs = [], fauxListe = [], silencesParCle = {};
    let sansVecteur = 0;
    for (const x of qs) {
        const f = fam(x);
        T[f] = T[f] || { questions: 0, avecVerite: 0, juste: 0, faux: 0, inconnue: 0 };
        T[f].questions++;
        if (x.verite != null) T[f].avecVerite++;
        const p = nav[x.cle.split(':')[0]];
        if (!p || !Array.isArray(p.emb)) { sansVecteur++; motifs['donnee-manquante (pas de vecteur de photo)'] = (motifs['donnee-manquante (pas de vecteur de photo)'] || 0) + 1; continue; }
        const q = Float32Array.from(p.emb);
        const cles = new Map(); for (const id of x.et.choix) { const e = Vx.entree(id); if (e && e.grande && e.grande.cle) cles.set(id, e.grande.cle); }
        const ordre = [...cles.values()];
        const cos = new Map(); if (ordre.length) { const r = idx.similarites(q, ordre); ordre.forEach((c, i) => cos.set(c, r[i])); }
        const top1 = idx.voisins(q, 1).top[0][0];
        const produits = new Map(x.et.choix.map(id => [id, { idProduct: id }]));
        const r = SPI.decider({
            ids: x.et.choix, cles, signaux,
            // INTEGRATION-IMAGE : la VRAIE marque — la même fonction que la route (sur-par-image-route.js::emprunteDe, qui lit version.empruntDe de l'archive, format 3). Une archive sans la colonne des emprunts : null, la règle se tait (défaut fermé).
            // --sans-marque : aucune fonction d'emprunt (la règle se tait sur toute la question). --marque-mention : l'ANCIENNE approximation (« l'entrée porte une mention »), gardée pour comparer.
            emprunte: process.argv.includes('--sans-marque') ? null : process.argv.includes('--marque-mention') ? (id => { const e = Vx.entree(id); return e ? (e.mention ? true : false) : null; }) : marqueReelle, cosinus: c => (cos.has(c) ? cos.get(c) : null), top1, contexte: ctx,
            partages: partagesOk ? id => V.partagesDe(id) : () => null, jumeaux: jumeauxOk ? id => { const j = V.jumeauxDe(id); return j ? { conclu: true, ids: [id, ...j.filter(i => i !== id)] } : { conclu: false, ids: [] }; } : null,
            produits, lu: null, marquesLues: null, redressee: p.redressee === true, ...(marge === undefined ? {} : { marge })
        });
        if (voir.size && x.et.choix.some(i => voir.has(i))) console.log(`   voir ${x.cle} choix ${x.et.choix.join(',')} vérité ${x.verite} -> ${r.sur ? `SÛR ${r.produit}` : `se tait (${r.motif})`}`);
        if (!r.sur) { motifs[r.motif] = (motifs[r.motif] || 0) + 1; silencesParCle[x.cle] = r.motif; continue; }
        if (x.verite == null) T[f].inconnue++; else if (r.produit === x.verite) T[f].juste++; else { T[f].faux++; fauxListe.push({ cle: x.cle, fam: f, choisi: r.produit, verite: x.verite, ecart: r.ecart }); }
        sûrs.push({ cle: x.cle, fam: f, produit: r.produit, verite: x.verite, ecart: r.ecart });
    }
    console.log(`questions à >= 2 choix : ${qs.length} (sans vecteur de photo : ${sansVecteur})`);
    console.log('par famille :', JSON.stringify(T));
    console.log('motifs du silence :', JSON.stringify(motifs));
    console.log('FAUX :', fauxListe.length ? JSON.stringify(fauxListe) : 'aucun');
    if (arg('sortie')) fs.writeFileSync(arg('sortie'), JSON.stringify({ par_famille: T, motifs, surs: sûrs, faux: fauxListe, questions: qs.length, silences: silencesParCle }, null, 1));
    if (arg('avecG')) {
        const A = JSON.parse(fs.readFileSync(arg('avecG'), 'utf8'));
        const kG = Object.keys(A.diffs)[0];
        const gSur = new Map(A.diffs[kG].filter(x => /^sûr (\d+)/.test(x.apres)).map(x => [x.cle, Number(/^sûr (\d+)/.exec(x.apres)[1])]));
        const inter = sûrs.filter(s => gSur.has(s.cle));
        const nouveaux = sûrs.filter(s => !gSur.has(s.cle));
        const memeAvis = inter.filter(s => gSur.get(s.cle) === s.produit).length;
        console.log(`recoupement avec G (${kG}) : sûrs de G sur ces questions ${[...gSur.keys()].filter(k => qs.some(x => x.cle === k)).length} ; sûrs de la règle ${sûrs.length} dont déjà sûrs chez G ${inter.length} (même produit ${memeAvis}) ; APPORT en plus de G ${nouveaux.length} (justes ${nouveaux.filter(s => s.verite != null && s.produit === s.verite).length}, faux ${nouveaux.filter(s => s.verite != null && s.produit !== s.verite).length})`);
        const parFam = {}; for (const s of nouveaux) { parFam[s.fam] = parFam[s.fam] || { juste: 0, faux: 0, inconnue: 0 }; if (s.verite == null) parFam[s.fam].inconnue++; else if (s.produit === s.verite) parFam[s.fam].juste++; else parFam[s.fam].faux++; }
        console.log('apport en plus de G par famille :', JSON.stringify(parFam));
    }
    process.exit(0);
})().catch(e => { console.error('ERREUR', e && e.message); process.exit(1); });
