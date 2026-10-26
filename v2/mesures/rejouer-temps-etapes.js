'use strict';
// TEMPS-ETAPES — LECTURE SEULE, 0 $, aucun réseau, aucune écriture. Rejoue sur les LIGNES DES BANCS (resultats-M27.json, variante LIVRÉ ; vecteurs de nav-bancs.json ; l'index d'empreintes du 24/10 et l'archive 27) :
//   1. l'IDENTITÉ de la coupe « voisinsUneFois » : pour chaque ligne qui porte un vecteur de photo, preparerVecteur SANS memo (le code d'avant) et AVEC memo (appelé DEUX fois, comme la règle G puis SUR-PAR-IMAGE)
//      rendent les mêmes voisins, le même meilleur cosinus, le même vecteur, la même ligne G ; et sur chaque QUESTION, la décision de SUR-PAR-IMAGE (sur-par-image.js::decider, les mêmes entrées que la route) est la même ;
//   2. le COÛT mesuré ici (CPU de ce poste, pas de l'offre gratuite) de chaque pièce : la recherche des voisins, la carte clé -> ligne bâtie à la première demande, l'index fichier -> produits bâti à la première demande ;
//      de quoi dire quelle part d'un scan est du CALCUL (étiré ~7 fois sur 0,15 vCPU) et quelle part est de l'attente.
// Usage : node v2/mesures/rejouer-temps-etapes.js --index=<.rmei> --archive=<.rmv> --nav=<nav-bancs.json> --resultats=<resultats-M27.json> --secret-env=<.env> [--sortie=<rapport.json>]
const fs = require('fs'), path = require('path');
const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const racine = path.join(__dirname, '..', '..');
const X = require(path.join(racine, 'v2', 'identifier', 'index-empreintes.js')), S = require(path.join(racine, 'v2', 'chargeur', 'scellement')), F = require(path.join(racine, 'v2', 'chargeur', 'format'));
const SPI = require(path.join(racine, 'v2', 'identifier', 'sur-par-image.js'));
const SPR = require(path.join(racine, 'v2', 'identifier', 'sur-par-image-route.js'));
const VE = require(path.join(racine, 'v2', 'identifier', 'voisins-empreinte.js'));
const EV = require(path.join(racine, 'v2', 'identifier', 'empreinte-vecteur.js'));
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
const necessaire = n => { const v = arg(n); if (!v) { console.error(`argument --${n}= manquant`); process.exit(2); } return v; };
const secret = () => { const m = /^V2_VISUELS_HMAC=(.*)$/m.exec(fs.readFileSync(necessaire('secret-env'), 'utf8')); if (!m) { console.error('V2_VISUELS_HMAC absent du fichier d\'environnement'); process.exit(2); } return m[1].trim().replace(/^["']|["']$/g, ''); };
const mediane = v => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const ms = f => { const t = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
    const HMAC = secret();
    const R = JSON.parse(fs.readFileSync(necessaire('resultats'), 'utf8'));
    const LIVRE = Object.keys(R.bancs).find(k => /LIVRÉ/.test(k));
    const parse = s => { if (/^sûr (\d+)/.test(s)) return { type: 'sur' }; let m; if ((m = /^question (\[.*\])$/.exec(s))) return { type: 'question', choix: JSON.parse(m[1]) }; return { type: s }; };
    const d = new Map((R.diffs[LIVRE] || []).map(x => [x.cle, parse(x.apres)]));
    const lignes = R.ref.map(x => ({ ...x, et: d.has(x.cle) ? d.get(x.cle) : x.et })).filter(x => x.banc !== 'hors-banc');
    const nav = JSON.parse(fs.readFileSync(necessaire('nav'), 'utf8')).photos;
    const [msIndex, o] = ms(() => X.ouvrir(fs.readFileSync(necessaire('index')), HMAC, { modeleAttendu: MODELE }));
    const idx = o.index, meta = o.meta;
    const courant = Object.freeze({ index: idx, meta });
    const etatFixe = { courante: () => courant };                                         // le MÊME objet à chaque appel (comme l'état en place)
    const [msArchive, V] = await (async () => { const t = process.hrtime.bigint(); const v = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(necessaire('archive')), HMAC))); return [Number(process.hrtime.bigint() - t) / 1e6, v]; })();
    console.log(`index : ${idx.n} empreintes (${Math.round(msIndex)} ms à l'ouverture) · archive : ${Math.round(msArchive)} ms à l'ouverture · lignes des bancs hors-banc exclues : ${lignes.length}`);

    // ── 2. le COÛT de chaque pièce (ce poste ; l'offre gratuite étire le calcul, voir le rapport)
    const avecVecteur = lignes.filter(x => { const p = nav[x.cle.split(':')[0]]; return p && Array.isArray(p.emb); });
    const qtest = Float32Array.from(nav[avecVecteur[0].cle.split(':')[0]].emb);
    const mesVoisins = []; for (let i = 0; i < 25; i++) mesVoisins.push(ms(() => idx.voisins(qtest, 10))[0]);
    const [msSim1] = ms(() => idx.similarites(qtest, [idx.cles[0]]));                         // la 1re demande bâtit la carte clé -> ligne
    const mesSim = []; for (let i = 0; i < 25; i++) mesSim.push(ms(() => idx.similarites(qtest, [idx.cles[1], idx.cles[2], idx.cles[3]]))[0]);
    const idUn = V.identifiants()[0];
    const [msSig1] = ms(() => SPR.signauxDe(V)(idUn));                                        // le 1er signal bâtit l'index fichier -> produits
    const mesSig = []; for (let i = 0; i < 25; i++) mesSig.push(ms(() => SPR.signauxDe(V)(idUn))[0]);
    const cout = { voisins_ms_mediane: mediane(mesVoisins), voisins_ms_max: Math.max(...mesVoisins), similarites_1re_demande_ms: msSim1, similarites_ensuite_ms_mediane: mediane(mesSim), signaux_1re_demande_ms: msSig1, signaux_ensuite_ms_mediane: mediane(mesSig), produits_archive: V.identifiants().length };
    console.log('COÛT (ce poste) :', JSON.stringify(cout, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));

    // ── 1. l'IDENTITÉ
    function enveloppe(p) { return VE.lireEnveloppe({ empreintes: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: p.redressee === true }], modeleEmpreinte: { id: MODELE.id, sha256: MODELE.sha256 } }, 1); }
    const T = { lignes: avecVecteur.length, preparerIdentiques: 0, preparerDifferents: 0, memoUneSeuleRecherche: 0, questions: 0, spiIdentiques: 0, spiDifferents: 0, spiSurs: 0, differences: [] };
    const jumeauxOk = V.colonneJumeaux === true && typeof V.jumeauxDe === 'function', partagesOk = V.colonneMarquages === true && typeof V.partagesDe === 'function';
    const signaux = SPR.signauxDe(V), emprunte = SPR.emprunteDe(V);
    // le compteur de recherches : on enveloppe voisins sur l'instance (pour le seul rejeu)
    let nRecherches = 0; const vraie = idx.voisins.bind(idx); idx.voisins = (q, k) => { nRecherches++; return vraie(q, k); };
    const decider = (p, x) => {
        const ids = x.et.choix, cles = new Map();
        for (const id of ids) { const e = V.entree(id); if (e && e.grande && typeof e.grande.cle === 'string' && e.grande.cle) cles.set(id, e.grande.cle); }
        const ordre = [...new Set(cles.values())], cos = new Map();
        if (ordre.length) { const r = p.courant.index.similarites(p.v.vecteur, ordre); ordre.forEach((c, i) => cos.set(c, r[i])); }
        return SPI.decider({ ids, cles, signaux, emprunte, cosinus: c => (cos.has(c) ? cos.get(c) : null), top1: p.trouve.top.length ? p.trouve.top[0][0] : null, contexte: p.courant.index.contexteG,
            partages: partagesOk ? id => V.partagesDe(id) : () => null, jumeaux: jumeauxOk ? id => { const j = V.jumeauxDe(id); return j ? { conclu: true, ids: [id, ...j.filter(i => i !== id)] } : { conclu: false, ids: [] }; } : null,
            produits: new Map(ids.map(id => [id, { idProduct: id }])), lu: null, marquesLues: null, redressee: p.e0.redressee === true });
    };
    const voulu = { id: MODELE.id, sha256: MODELE.sha256 };
    for (const x of avecVecteur) {
        const p = nav[x.cle.split(':')[0]];
        const avant = VE.preparerVecteur({ entree: { empreintes: enveloppe(p) }, voulu, etat: etatFixe });                        // le code d'avant : sans memo
        const e = { empreintes: enveloppe(p) };
        nRecherches = 0;
        const g = VE.preparerVecteur({ entree: e, voulu, etat: etatFixe, memo: true });                                        // la règle G
        const s = VE.preparerVecteur({ entree: e, voulu, etat: etatFixe, memo: true });                                        // SUR-PAR-IMAGE
        if (avant.ok && nRecherches === 1) T.memoUneSeuleRecherche++;                                                          // un succès : UNE recherche pour les deux lecteurs (un échec n'est jamais mémorisé : non compté)
        const proj = r => (r.ok ? { ok: true, top: r.trouve.top, meilleur: r.trouve.meilleur, vecteur: Array.from(r.v.vecteur), cos: r.v.meilleurCosinus, photo: r.e0.photo, redressee: r.e0.redressee } : { ok: false, code: r.code });
        if (egal(proj(avant), proj(g)) && egal(proj(avant), proj(s))) T.preparerIdentiques++; else { T.preparerDifferents++; if (T.differences.length < 5) T.differences.push({ cle: x.cle, genre: 'preparerVecteur' }); }
        if (x.et.type === 'question' && x.et.choix.length >= 2 && avant.ok) {
            T.questions++;
            const dAvant = decider(avant, x), dApres = decider(s, x);
            if (dAvant.sur) T.spiSurs++;
            if (egal(dAvant, dApres)) T.spiIdentiques++; else { T.spiDifferents++; if (T.differences.length < 5) T.differences.push({ cle: x.cle, genre: 'SUR-PAR-IMAGE' }); }
        }
    }
    console.log('IDENTITÉ :', JSON.stringify(T));

    // ── 3. la coupe « orbUtile » : G ne change JAMAIS un introuvable. Les lignes où la chaîne livrée rend un « je ne sais pas » (le refus : `ne-sait-pas`, l'introuvable de la route) ; la variante « + G » du même rejeu (index du 24/10, archive 27)
    //      change-t-elle l'une d'elles ? Les 23 lignes que G change sont toutes question -> sûr.
    const kG = Object.keys(R.diffs).find(k => /\+ G/.test(k));
    const diffsG = kG ? R.diffs[kG] : [];
    const introuvables = lignes.filter(x => x.et.type === 'ne-sait-pas');
    const cles = new Set(introuvables.map(x => x.cle));
    const changeesParG = diffsG.filter(x => cles.has(x.cle));
    const depuis = {}; for (const x of diffsG) { const a = String(x.avant).split(' ')[0], b = String(x.apres).split(' ')[0]; depuis[`${a} -> ${b}`] = (depuis[`${a} -> ${b}`] || 0) + 1; }
    const O = { variante: kG || null, lignes: lignes.length, introuvablesDeLaChaine: introuvables.length, introuvablesChangesParG: changeesParG.length, tousLesChangementsDeG: depuis, lignesChangeesParG: diffsG.length };
    console.log('ORB UTILE (G ne change jamais un introuvable) :', JSON.stringify(O));
    if (arg('sortie')) fs.writeFileSync(arg('sortie'), JSON.stringify({ cout, identite: T, orbUtile: O }, null, 1));
    process.exit(T.preparerDifferents || T.spiDifferents || O.introuvablesChangesParG || !kG ? 1 : 0);
})().catch(e => { console.error('ERREUR', e && e.message); process.exit(1); });
