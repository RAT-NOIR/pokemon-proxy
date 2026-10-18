'use strict';
// LOT TAMPONS (C) — mesure de la LECTURE DES MARQUES sur les 40 cartes vérifiées à la main par le testeur (relevé du 2026-10-18), avec leurs photos du banc (bucket PRIVÉ `rm-essai-banc`, clé de LECTURE, jamais Vinted),
// et sur des cartes SANS tampon (les mêmes que la mesure de F1-TAMPON) pour compter les faux positifs. Plafond de dépense DUR (le carnet de TEMPS-CHAINE : coût réel lu chez le fournisseur, arrêt AVANT le plafond).
//   node v2/mesures/mesurer-marques-tampon.js --sortie=<dossier> [--plafond=0.35] [--releve=<controle-tampons.json>] [--sans-tampon=<lectures.jsonl de F1>]
// Ces 40 cartes sont des cartes du CONTRÔLE : elles ne servent JAMAIS à régler (la consigne du modèle est figée dans seconde-lecture-image.js, écrite AVANT cette mesure).
// Aucune écriture en base (rm_essai en lecture, MONGODB_ESSAI_LECTURE_URI), aucune écriture dans le bucket, aucune valeur secrète affichée (garde-secrets).
//
// 🔑 CE QUE LE RAPPORT DISTINGUE, PARCE QUE L'ARCHIVE N'EST PAS ENCORE ÉCRITE PAR LE CATALOGUE :
//   · la LECTURE (détecté / type lu comparé au relevé) ne dépend d'aucune archive : elle est mesurée telle quelle ;
//   · l'ISSUE de la chaîne se SIMULE sur la question RÉELLE posée par la chaîne à l'essai (`question.choix`) : la règle ne se déclenche que si cette question est EXACTEMENT deux produits dont le bon ; le produit
//     tamponné porte alors le jeton du relevé et son voisin `normale` (la forme que le catalogue prépare). Une « jointure » inventée n'est jamais comptée comme un gain ;
//   · le FAUX se compte au PIRE CAS : un ensemble lu en consensus qui n'est PAS celui du relevé (ou un ensemble non vide sur une carte sans tampon) serait un faux dès qu'un produit voisin porterait cet ensemble
//     comme variante prouvée. 0 faux exigé : un seul, et la règle reste éteinte.
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..');
const MODELE = 'google/gemini-3-flash-preview';                                   // le modèle de la chaîne (index.js : MODELE_IA), comme F1-TAMPON

// ── fonctions pures (jugées par v2/test/test-mesurer-marques-tampon.js)
// Le type du relevé du testeur -> ce qu'on en attend. `exact` : l'ensemble complet quand le relevé le dit en entier ; `minimum` : ce qui doit au moins se lire quand le relevé dit « + Autre » ; `autre` : le relevé
// nomme une marque qu'il ne détaille pas (« Autre »), donc l'ensemble exact est INCONNU (jamais déduit du titre de l'annonce).
const TYPES = Object.freeze({
    'Staff': { exact: ['staff'] }, 'Prerelease': { exact: ['prerelease'] }, 'League': { exact: ['league'] }, 'Championship': { exact: ['championship'] },
    'Staff + Prerelease': { exact: ['staff', 'prerelease'] }, 'Staff + Championship': { exact: ['staff', 'championship'] }, 'Prize Pack (Play! Pokémon)': { exact: ['play-pokemon'] },
    'Staff + Autre': { exact: null, minimum: ['staff'], autre: true }, 'Autre': { exact: null, minimum: [], autre: true }
});
function typeDuReleve(texte) { return Object.prototype.hasOwnProperty.call(TYPES, texte) ? TYPES[texte] : null; }
const memeEnsemble = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort().join('+') === [...b].sort().join('+');

/**
 * Le type lu, comparé au relevé. @param attendu typeDuReleve(...) @param lecture le résultat du fournisseur { lecture, marques, essais }
 * @returns 'juste' | 'sous-ensemble' | 'autre-ensemble' | 'non-lu' | 'conforme-autre' | 'a-juger' | 'sans-relevé'
 *   juste : l'ensemble lu en consensus est exactement celui du relevé ; sous-ensemble / autre-ensemble : un ensemble lu en consensus qui n'est pas lui (UN FAUX AU PIRE CAS) ;
 *   non-lu : aucun consensus sur des marques (aucune, autre, incertain, désaccord, échec) ; pour un relevé « Autre » : conforme-autre = `autre` lu (la question), a-juger = des marques lues en consensus, à regarder.
 */
