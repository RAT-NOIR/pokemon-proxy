'use strict';
// LOT ETAT-TITRE — mesure de l'APPEL D'ÉTAT SÉPARÉ (photos seules, sans titre) contre l'état d'aujourd'hui, avec un PLAFOND DE DÉPENSE DUR (le carnet de TEMPS-CHAINE : coût réel lu chez le fournisseur, arrêt AVANT le plafond).
//   node v2/mesures/mesurer-etat-titre.js --sortie=<dossier> [--plafond=0.30] [--n=60] [--paires=20] [--graine=20261018] [--pilote=3]
// Ce que ça FAIT, sur des scans du banc tirés au hasard (réglage et contrôle mêlés), avec leur photo du bucket PRIVÉ du banc (clé de LECTURE, jamais Vinted, jamais une URL d'annonce), ramenée à 800 px de grand côté :
//   · PHASE 1 (n cartes) : l'appel d'état de la production (v2/identifier/etat-photos.js, la même consigne, le même modèle) sur la photo ; comparé à l'état que la production avait rendu pour ce scan (`analyses.cartes[0].etat`,
//     estimé avec le titre et toutes les photos de l'annonce, la photo du banc n'étant que la première) ; part des états nuls ; durée p50 / p95 ; coût lu sur chaque appel.
//   · PHASE 2 (paires cartes, parmi les mêmes) : l'appel d'identification d'AUJOURD'HUI (la consigne de index.js, sans titre) et l'appel d'état, lancés EN PARALLÈLE sur la même photo ; l'état de l'identification est l'état d'aujourd'hui
//     SUR LA MÊME PHOTO ; l'écart de l'appel d'état à lui-même (la phase 1 contre la phase 2) donne le bruit du modèle ; la durée d'un scan devient le plus lent des deux appels.
// Aucune écriture en base (rm_essai en lecture, MONGODB_ESSAI_LECTURE_URI), aucune écriture dans le bucket, aucune valeur secrète affichée (garde-secrets).
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..');
const MODELE = 'google/gemini-3-flash-preview';                                   // le modèle de la chaîne (index.js : MODELE_IA)
const ORDRE = Object.freeze(['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);

// ── fonctions pures (jugées par v2/test/test-mesurer-etat-titre.js)
/** L'écart en crans entre deux états du barème ; null si l'un des deux n'est pas du barème. */
function ecart(a, b) {
    const i = ORDRE.indexOf(String(a ?? '').toUpperCase()), j = ORDRE.indexOf(String(b ?? '').toUpperCase());
    return i < 0 || j < 0 ? null : Math.abs(i - j);
}
/**
 * L'accord entre deux états. paires : [{ a, b }] (a : l'état d'aujourd'hui, b : l'état de l'appel séparé ; null = aucun état).
 * Rend les comptes, DÉNOMINATEUR compris : les deux états lus (même / un cran / deux crans ou plus), l'un lu et l'autre nul (dans les deux sens), les deux nuls.
 */
function bilanAccord(paires) {
    const r = { paires: paires.length, lusTousDeux: 0, memeEtat: 0, unCran: 0, deuxCransOuPlus: 0, dessous: 0, dessus: 0, aujourdhuiSeulLu: 0, separeSeulLu: 0, aucunDesDeux: 0, plusGrandEcart: 0 };
    for (const { a, b } of paires) {
        const e = ecart(a, b), la = ecart(a, a) === 0, lb = ecart(b, b) === 0;
        if (la && lb) {
            r.lusTousDeux++;
            if (e === 0) r.memeEtat++; else if (e === 1) r.unCran++; else r.deuxCransOuPlus++;
            if (e > r.plusGrandEcart) r.plusGrandEcart = e;
            const sens = ORDRE.indexOf(String(b).toUpperCase()) - ORDRE.indexOf(String(a).toUpperCase());
            if (sens > 0) r.dessous++; else if (sens < 0) r.dessus++;           // dessous : l'appel séparé juge la carte PLUS ABÎMÉE que l'état d'aujourd'hui
        } else if (la) r.aujourdhuiSeulLu++;
        else if (lb) r.separeSeulLu++;
        else r.aucunDesDeux++;
    }
    return r;
}
const pct = (v, p) => { const s = v.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : null; };
const moy = v => { const s = v.filter(Number.isFinite); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
/** L'état retenu de la production : la porte de confiance (haute ou moyenne), sinon null — la même règle que index.js (etatRetenuDuModele). */
const retenu = (estime, confiance) => (confiance === 'haute' || confiance === 'moyenne') && ORDRE.includes(String(estime ?? '').toUpperCase()) ? String(estime).toUpperCase() : null;
module.exports = { ecart, bilanAccord, pct, moy, retenu, ORDRE, MODELE };

// ── l'exécution
function arg(nom, defaut) { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : defaut; }
async function principal() {
    require('C:/Users/Yung/rat-market-travail/api/atlas/garde-secrets');            // AVANT tout : aucune valeur du .env n'est jamais affichée
    const { ouvrir } = require('C:/Users/Yung/rat-market-travail/api/mesure-banc-reel/lib');
    const sortie = arg('sortie'); if (!sortie) throw new Error('--sortie=<dossier> est obligatoire');
    fs.mkdirSync(sortie, { recursive: true });
    const plafond = Number(arg('plafond', '0.30')); if (!(plafond > 0 && plafond <= 0.30)) throw new Error('plafond : entre 0 et 0,30 $ (le plafond du lot)');
    const N = Number(arg('n', '60')), NP = arg('variante', null) ? 0 : Number(arg('paires', '20')), graine = Number(arg('graine', '20261018')), pilote = Number(arg('pilote', '0'));
    const cle = process.env.OPENROUTER_API_KEY; if (!cle) throw new Error('OPENROUTER_API_KEY absente du .env d\'api-v2');
    const axios = require(path.join(RACINE, 'node_modules', 'axios')), sharp = require(path.join(RACINE, 'node_modules', 'sharp'));
    const E = require('../identifier/etat-photos');
    const { creerCarnet } = require('./mesurer-temps-ia');
    // LA consigne d'identification de la production, lue dans sa source (même regex que mesurer-temps-ia et verrou/empreinte.js), sans titre
    const source = fs.readFileSync(path.join(RACINE, 'index.js'), 'utf8');
    const promptIdent = new Function('title', 'return `' + source.match(/const prompt = `([\s\S]*?)`;/)[1] + '`')('');

    // 1. les scans du banc : un scan = une carte = une photo, avec l'état que la production avait rendu
    const { c, db } = await ouvrir();
    const A = await db.collection('analyses').find({ 'photoBanc.cle': { $type: 'string' } }, { projection: { cartes: 1, photoBanc: 1, creeLe: 1 } }).toArray();
    const lignes = A.filter(a => Array.isArray(a.cartes) && a.cartes.length === 1 && a.cartes[0].etat && typeof a.cartes[0].etat === 'object')
        .map(a => ({ id: String(a._id), cleR2: a.photoBanc.cle, courant: { estime: a.cartes[0].etat.estime ?? null, confiance: a.cartes[0].etat.confiance ?? null, retenu: a.cartes[0].etat.retenu ?? null } }));
    console.log(`analyses du banc avec photo : ${A.length} · un seul résultat et un état journalisé : ${lignes.length} (dont état estimé non nul : ${lignes.filter(l => l.courant.estime).length})`);
    let g = graine; const alea = () => { g = (g * 1664525 + 1013904223) % 4294967296; return g / 4294967296; };
    const reference = arg('reference', null) ? JSON.parse(fs.readFileSync(arg('reference'), 'utf8')) : null;
    const refIdent = new Map(reference ? reference.phase2.map(p => [p.id, p.ident]) : []);
    let tirage = lignes.map(l => ({ l, r: alea() })).sort((x, y) => x.r - y.r).slice(0, pilote || N).map(x => x.l);
    if (reference) tirage = tirage.filter(x => refIdent.has(x.id));

    // 2. les photos (bucket PRIVÉ du banc, lecture seule)
    if (process.env.R2_ESSAI_BANC_LECTURE_CLE_ID && process.env.R2_ESSAI_BANC_LECTURE_SECRET) {
        process.env.R2_ACCESS_KEY_ID = process.env.R2_ESSAI_BANC_LECTURE_CLE_ID; process.env.R2_SECRET_ACCESS_KEY = process.env.R2_ESSAI_BANC_LECTURE_SECRET;
        if (!process.env.V2_BANC_BUCKET) process.env.V2_BANC_BUCKET = 'rm-essai-banc';
    }
    let st;
    try { const { creerStockageReel } = require('../banc/stockage'); st = creerStockageReel(process.env); await st.verifierBucket(); }
    catch (e) {
        if (!e || e.code !== 'bucket-refuse') throw e;
        const r2 = require('../../collecte-cartes/r2'), bucket = process.env.V2_BANC_BUCKET;
        await r2.verifierBucket(bucket);
        st = { lire: cleR2 => { if (!/^banc-reel\/v2\/(attente\/)?[0-9a-f]{32}\.webp$/.test(String(cleR2))) throw new Error('clé refusée'); return r2.lireBinaire(bucket, cleR2); } };
    }

    // 3. le client : le modèle de la chaîne, le coût lu sur chaque réponse (usage.cost), arrêt AVANT le plafond
    const carnet = creerCarnet({ fichier: path.join(sortie, 'depense.json'), plafondUsd: plafond });
    const URL = 'https://openrouter.ai/api/v1/chat/completions', ENTETES = { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' };
    const poster = async corps => {
        if (!carnet.peutAppeler()) throw Object.assign(new Error('plafond'), { code: 'PLAFOND' });
        let r;
        try { r = await axios.post(URL, { ...corps, usage: { include: true } }, { headers: ENTETES, timeout: 30000 }); }
        catch (e) { carnet.compter(null); throw e; }                      // un appel qui échoue a pu être facturé : au pire connu
        const u = r.data && r.data.usage ? r.data.usage : {};
        carnet.compter(u.cost);
        r.cout = Number.isFinite(u.cost) ? u.cost : null;
        return r;
    };
    // l'appel d'état : EXACTEMENT celui de la production (estimerEtat), avec le coût capté au passage
    const appelEtat = async images => {
        let cout = null;
        const r = await E.estimerEtat({ images, modele: MODELE, journal: { error: () => { } }, appeler: async corps => { const x = await poster(corps); cout = x.cout; return x; } });
        return { ...r, cout };
    };
    // l'appel d'identification d'AUJOURD'HUI, sans titre : sa consigne, la photo, rien d'autre (comme getCardIdFromAI)
    const appelIdent = async images => {
        const t = Date.now();
        try {
            const r = await poster({ model: MODELE, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: promptIdent }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] }] });
            const contenu = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message ? r.data.choices[0].message.content : undefined;
            return { ms: Date.now() - t, cout: r.cout, etat: E.analyserReponse(contenu) };
        } catch (e) { return { ms: Date.now() - t, cout: null, etat: null, erreur: e.code || (e.response && e.response.status) || 'erreur' }; }
    };

    // LA VARIANTE (diagnostic, jamais câblée) `--variante=sans-verso` : la même consigne d'état SANS les deux phrases sur le verso non fourni (« ou verso non visible » dans la liste de la confiance « basse », et la phrase finale).
    // La banc ne garde qu'UNE photo par scan : la consigne d'état, qui est la seule tâche de l'appel, applique la règle du verso à la lettre et rend « basse » ; la variante dit si c'est cette règle qui la fait rendre.
    const variante = arg('variante', null);
    let consigneVariante = null;
    // `--variante=<nom>` : un texte de consigne essayé sur les photos de `--reference=<bilan.json de la mesure>` (mêmes scans, même graine), comparé à l'identification d'AUJOURD'HUI de cette mesure (phase 2).
    const VARIANTES = {
        'sans-verso': P => P.replace(', ou verso non visible', '').replace('\nSi aucune photo du verso n\'est fournie, dis-le via etatConfiance "basse".', ''),
        'verso-neutre': P => P.replace(', ou verso non visible', '').replace('Si aucune photo du verso n\'est fournie, dis-le via etatConfiance "basse".', 'Si aucune photo du verso n\'est fournie, ne baisse pas la confiance pour cela : elle se juge sur la netteté de ce que tu vois.'),
        'verso-neutre-nue': P => VARIANTES['verso-neutre'](P).replace('Dans le doute, sois PESSIMISTE', 'Une carte nue, vue de face sur une photo nette, se juge au moins "moyenne" même sans verso. Dans le doute sur l\'ÉTAT, sois PESSIMISTE'),
        'verso-neutre-defaut-nue': P => VARIANTES['verso-neutre-nue'](P).replace('N\'invente rien.', 'N\'invente rien. Une photo manquante (verso, gros plan) n\'est pas un défaut de la carte : ne l\'écris pas dans defautsVus.'),
        'verso-neutre-defaut': P => VARIANTES['verso-neutre'](P).replace('N\'invente rien.', 'N\'invente rien. Une photo manquante (verso, gros plan) n\'est pas un défaut de la carte : ne l\'écris pas dans defautsVus.'),
    };
    if (variante) {
        if (!VARIANTES[variante]) throw new Error(`variante inconnue : ${variante}`);
        consigneVariante = VARIANTES[variante](E.PROMPT_ETAT);
        if (consigneVariante === E.PROMPT_ETAT) throw new Error('la variante n\'a rien changé');
    }
    const appelVariante = async images => {
        const t = Date.now();
        try {
            const r = await poster({ model: MODELE, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: consigneVariante }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] }] });
            const contenu = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message ? r.data.choices[0].message.content : undefined;
            const e = E.analyserReponse(contenu);
            return e ? { ...e, ms: Date.now() - t, cause: null, cout: r.cout } : { etatEstime: null, etatConfiance: null, defautsVus: null, ms: Date.now() - t, cause: 'illisible', cout: r.cout };
        } catch (e) { return { etatEstime: null, etatConfiance: null, defautsVus: null, ms: Date.now() - t, cause: 'panne', cout: null }; }
    };

    // 4. PHASE 1 : l'appel d'état sur la photo, contre l'état journalisé par la production
    const fichierRes = path.join(sortie, 'appels.jsonl');
    const phase1 = [];
    for (const x of tirage) {
        if (carnet.etat().arret || !carnet.peutAppeler()) { console.log(`⛔ ARRÊT AVANT DÉPASSEMENT : ${carnet.etat().arret}`); break; }
        let photo = null; try { photo = await st.lire(x.cleR2); } catch { /* photo absente du bucket */ }
        if (!photo) { phase1.push({ ...x, sansImage: true }); continue; }
        const jpeg = await sharp(photo).rotate().resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        x.url = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
        const r = variante ? await appelVariante([x.url]) : await appelEtat([x.url]);
        const ligne = { ...x, url: undefined, separe: { estime: r.etatEstime, confiance: r.etatConfiance, retenu: retenu(r.etatEstime, r.etatConfiance), defauts: r.defautsVus, cause: r.cause, ms: r.ms, cout: r.cout } };
        phase1.push({ ...ligne, url: x.url });
        fs.appendFileSync(fichierRes, JSON.stringify({ phase: 1, ...ligne }) + '\n');
    }
    // 5. PHASE 2 : la paire en parallèle sur les NP premières cartes lues
    const phase2 = [];
    for (const x of phase1.filter(y => y.url && y.separe && !y.separe.cause).slice(0, pilote ? Math.min(pilote, NP) : NP)) {
        if (carnet.etat().arret || !carnet.peutAppeler()) { console.log(`⛔ ARRÊT AVANT DÉPASSEMENT (phase 2) : ${carnet.etat().arret}`); break; }
        const t = Date.now();
        const [ident, sep] = await Promise.all([appelIdent([x.url]), appelEtat([x.url])]);
        const mur = Date.now() - t;
        const ligne = { id: x.id, ident: { lu: Boolean(ident.etat), estime: ident.etat && ident.etat.etatEstime, confiance: ident.etat && ident.etat.etatConfiance, retenu: ident.etat ? retenu(ident.etat.etatEstime, ident.etat.etatConfiance) : null, ms: ident.ms, cout: ident.cout, erreur: ident.erreur || null },
            separe2: { estime: sep.etatEstime, confiance: sep.etatConfiance, retenu: retenu(sep.etatEstime, sep.etatConfiance), cause: sep.cause, ms: sep.ms, cout: sep.cout }, murMs: mur, separe1: x.separe };
        phase2.push(ligne);
        fs.appendFileSync(fichierRes, JSON.stringify({ phase: 2, ...ligne }) + '\n');
    }
    await c.close();

    // 6. le rendu
    const lus = phase1.filter(x => x.separe);
    const d = (nom, o) => console.log(`${nom} : ${JSON.stringify(o)}`);
    console.log(`\n══ PHASE 1 : ${lus.length} scans lus sur ${phase1.length} tirés (sans photo au bucket : ${phase1.filter(x => x.sansImage).length}, appels en échec : ${lus.filter(x => x.separe.cause).length})`);
    const ok1 = lus.filter(x => !x.separe.cause);
    d('  état ESTIMÉ (avis brut) : appel séparé contre la production d\'alors', bilanAccord(ok1.map(x => ({ a: x.courant.estime, b: x.separe.estime }))));
    d('  état RETENU (après la porte de confiance) : appel séparé contre la production d\'alors', bilanAccord(ok1.map(x => ({ a: x.courant.retenu, b: x.separe.retenu }))));
    d('  part des états RETENUS nuls : appel séparé', { nuls: ok1.filter(x => !x.separe.retenu).length, sur: ok1.length, part: ok1.length ? +(ok1.filter(x => !x.separe.retenu).length / ok1.length).toFixed(3) : null });
    d('  part des états RETENUS nuls : production d\'alors', { nuls: ok1.filter(x => !x.courant.retenu).length, sur: ok1.length });
    d('  confiances de l\'appel séparé', ['haute', 'moyenne', 'basse', null].map(k => [k, ok1.filter(x => x.separe.confiance === k).length]));
    d('  durée de l\'appel d\'état (ms) p50 / p95 / moyenne', [pct(ok1.map(x => x.separe.ms), 0.5), pct(ok1.map(x => x.separe.ms), 0.95), Math.round(moy(ok1.map(x => x.separe.ms)))]);
    d('  coût de l\'appel d\'état ($) moyenne / max / lus', [+moy(ok1.map(x => x.separe.cout)).toFixed(5), Math.max(...ok1.map(x => x.separe.cout ?? 0)), ok1.filter(x => Number.isFinite(x.separe.cout)).length]);
    if (reference) {
        const comp = ok1.filter(x => refIdent.get(x.id) && refIdent.get(x.id).lu);
        d('  COMPARÉ À L\'IDENTIFICATION D\'AUJOURD\'HUI (même photo, sans titre) : état ESTIMÉ', bilanAccord(comp.map(x => ({ a: refIdent.get(x.id).estime, b: x.separe.estime }))));
        d('  idem, état RETENU', bilanAccord(comp.map(x => ({ a: refIdent.get(x.id).retenu, b: x.separe.retenu }))));
        d('  états retenus NULS : appel séparé / identification d\'aujourd\'hui', [comp.filter(x => !x.separe.retenu).length, comp.filter(x => !refIdent.get(x.id).retenu).length, 'sur ' + comp.length]);
    }
    if (variante || phase2.length === 0) {
        console.log(`\nVARIANTE « ${variante || 'aucune'} » : phase 2 non jouée.`);
        const e0 = carnet.etat();
        console.log(`DÉPENSE : ${e0.cumulUsd.toFixed(4)} $ sur plafond ${plafond} $ · ${e0.appels} appels (${e0.sansCout} sans coût lisible, comptés au pire connu)${e0.arret ? ' · ARRÊT : ' + e0.arret : ''}`);
        fs.writeFileSync(path.join(sortie, 'bilan.json'), JSON.stringify({ le: new Date().toISOString(), modele: MODELE, variante, plafond, depense: e0, phase1: phase1.map(x => ({ ...x, url: undefined })) }, null, 1));
        return;
    }
    console.log(`\n══ PHASE 2 : ${phase2.length} paires de scans (identification d'aujourd'hui sans titre + état, en parallèle)`);
    const ok2 = phase2.filter(x => x.ident.lu && !x.ident.erreur && !x.separe2.cause);           // les deux appels ont rendu une réponse exploitable (les autres sont comptés à part)
    console.log(`  paires écartées (appel en échec ou réponse illisible) : ${phase2.length - ok2.length}`);
    d('  état RETENU : appel séparé contre l\'identification d\'AUJOURD\'HUI sur la MÊME photo', bilanAccord(ok2.map(x => ({ a: x.ident.retenu, b: x.separe2.retenu }))));
    d('  état ESTIMÉ : appel séparé contre l\'identification d\'AUJOURD\'HUI sur la MÊME photo', bilanAccord(ok2.map(x => ({ a: x.ident.estime, b: x.separe2.estime }))));
    d('  BRUIT du modèle : l\'appel d\'état contre lui-même (phase 1 contre phase 2), état retenu', bilanAccord(ok2.map(x => ({ a: x.separe1.retenu, b: x.separe2.retenu }))));
    d('  BRUIT du modèle : état estimé', bilanAccord(ok2.map(x => ({ a: x.separe1.estime, b: x.separe2.estime }))));
    d('  durée (ms) p50 / p95 : identification seule (aujourd\'hui)', [pct(ok2.map(x => x.ident.ms), 0.5), pct(ok2.map(x => x.ident.ms), 0.95)]);
    d('  durée (ms) p50 / p95 : appel d\'état dans la paire', [pct(ok2.map(x => x.separe2.ms), 0.5), pct(ok2.map(x => x.separe2.ms), 0.95)]);
    d('  durée (ms) p50 / p95 : le plus lent des deux (= la durée d\'un scan, appels en parallèle)', [pct(ok2.map(x => x.murMs), 0.5), pct(ok2.map(x => x.murMs), 0.95)]);
    d('  paires où l\'appel d\'état est le plus lent', ok2.filter(x => x.separe2.ms > x.ident.ms).length + ' sur ' + ok2.length);
    const cI = moy(ok2.map(x => x.ident.cout)), cE = moy(ok2.map(x => x.separe2.cout));
    d('  coût par scan ($) : identification seule / + état / surcoût', [+cI.toFixed(5), +(cI + cE).toFixed(5), +cE.toFixed(5), 'soit +' + Math.round(100 * cE / cI) + ' %']);
    const e = carnet.etat();
    console.log(`\nDÉPENSE : ${e.cumulUsd.toFixed(4)} $ sur plafond ${plafond} $ · ${e.appels} appels (${e.sansCout} sans coût lisible, comptés au pire connu)${e.arret ? ' · ARRÊT : ' + e.arret : ''}`);
    fs.writeFileSync(path.join(sortie, 'bilan.json'), JSON.stringify({ le: new Date().toISOString(), modele: MODELE, plafond, depense: e, phase1: phase1.map(x => ({ ...x, url: undefined })), phase2 }, null, 1));
}
if (require.main === module) principal().catch(e => { console.error('❌', e.message); process.exit(1); });
