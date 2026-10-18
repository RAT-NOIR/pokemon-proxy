'use strict';
// LOT F1-TAMPON — mesure de la LECTURE du tampon STAFF sur les photos du banc, avec un PLAFOND DE DÉPENSE DUR (le carnet de TEMPS-CHAINE : coût réel lu chez le fournisseur, arrêt AVANT le plafond).
//   node v2/mesures/mesurer-lecture-tampon.js --sortie=<dossier> [--plafond=0.25] [--autres=20] [--graine=20261018] [--sec]
// Ce que ça FAIT : pour chaque scan étiqueté du banc dont la vérité est un produit d'une paire Staff / normale de l'archive (format 2), plus des cartes SANS tampon (les normales de ces paires, puis des cartes
// quelconques), la photo du bucket PRIVÉ du banc (V2_BANC_BUCKET, LECTURE SEULE, point d'accès UE fixé par le module du banc) passe par la lecture du tampon de production (deux essais, UNE question) ;
// jamais Vinted, jamais une URL d'annonce. Rendu PAR BANC (réglage figé / contrôle) : sûrs gagnés, FAUX (un « oui » sur une carte sans tampon), incertains, coût.
// Aucune écriture en base (rm_essai en lecture, MONGODB_ESSAI_LECTURE_URI), aucune écriture dans le bucket, aucune valeur secrète affichée (garde-secrets).
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..');
const MODELE = 'google/gemini-3-flash-preview';                                   // le modèle de la mesure TEMPS-CHAINE (celui de la chaîne)

// ── fonctions pures (jugées par v2/test/test-mesurer-lecture-tampon.js)
const memeEnsemble = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();
/** La nature d'un cas : 'staff' (la vérité est la version Staff d'une paire), 'normale' (la normale d'une paire), 'autre'. */
function natureDuCas(verite, paires) {
    for (const p of paires) { if (p.special === verite) return 'staff'; if (p.normale === verite) return 'normale'; }
    return 'autre';
}
/** Le bilan d'un banc. cas : [{ nature, lecture: 'oui'|'non'|'incertain'|'desaccord'|'echec'|'sans-image', declenchable }] */
function bilanDe(cas) {
    const n = x => cas.filter(x).length;
    const staff = cas.filter(c => c.nature === 'staff'), sans = cas.filter(c => c.nature !== 'staff');
    const faux = sans.filter(c => c.lecture === 'oui');
    return {
        cartes: cas.length, staff: staff.length, normales: n(c => c.nature === 'normale'), autres: n(c => c.nature === 'autre'),
        surs: staff.filter(c => c.lecture === 'oui' && c.declenchable).length,                       // gagnés : STAFF lu deux fois ET la question était exactement la paire
        stafLusHorsQuestion: staff.filter(c => c.lecture === 'oui' && !c.declenchable).length,
        staffNon: staff.filter(c => c.lecture === 'non').length,
        staffIncertains: staff.filter(c => ['incertain', 'desaccord'].includes(c.lecture)).length,
        staffEchecs: staff.filter(c => ['echec', 'sans-image'].includes(c.lecture)).length,
        faux: faux.length, fauxQuiAffirmeraient: faux.filter(c => c.declenchable).length,            // un « oui » sur une carte sans tampon dont la question est la paire = un FAUX AFFIRMÉ
        incertainsSansTampon: sans.filter(c => ['incertain', 'desaccord'].includes(c.lecture)).length
    };
}
module.exports = { natureDuCas, bilanDe, memeEnsemble, MODELE };