function comparerType(attendu, lecture) {
    if (!attendu) return 'sans-relevé';
    const lu = lecture && lecture.lecture === 'marques' ? lecture.marques : null;
    if (attendu.exact) {
        if (!lu) return 'non-lu';
        if (memeEnsemble(lu, attendu.exact)) return 'juste';
        return lu.every(m => attendu.exact.includes(m)) ? 'sous-ensemble' : 'autre-ensemble';
    }
    if (lu) return lu.length && attendu.minimum.every(m => lu.includes(m)) ? 'a-juger' : 'autre-ensemble';        // un relevé « Autre » ne dit pas l'ensemble : on regarde, on ne tranche pas d'ici
    return lecture && lecture.lecture === 'autre' ? 'conforme-autre' : 'non-lu';
}
/** La carte porte-t-elle un tampon vu ? vu = le premier essai a lu quelque chose (une marque ou `autre`) ; consensus = deux essais concordants sur des marques ou `autre`. */
function detection(lecture) {
    const e = lecture && Array.isArray(lecture.essais) ? lecture.essais : [];
    const premier = e[0];
    const vu = Boolean(premier && premier !== 'incertain' && (premier.autre === true || (premier.marques && premier.marques.length)));
    const consensus = Boolean(lecture && (lecture.lecture === 'marques' || lecture.lecture === 'autre'));
    return { vu, consensus };
}
/**
 * L'issue de la chaîne avec la nouvelle règle, SIMULÉE sur la question réelle de l'essai.
 * @param c { statut: 'a-trancher'|'identifiee'|'introuvable'|…, choix: number[]|null, verite: number, identifie: number|null, attendu, lecture }
 * @returns { issue: 'sur-juste-chaine'|'sur-juste-regle'|'propose'|'question-sans-la-bonne-carte'|'faux-chaine', declenchable: boolean, regle: boolean }
 *   La règle n'est consultée que pour une QUESTION de deux produits dont le bon ET dont le relevé donne l'ensemble complet ; elle affirme alors le produit tamponné SEULEMENT si l'ensemble lu en consensus est le sien.
 */
function issueDeLaChaine(c) {
    if (c.statut === 'identifiee') return { issue: c.identifie === c.verite ? 'sur-juste-chaine' : 'faux-chaine', declenchable: false, regle: false };
    if (!Array.isArray(c.choix) || !c.choix.includes(c.verite)) return { issue: 'question-sans-la-bonne-carte', declenchable: false, regle: false };
    const declenchable = c.choix.length === 2 && Boolean(c.attendu && c.attendu.exact);
    const regle = declenchable && c.lecture && c.lecture.lecture === 'marques' && memeEnsemble(c.lecture.marques, c.attendu.exact);
    return { issue: regle ? 'sur-juste-regle' : 'propose', declenchable, regle: Boolean(regle) };
}
/** Le FAUX au pire cas d'une carte AVEC tampon : un consensus de marques qui n'est pas l'ensemble du relevé (quand le relevé le donne en entier). */
const fauxAvecTampon = (attendu, lecture) => ['sous-ensemble', 'autre-ensemble'].includes(comparerType(attendu, lecture));
/** Le FAUX POSITIF d'une carte SANS tampon : un consensus NON VIDE de marques (affirmerait un produit tamponné voisin). `autre`, incertain, rien lu : une question, pas un faux. */
const fauxPositif = lecture => Boolean(lecture && lecture.lecture === 'marques' && Array.isArray(lecture.marques) && lecture.marques.length);