// ── l'exécution
function arg(nom, defaut) { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : defaut; }
async function principal() {
    require('C:/Users/Yung/rat-market-travail/api/atlas/garde-secrets');            // AVANT tout : aucune valeur du .env n'est jamais affichée
    const { ouvrir } = require('C:/Users/Yung/rat-market-travail/api/mesure-banc-reel/lib');
    const sortie = arg('sortie'); if (!sortie) throw new Error('--sortie=<dossier> est obligatoire');
    fs.mkdirSync(sortie, { recursive: true });
    const plafond = Number(arg('plafond', '0.25')); if (!(plafond > 0 && plafond <= 0.25)) throw new Error('plafond : entre 0 et 0,25 $ (le plafond du lot)');
    const nAutres = Number(arg('autres', '20')), graine = Number(arg('graine', '20261018'));
    const ARCHIVE = arg('archive', 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\archive-2026-10-18-format2.rmv');
    const cle = process.env.OPENROUTER_API_KEY; if (!cle) throw new Error('OPENROUTER_API_KEY absente du .env d\'api-v2');
    const axios = require(path.join(RACINE, 'node_modules', 'axios'));
    const S = require('../chargeur/scellement'), F = require('../chargeur/format');
    const LT = require('../identifier/lecture-tampon'), I = require('../identifier/seconde-lecture-image');
    const { creerCarnet } = require('./mesurer-temps-ia');
    const V = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(ARCHIVE), process.env.V2_VISUELS_HMAC)));

    // 1. les paires Staff / normale prouvées par l'archive
    const paires = [];
    for (const id of V.identifiants()) {
        const e = V.entree(id);
        if (!e || e.variante !== 'staff') continue;
        const autre = Array.isArray(e.produitsPartages) ? e.produitsPartages.find(x => x !== id) : null;
        const p = LT.paireSeparee({ ids: [id, autre], entree: x => V.entree(x) });
        if (p.ok && p.type === 'staff') paires.push(p);
    }
    console.log(`paires Staff / normale séparées dans l'archive : ${paires.length}`);

    // 2. les scans étiquetés du banc, avec leur photo (rm_essai, LECTURE)
    const { c, db } = await ouvrir();
    const CORR = require('C:/Users/Yung/rat-market-travail/api/mesure-banc-reel/corrections-etiquettes.json');
    const corr = new Map(CORR.corrections.map(x => [`${x.scanId}:${x.carte}`, x.nouveau]));
    const REGLAGE = new Set(require('C:/Users/Yung/rat-market-travail/api/langue-decisive/resultats-final.json').lignes.map(l => l.cle));
    const SOIR = new Date('2026-10-17T16:00:00Z');
    const A = await db.collection('analyses').find({ 'photoBanc.cle': { $type: 'string' } }, { projection: { cartes: 1, photoBanc: 1, creeLe: 1 } }).toArray();
    const lignes = [];
    for (const a of A) {
        if (a.cartes.length !== 1) continue;                                       // une photo = une carte (les lots partagent la photo)
        const k = a.cartes[0], e = k.etiquetteAdmin || null;
        const cleCarte = `${String(a._id)}:0`;
        let verite = e ? (e.idProduct ?? null) : null;
        if (corr.has(cleCarte)) verite = corr.get(cleCarte);
        if (!Number.isInteger(verite)) continue;
        const banc = REGLAGE.has(cleCarte) ? 'reglage' : (e && e.le && new Date(e.le) >= SOIR) ? 'controle' : 'hors-banc';
        const choix = (k.question && Array.isArray(k.question.choix) ? k.question.choix : []).map(x => (x && typeof x === 'object') ? x.idProduct : x).filter(Number.isInteger);
        const nature = natureDuCas(verite, paires);
        const paire = paires.find(p => p.special === verite || p.normale === verite);
        lignes.push({ cle: cleCarte, banc, verite, nature, cleR2: a.photoBanc.cle, declenchable: Boolean(paire) && memeEnsemble(choix, [paire.special, paire.normale]), choix });
    }
    // 3. les cas : TOUTES les paires Staff / normale du banc, puis des cartes sans tampon en nombre fixé (tirage reproductible)
    let g = graine; const alea = () => { g = (g * 1664525 + 1013904223) % 4294967296; return g / 4294967296; };
    const autres = lignes.filter(l => l.nature === 'autre').map(l => ({ l, r: alea() })).sort((x, y) => x.r - y.r).slice(0, nAutres).map(x => x.l);
    const cas = [...lignes.filter(l => l.nature !== 'autre'), ...autres];
    console.log(`scans étiquetés avec photo : ${lignes.length} · cas lus : ${cas.length} (staff ${cas.filter(x => x.nature === 'staff').length}, normales ${cas.filter(x => x.nature === 'normale').length}, autres ${cas.filter(x => x.nature === 'autre').length}) · plafond ${plafond} $`);
    if (!cas.some(x => x.nature === 'staff')) { console.log('⛔ AUCUNE photo de scan Staff dans le bucket du banc : ce point de la mesure s\'ARRÊTE ici.'); await c.close(); return; }

    // 4. les photos (bucket PRIVÉ du banc, lecture seule) et la lecture
    // Le bucket du banc de l'ESSAI (rm-essai-banc, UE) se lit avec SA clé de LECTURE (R2_ESSAI_BANC_LECTURE_*), posée dans CE processus seulement ; le module du banc fixe le point d'accès UE (verifierBucket).
    // Jamais une écriture : seul `lire` est appelé. Si le module du banc refuse ce bucket (garde de nom), la lecture passe par le client R2 sous la même vérification du point d'accès.
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
    const carnet = creerCarnet({ fichier: path.join(sortie, 'depense.json'), plafondUsd: plafond });
    const lecteur0 = I.creerLecteurTampon({ post: axios.post.bind(axios), modele: MODELE, cle, surUsage: u => carnet.compter(u && Number.isFinite(u.cost) ? u.cost : null) });
    const lecteur = async (bande, o) => {
        if (!carnet.peutAppeler()) throw Object.assign(new Error('plafond'), { code: 'PLAFOND' });
        try { return await lecteur0(bande, o); } catch (e) { if (e && e.code !== 'PLAFOND') carnet.compter(null); throw e; }       // un appel qui échoue a coûté quand même (au pire connu)
    };
    const fournisseur = LT.creerFournisseur({ preparer: I.creerPreparateurTampon(), lecteur });
    const fichierRes = path.join(sortie, 'lectures.jsonl');
    const rendu = [];
    for (const x of cas) {
        if (carnet.etat().arret) { console.log(`⛔ ARRÊT AVANT DÉPASSEMENT : ${carnet.etat().arret}`); break; }
        let photo = null, lecture = 'echec', essais = [];
        try { photo = await st.lire(x.cleR2); } catch { /* photo absente du bucket */ }
        if (!photo) lecture = 'sans-image';
        else {
            const carte = await require(path.join(RACINE, 'node_modules', 'sharp'))(photo).resize(420, 587, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();     // la carte redressée de MODELE-VISUEL-API : JPEG 420 × 587
            const r = await fournisseur({ image: carte, corps: {}, compteur: { appels: 0 }, signal: undefined });
            lecture = r.sansImage ? 'sans-image' : r.echec ? 'echec' : r.lecture; essais = r.essais;
        }
        rendu.push({ ...x, lecture, essais });
        fs.appendFileSync(fichierRes, JSON.stringify({ cle: x.cle, banc: x.banc, nature: x.nature, verite: x.verite, declenchable: x.declenchable, lecture, essais }) + '\n');
    }
    const e = carnet.etat();
    // 5. le rendu, PAR BANC
    for (const banc of ['controle', 'reglage', 'hors-banc']) {
        const b = bilanDe(rendu.filter(x => x.banc === banc));
        console.log(`\n## ${banc} : ${b.cartes} cartes lues (staff ${b.staff}, normales ${b.normales}, autres ${b.autres})`);
        console.log(`  sûrs GAGNÉS (STAFF lu deux fois, question = la paire) : ${b.surs} sur ${b.staff} staff · lus hors question : ${b.stafLusHorsQuestion} · « non » : ${b.staffNon} · incertains/désaccords : ${b.staffIncertains} · échecs/sans image : ${b.staffEchecs}`);
        console.log(`  FAUX (un « oui » sur une carte SANS tampon) : ${b.faux} (dont ${b.fauxQuiAffirmeraient} affirmeraient un produit Staff) · incertains sur cartes sans tampon : ${b.incertainsSansTampon}`);
    }
    console.log(`\nDÉPENSE : ${e.cumulUsd.toFixed(4)} $ sur plafond ${plafond} $ · ${e.appels} appels (${e.sansCout} sans coût lisible, comptés au pire connu)${e.arret ? ' · ARRÊT : ' + e.arret : ''}`);
    fs.writeFileSync(path.join(sortie, 'bilan.json'), JSON.stringify({ le: new Date().toISOString(), modele: MODELE, plafond, depense: e, bancs: Object.fromEntries(['controle', 'reglage', 'hors-banc'].map(b => [b, bilanDe(rendu.filter(x => x.banc === b))])) }, null, 1));
    await c.close();
}
// LOT TAMPONS : l'EXÉCUTION de cette mesure est RETIRÉE. Elle lisait la réponse « oui » d'un lecteur STAFF seul ; le lecteur rend désormais des ENSEMBLES de marques (lecture « marques »), et `bilanDe` comptait
// les « oui » : lancée telle quelle elle aurait compté ZÉRO faux sans avoir rien mesuré (une sonde qui lit autre chose que la production). Les fonctions pures ci-dessus restent (banc test-mesurer-lecture-tampon.js) ;
// la mesure vit dans mesurer-marques-tampon.js.
if (require.main === module) { console.error('RETIRÉ : la mesure de la lecture du tampon est v2/mesures/mesurer-marques-tampon.js (lecteur de MARQUES)'); void principal; process.exit(1); }