/** Le bilan des cartes du relevé. rendus : [{ verite, type, attendu, lecture, issue, aPart }] */
function bilanReleve(rendus) {
    const n = f => rendus.filter(f).length;
    const normaux = rendus.filter(x => !x.aPart), exacts = normaux.filter(x => x.attendu && x.attendu.exact), autres = normaux.filter(x => x.attendu && !x.attendu.exact);
    return {
        cartes: rendus.length, aPart: n(x => x.aPart), evaluees: normaux.length,
        detectes: { vu: normaux.filter(x => detection(x.lecture).vu).length, consensus: normaux.filter(x => detection(x.lecture).consensus).length },
        typesExacts: { cartes: exacts.length, justes: exacts.filter(x => comparerType(x.attendu, x.lecture) === 'juste').length, nonLus: exacts.filter(x => comparerType(x.attendu, x.lecture) === 'non-lu').length, sousEnsemble: exacts.filter(x => comparerType(x.attendu, x.lecture) === 'sous-ensemble').length, autreEnsemble: exacts.filter(x => comparerType(x.attendu, x.lecture) === 'autre-ensemble').length },
        typesAutre: { cartes: autres.length, conformes: autres.filter(x => comparerType(x.attendu, x.lecture) === 'conforme-autre').length, aJuger: autres.filter(x => comparerType(x.attendu, x.lecture) === 'a-juger').length, nonLus: autres.filter(x => comparerType(x.attendu, x.lecture) === 'non-lu').length, autreEnsemble: autres.filter(x => comparerType(x.attendu, x.lecture) === 'autre-ensemble').length },
        issues: { surJusteChaine: normaux.filter(x => x.issue.issue === 'sur-juste-chaine').length, surJusteRegle: normaux.filter(x => x.issue.issue === 'sur-juste-regle').length, proposes: normaux.filter(x => x.issue.issue === 'propose').length, questionsSansLaBonneCarte: normaux.filter(x => x.issue.issue === 'question-sans-la-bonne-carte').length, fauxChaine: normaux.filter(x => x.issue.issue === 'faux-chaine').length },
        declenchables: normaux.filter(x => x.issue.declenchable).length,
        fauxPireCas: normaux.filter(x => fauxAvecTampon(x.attendu, x.lecture)).length
    };
}
module.exports = { TYPES, typeDuReleve, memeEnsemble, comparerType, detection, issueDeLaChaine, fauxAvecTampon, fauxPositif, bilanReleve, MODELE };

// ── l'exécution
function arg(nom, defaut) { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : defaut; }
async function principal() {
    require('C:/Users/Yung/rat-market-travail/api/atlas/garde-secrets');            // AVANT tout : aucune valeur du .env n'est jamais affichée
    const { ouvrir } = require('C:/Users/Yung/rat-market-travail/api/mesure-banc-reel/lib');
    const sortie = arg('sortie'); if (!sortie) throw new Error('--sortie=<dossier> est obligatoire');
    fs.mkdirSync(sortie, { recursive: true });
    const plafond = Number(arg('plafond', '0.35')); if (!(plafond > 0 && plafond <= 0.35)) throw new Error('plafond : entre 0 et 0,35 $ (le plafond du lot)');
    const RELEVE = require(arg('releve', 'C:/Users/Yung/rat-market-travail/api/tampons/controle-tampons-2026-10-18.json'));
    const SANS = arg('sans-tampon', 'C:/Users/Yung/rat-market-travail/api/f1/relecture/sortie-420/lectures.jsonl');
    const cle = process.env.OPENROUTER_API_KEY; if (!cle) throw new Error('OPENROUTER_API_KEY absente du .env d\'api-v2');
    const axios = require(path.join(RACINE, 'node_modules', 'axios')), sharp = require(path.join(RACINE, 'node_modules', 'sharp'));
    const { ObjectId } = require(path.join(RACINE, 'node_modules', 'mongodb'));
    const LT = require('../identifier/lecture-tampon'), I = require('../identifier/seconde-lecture-image');
    const { creerCarnet } = require('./mesurer-temps-ia');
    const CONFLITS = new Set([877546, 884752]);                                    // « normale » dans l'archive, tamponnées d'après le relevé : issue À PART

    // 1. les cartes du relevé (un scan par carte : le premier), leurs analyses (rm_essai, LECTURE) et les cartes sans tampon de F1
    const { c, db } = await ouvrir();
    // --max-releve / --max-sans : un PILOTE de quelques cartes avant la mesure entière (jamais pour rendre un bilan)
    const lignes = RELEVE.lignes.filter(l => l.scans && l.scans.length).slice(0, Number(arg('max-releve', '1000')));
    const sansTampon = fs.readFileSync(SANS, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).filter(x => x.nature === 'autre' && !RELEVE.lignes.some(l => l.idProduct === x.verite)).slice(0, Number(arg('max-sans', '1000')));
    const scanIds = [...lignes.map(l => l.scans[0].scanId), ...sansTampon.map(x => x.cle.split(':')[0])];
    const A = await db.collection('analyses').find({ _id: { $in: scanIds.map(i => new ObjectId(i)) } }, { projection: { cartes: 1, photoBanc: 1 } }).toArray();
    const parId = new Map(A.map(a => [String(a._id), a]));
    console.log(`cartes du relevé : ${lignes.length} (analyses lues ${lignes.filter(l => parId.has(l.scans[0].scanId)).length}) · cartes sans tampon : ${sansTampon.length} (analyses lues ${sansTampon.filter(x => parId.has(x.cle.split(':')[0])).length}) · plafond ${plafond} $`);

    // 2. les photos (bucket PRIVÉ du banc, lecture seule) : le module du banc fixe le point d'accès UE ; jamais une écriture
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

    // 3. la lecture, sous le carnet de dépense (coût lu sur CHAQUE appel ; un appel qui échoue a coûté quand même, au pire connu)
    const carnet = creerCarnet({ fichier: path.join(sortie, 'depense.json'), plafondUsd: plafond });
    const lecteur0 = I.creerLecteurTampon({ post: axios.post.bind(axios), modele: MODELE, cle, surUsage: u => carnet.compter(u && Number.isFinite(u.cost) ? u.cost : null) });
    const lecteur = async (bande, o) => {
        if (!carnet.peutAppeler()) throw Object.assign(new Error('plafond'), { code: 'PLAFOND' });
        try { return await lecteur0(bande, o); } catch (e) { if (e && e.code !== 'PLAFOND') carnet.compter(null); throw e; }
    };
    const fournisseur = LT.creerFournisseur({ preparer: I.creerPreparateurTampon(), lecteur });
    const lire = async scanId => {
        const a = parId.get(scanId); const cleR2 = a && a.photoBanc && a.photoBanc.cle;
        if (!cleR2) return { lecture: 'incertain', marques: [], essais: [], echec: false, sansImage: true };
        let photo = null; try { photo = await st.lire(cleR2); } catch { /* absente du bucket */ }
        if (!photo) return { lecture: 'incertain', marques: [], essais: [], echec: false, sansImage: true };
        const carte = await sharp(photo).resize(420, 587, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();           // la carte redressée de MODELE-VISUEL-API : JPEG 420 × 587
        return fournisseur({ image: carte, corps: {}, compteur: { appels: 0 }, signal: undefined });
    };
    const fichierRes = path.join(sortie, 'cartes.jsonl'); fs.writeFileSync(fichierRes, '');
    const rendus = [], faux = [];
    let arret = null;
    for (const l of lignes) {
        if (carnet.etat().arret) { arret = carnet.etat().arret; break; }
        const scanId = l.scans[0].scanId, a = parId.get(scanId), k = a && a.cartes && a.cartes[0];
        const choix = k && k.question && Array.isArray(k.question.choix) ? k.question.choix.map(x => (x && typeof x === 'object') ? x.idProduct : x).filter(Number.isInteger) : null;
        const attendu = typeDuReleve(l.stamp), lecture = await lire(scanId);
        const issue = issueDeLaChaine({ statut: k && k.statut, choix, verite: l.idProduct, identifie: k && Number.isInteger(k.idProduct) ? k.idProduct : null, attendu, lecture });
        const aPart = CONFLITS.has(l.idProduct) ? 'conflit-archive-normale' : l.veriteEnDoute ? 'verite-en-doute' : null;
        const r = { verite: l.idProduct, type: l.stamp, attendu, scanId, statut: k && k.statut, choix, lecture, issue, aPart };
        rendus.push(r);
        fs.appendFileSync(fichierRes, JSON.stringify({ groupe: 'releve', verite: l.idProduct, type: l.stamp, statutChaine: r.statut, choix, lecture: lecture.lecture, marques: lecture.marques, essais: lecture.essais, comparaison: comparerType(attendu, lecture), issue: issue.issue, declenchable: issue.declenchable, aPart }) + '\n');
    }
    for (const x of sansTampon) {
        if (arret || carnet.etat().arret) { arret = arret || carnet.etat().arret; break; }
        const scanId = x.cle.split(':')[0], lecture = await lire(scanId);
        const fp = fauxPositif(lecture); if (fp) faux.push({ scanId, verite: x.verite, marques: lecture.marques });
        fs.appendFileSync(fichierRes, JSON.stringify({ groupe: 'sans-tampon', verite: x.verite, scanId, lecture: lecture.lecture, marques: lecture.marques, essais: lecture.essais, fauxPositif: fp }) + '\n');
    }
    const e = carnet.etat();

    // 4. le rendu
    const lusSans = fs.readFileSync(fichierRes, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).filter(x => x.groupe === 'sans-tampon');
    const b = bilanReleve(rendus);
    console.log(`\n## RELEVÉ : ${b.cartes} cartes lues (${b.aPart} À PART : conflits d'archive et vérité en doute), ${b.evaluees} évaluées`);
    console.log(`  détectées : consensus ${b.detectes.consensus}/${b.evaluees} (marques ou « autre » lus deux fois), vues au premier essai ${b.detectes.vu}/${b.evaluees}`);
    console.log(`  relevé à ensemble COMPLET : justes ${b.typesExacts.justes}/${b.typesExacts.cartes} · non lus ${b.typesExacts.nonLus} · sous-ensemble ${b.typesExacts.sousEnsemble} · autre ensemble ${b.typesExacts.autreEnsemble}`);
    console.log(`  relevé « Autre » : « autre » lu ${b.typesAutre.conformes} · marques lues à juger ${b.typesAutre.aJuger} · non lus ${b.typesAutre.nonLus} · hors minimum ${b.typesAutre.autreEnsemble} (sur ${b.typesAutre.cartes})`);
    console.log(`  issue de la chaîne (question réelle de l'essai + règle) : sûrs justes ${b.issues.surJusteChaine + b.issues.surJusteRegle} (chaîne ${b.issues.surJusteChaine}, GAGNÉS PAR LA RÈGLE ${b.issues.surJusteRegle}) · proposés ${b.issues.proposes} · questions sans la bonne carte ${b.issues.questionsSansLaBonneCarte} · faux de la chaîne ${b.issues.fauxChaine} · règle déclenchable ${b.declenchables}`);
    console.log(`  FAUX au pire cas (consensus qui n'est pas l'ensemble du relevé) : ${b.fauxPireCas}`);
    for (const r of rendus.filter(x => x.aPart || fauxAvecTampon(x.attendu, x.lecture) || comparerType(x.attendu, x.lecture) === 'a-juger')) console.log(`    · ${r.verite} (${r.type})${r.aPart ? ` [À PART ${r.aPart}]` : ''} : lecture ${r.lecture.lecture} ${JSON.stringify(r.lecture.marques)} · ${comparerType(r.attendu, r.lecture)}`);
    console.log(`\n## SANS TAMPON : ${lusSans.length} cartes lues sur ${sansTampon.length} · FAUX POSITIFS (consensus non vide de marques) : ${lusSans.filter(x => x.fauxPositif).length} · « autre » lu : ${lusSans.filter(x => x.lecture === 'autre').length} · aucune marque : ${lusSans.filter(x => x.lecture === 'aucune').length} · incertain / désaccord : ${lusSans.filter(x => ['incertain', 'desaccord'].includes(x.lecture)).length}`);
    for (const f of faux) console.log(`    · FAUX POSITIF ${f.verite} (scan ${f.scanId}) : ${JSON.stringify(f.marques)}`);
    console.log(`\nDÉPENSE : ${e.cumulUsd.toFixed(4)} $ sur plafond ${plafond} $ · ${e.appels} appels (${e.sansCout} sans coût lisible, comptés au pire connu)${arret || e.arret ? ' · ARRÊT : ' + (arret || e.arret) : ''}`);
    fs.writeFileSync(path.join(sortie, 'bilan.json'), JSON.stringify({ le: new Date().toISOString(), modele: MODELE, plafond, depense: e, releve: b, sansTampon: { lues: lusSans.length, sur: sansTampon.length, fauxPositifs: faux } }, null, 1));
    await c.close();
}
if (require.main === module) principal().catch(e => { console.error('❌', (e && (e.code || e.name)) || 'erreur', String((e && e.message) || '').slice(0, 200)); process.exit(1); });
