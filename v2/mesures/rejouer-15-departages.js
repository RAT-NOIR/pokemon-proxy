'use strict';
// REJEU DES 15 SCANS TRANCHÉS PAR L'IMAGE (journal rm_essai, 14-15/10, imageStatut « departage ») — lot COUPURE (ORB-HÉRITÉ-OFF). Outil LOCAL : il ne figure pas dans lancer-tout.
//   node v2/mesures/rejouer-15-departages.js --bras=avant|apres-simule|apres --instantane=<dossier> --lignes=<lignes.json> --verites=<bancs-lignes.json> [--sortie=<fichier.json>]
//
// CE QUE C'EST : la VRAIE route v2 (`traiterIdentifier`) et la VRAIE chaîne héritée (`gererIdentifier`), sur un mongod EN MÉMOIRE chargé depuis un instantané du catalogue (SANS references_image : voir plus bas).
// ZÉRO $ : le modèle n'est JAMAIS appelé. `axios.post` est remplacé : la lecture rendue au modèle est RECONSTRUITE depuis la ligne du journal (nom, nomBrut, numéro, total, setCode, symbole,
//   rareté, attaque, illustrateur, état, langue…) — la lecture exacte qui a nourri la chaîne le 14-15/10. Aucun autre appel sortant : la garde réseau ferme tout hôte (TCGdex, Cardmarket, Vinted compris).
// LE DÉPARTAGE PAR L'IMAGE n'est pas rejoué sur des pixels (les photos brutes des scans ne sont pas toutes disponibles localement : voir le rapport) ; il est REMPLACÉ, AVANT le chargement d'index.js
//   (qui déstructure `departager` à l'import), par une fonction qui rend ce que le journal dit qu'il a rendu (bras avant) ou qui LÈVE si elle est appelée (bras apres : la preuve que la coupure tient).
//   · avant        : l'avis du journal (gagnant, inliers) — c'est ce que la production a vécu.
//   · apres-simule : aucun avis (« non-calcule »), sans le code de la Partie A — la même conséquence, obtenue par le remplaçant (sert avant que la coupure existe).
//   · apres        : le code de la Partie A, RM_API_V2=1 + V2_ORB_SERVEUR=0 posés après le chargement d'index.js ; le remplaçant LÈVE s'il est appelé.
// GARDES : MONGODB_URI et toute URI mongodb hors boucle locale refusent le démarrage (verifierEnvironnement) ; aucune écriture ailleurs que dans le mongod jetable.
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..');
const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };

/** La lecture que le modèle aurait rendue, reconstruite depuis la ligne du journal. Pure. */
function lectureDepuisLigne(l) {
    return {
        name: l.nom, nomBrut: l.nomBrut ?? null, nomConfiance: l.nomConfiance ?? 'moyenne',
        attaqueBrute: l.attaqueBrute ?? null, attaque: l.attaqueLue ?? null, attaqueConfiance: l.attaqueConfiance ?? null,
        illustrateur: l.illustrateur ?? null, illustrateurConfiance: l.illustrateurConfiance ?? null,
        number: l.numero ?? null, total: l.total ?? null, setCode: l.setCode ?? null, symboleSet: l.symboleSet ?? null,
        rarete: l.rarete ?? null, reverse: l.reverseLu === true ? true : l.reverseLu === false ? false : null, motif: l.motifIA ?? 'indetermine',
        language: l.langue ?? 'EN',
        etatEstime: l.etatEstimeIA ?? null, etatConfiance: l.etatConfianceIA ?? null, defautsVus: Array.isArray(l.defautsVus) ? l.defautsVus : []
    };
}
/** L'avis d'image du journal, dans la forme de departager(). Pure. */
function avisDuJournal(l) {
    const champs = {
        imageStatut: l.imageStatut, imageMotif: l.imageMotif ?? null, imageGagnant: l.imageGagnant ?? null, imageInliers: l.imageInliers ?? null, imageInliersSecond: l.imageInliersSecond ?? null,
        imageRangDuGagnantScoring: l.imageRangDuGagnantScoring ?? null, imageCandidatsAvecVecteur: l.imageCandidatsAvecVecteur ?? null, imageCandidatsGroupe: l.imageCandidatsGroupe ?? null, imagePoints: l.imagePoints ?? 150, imageMs: l.imageMs ?? null
    };
    return { departage: l.imageStatut === 'departage', gagnant: l.imageGagnant ?? null, champs };
}

async function chargerSansReferences(dossier, bases, readline, EJSON) {
    const manifeste = JSON.parse(fs.readFileSync(path.join(dossier, 'manifeste.json'), 'utf8'));
    for (const c of manifeste.collections) {
        if (c.nom === 'references_image') { console.log(`  ignoré  ${c.nom} (le départage par l'image est rejoué depuis le journal)`); continue; }
        const coll = bases[c.base].collection(c.nom);
        const rl = readline.createInterface({ input: fs.createReadStream(path.join(dossier, `${c.base}.${c.nom}.ejson`)), crlfDelay: Infinity });
        let lot = [], n = 0;
        for await (const ligne of rl) { if (!ligne) continue; lot.push(EJSON.parse(ligne, { relaxed: false })); n++; if (lot.length >= 1000) { await coll.insertMany(lot, { ordered: false }); lot = []; } }
        if (lot.length) await coll.insertMany(lot, { ordered: false });
        const index = JSON.parse(fs.readFileSync(path.join(dossier, `${c.base}.${c.nom}.indexes.json`), 'utf8'));
        for (const i of index) { if (i.expireAfterSeconds !== undefined) continue; const { key, name, ...opts } = i; try { await coll.createIndex(key, { name, ...opts }); } catch { /* index facultatif */ } }
        console.log(`  chargé ${(c.base + '.' + c.nom).padEnd(34)} ${String(n).padStart(8)} documents`);
        if (n !== c.documents) throw new Error(`instantané incomplet : ${c.nom} ${n}/${c.documents}`);
    }
    return manifeste;
}

async function principal() {
    const bras = arg('bras');
    if (!['avant', 'apres-simule', 'apres'].includes(bras)) throw new Error('--bras=avant|apres-simule|apres');
    const dossierInstantane = arg('instantane'), fLignes = arg('lignes'), fVerites = arg('verites');
    if (!dossierInstantane || !fLignes || !fVerites) throw new Error('--instantane, --lignes et --verites sont obligatoires');
    const sortie = arg('sortie');
    const { verifierEnvironnement, juger, sommaire } = require('./mesurer-identification');
    verifierEnvironnement(process.env);
    const lignesJournal = JSON.parse(fs.readFileSync(fLignes, 'utf8'));
    const verites = new Map(JSON.parse(fs.readFileSync(fVerites, 'utf8')).filter(x => x.famille === 'reglage').map(x => [x.scan, x.verite]));

    // le dossier de travail SANS .env : le dotenv d'index.js ne remettra aucune variable
    const neutre = path.join(require('os').tmpdir(), 'rejeu15-cwd-neutre'); fs.mkdirSync(neutre, { recursive: true });
    if (fs.existsSync(path.join(neutre, '.env'))) throw new Error('cwd-neutre contient un .env');
    process.chdir(neutre);
    process.env.OPENROUTER_API_KEY = 'cle-factice-rejeu';                                        // jamais une vraie clé : le modèle n'est pas appelé

    const { ouvrirBanc, installerGardeEcriture } = require('../../collecte-cartes/base-banc');
    const { hotesDe } = require('../../collecte-cartes/garde-banc');
    const banc = await ouvrirBanc();
    if (banc.origine !== 'memoire') throw new Error('la base du banc n\'est pas un mongod en mémoire');
    const { installerGardeReseau } = require('./garde-reseau');
    const garde = installerGardeReseau({});
    process.on('uncaughtException', e => { if (e && e.code === 'GARDE-RESEAU') console.error(`⚠️ [garde] ${e.message}`); else { console.error('❌', e); process.exit(1); } });
    process.on('unhandledRejection', e => { if (e && e.code === 'GARDE-RESEAU') console.error(`⚠️ [garde] ${e.message}`); else { console.error('❌', e); process.exit(1); } });

    const resultats = [];
    try {
        const mongoose = require('mongoose'); mongoose.set('strictQuery', false);
        const hotes = hotesDe(banc.uri).join(',');
        process.env.BANC_ISOLE = '1'; process.env.BANC_HOTES = hotes;
        process.env.MONGODB_CARTES_URI = banc.uri; process.env.MONGODB_CARTES_BASE = 'cartes';
        verifierEnvironnement(process.env);
        await mongoose.connect(banc.uri, { dbName: 'mesure_rejeu15' });
        installerGardeEcriture(mongoose.Collection, process.env);
        const dbPrincipale = mongoose.connection.db, dbCartes = mongoose.connection.getClient().db('cartes');
        const readline = require('readline'); const { EJSON } = require('bson');
        console.log(`CHARGEMENT de l'instantané ${dossierInstantane}`);
        const manifeste = await chargerSansReferences(dossierInstantane, { test: dbPrincipale, cartes: dbCartes }, readline, EJSON);
        const jugement = JSON.parse(fs.readFileSync(path.join(dossierInstantane, 'jugement.json'), 'utf8'));
        const lignesCP = new Map(); for (const l of jugement) (lignesCP.get(l.idProduct) || lignesCP.set(l.idProduct, []).get(l.idProduct)).push(l);

        // 1. le remplaçant du départage par l'image, AVANT le chargement d'index.js (il déstructure `departager` à l'import)
        const DI = require('../../departage-image');
        let courantJournal = null; const appelsDepartage = []; const poolsRejoues = new Map();
        DI.departager = async (a) => {
            appelsDepartage.push(courantJournal ? String(courantJournal._id) : '?');
            poolsRejoues.set(String(courantJournal._id), (a.classement || []).slice(0, 8).map(c => c && c.idProduct));
            if (bras === 'apres') { const e = new Error('departager APPELÉ alors que la chaîne devait être coupée'); e.code = 'DEPARTAGE-APPELE'; throw e; }
            if (bras === 'apres-simule') return { departage: false, gagnant: null, champs: { imageStatut: 'non-calcule', imageMotif: 'simulé : aucun avis', imageGagnant: null, imageInliers: null, imageInliersSecond: null, imageRangDuGagnantScoring: null, imageCandidatsAvecVecteur: null, imageCandidatsGroupe: null, imagePoints: DI.N_POINTS, imageMs: 0 } };
            const avis = avisDuJournal(courantJournal);
            // le vivier rejoué n'est pas celui du 14-15/10 (instantané du 12/10) : un gagnant que le classement rejoué ne contient pas ne peut pas être appliqué — dit, jamais inventé
            if (avis.departage && !(a.classement || []).some(c => c && c.idProduct === avis.gagnant)) return { departage: false, gagnant: null, champs: { ...avis.champs, imageStatut: 'vivier-different', imageMotif: 'le gagnant du journal n\'est pas dans le classement rejoué', imageGagnant: null } };
            return avis;
        };
        // 2. le modèle : jamais appelé. axios.post répond la lecture reconstruite depuis le journal (identification ET état des photos)
        const axios = require('axios');
        let lectureCourante = null; const sortants = [];
        axios.post = async (url) => {
            sortants.push(String(url).replace(/^(https?:\/\/[^/]+).*/, '$1'));
            if (!/^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/.test(String(url))) { const e = new Error('GARDE-REJEU : seul le modèle (simulé) répond'); e.code = 'GARDE-RESEAU'; throw e; }
            return { status: 200, data: { choices: [{ message: { content: JSON.stringify(lectureCourante) } }], usage: { cost: 0 } } };
        };

        const db = require('../db'); db.brancher(dbPrincipale);
        const M = require('../modeles'); const J = require('../comptes/jetons');
        await M.creerIndex();
        const { lireConfig } = require('../config');
        const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
        const indexJs = require('../../index');
        verifierEnvironnement(process.env);
        if (bras === 'apres') { process.env.RM_API_V2 = '1'; process.env.V2_ORB_SERVEUR = '0'; process.env.MONGODB_BASE = 'test_scratch'; }   // APRÈS le chargement d'index.js : V2 reste non monté (const évaluée à l'import), seule la garde de la coupure le lit
        const { assembler } = require('../index');
        let courant = null;
        const gererIdentifier = async (req, res) => {
            const json0 = res.json.bind(res);
            res.json = o => { courant.legacy = o; return json0(o); };
            await indexJs.gererIdentifier(req, res);
        };
        const deps = { gererIdentifier };
        assembler([require('../argent/monter'), require('../identifier/monter')], cfg, deps);
        const { traiterIdentifier } = require('../identifier/routes');
        const route = traiterIdentifier(cfg, deps);
        const porteurNeuf = async (k) => {           // une installation par ligne : aucune limite par installation ne mord sur le rejeu
            const inst = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(J.genererJeton()), essais: 1000, libelle: `rejeu-15-${k}` });
            await db.col('installations').insertOne(inst);
            return { type: 'installation', id: inst._id, compte: null, installation: inst, surface: 'extension', administrateur: false };
        };

        const photoFactice = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';
        for (let i = 0; i < lignesJournal.length; i++) {
            const l = lignesJournal[i]; courantJournal = l; lectureCourante = lectureDepuisLigne(l);
            const req = { v2: { porteur: await porteurNeuf(i) }, headers: { 'idempotency-key': `rejeu15-${bras}-${i}` }, ip: `10.15.0.${i + 1}`, body: {},
                entree: { imageUrls: [photoFactice], title: l.titreAnnonce || '', description: '', prixVinted: l.prixVinted ?? null, devise: 'EUR', marche: null, vintedUrl: null, vintedEtat: null, langueInterface: 'fr', versionExtension: 'scanner' } };
            const sortieRoute = { statut: null, corps: null };
            const res = { statut: null, status(c) { this.statut = c; return this; }, setHeader() { return this; }, json(c) { sortieRoute.statut = this.statut; sortieRoute.corps = c; return this; } };
            courant = { legacy: null };
            let exception = null;
            try { await route(req, res); } catch (e) { exception = e; }
            const s = exception ? { issue: 'panne', reponse: null, candidats: [], raison: null } : sommaire(sortieRoute.corps);
            const verite = verites.get(String(l._id)) ?? null;
            const niveau = s.issue === 'affirmee' && verite !== null ? juger(s.reponse, verite, lignesCP) : null;
            const lg = courant.legacy;
            resultats.push({
                scanId: String(l._id), verite, journal: { idProduct: l.idProduct ?? null, motifEchec: l.motifEchec ?? null, imageGagnant: l.imageGagnant, imageInliers: l.imageInliers, exAequoIds: l.exAequoIds ?? null },
                issue: s.issue, raison: s.raison ?? null, reponse: s.reponse, candidats: s.candidats, niveau, veriteParmiCandidats: s.issue === 'question' && verite !== null ? s.candidats.includes(verite) : null,
                chaine: lg ? { success: lg.success ?? null, idProduct: lg.carte && Number.isInteger(lg.carte.idProduct) ? lg.carte.idProduct : null, ambigu: Boolean(lg.carte && lg.carte.ambigu), motifRefus: lg.motifRefus ?? null, nCandidats: Array.isArray(lg.candidats) ? lg.candidats.length : null } : null,
                poolRejoue: poolsRejoues.get(String(l._id)) || null,
                erreurV2: sortieRoute.corps && sortieRoute.corps.erreur ? { code: sortieRoute.corps.erreur.code, statut: sortieRoute.statut } : null,
                exception: exception ? String(exception.code || exception.message).slice(0, 120) : null
            });
            const r = resultats[resultats.length - 1];
            console.log(`${String(i + 1).padStart(2)}/${lignesJournal.length} ${r.scanId} ${r.issue.padEnd(11)} rendu=${r.reponse ?? '-'} vérité=${r.verite ?? '-'} ${r.niveau || ''} | chaîne ${r.chaine ? (r.chaine.success === false ? 'refus:' + r.chaine.motifRefus : 'ok:' + r.chaine.idProduct + (r.chaine.ambigu ? ' ambigu' : '')) : 'aucune'} | journal avant: ${r.journal.idProduct ?? r.journal.motifEchec}${r.erreurV2 ? ' ERREUR-V2 ' + r.erreurV2.code + '/' + r.erreurV2.statut : ''}${r.exception ? ' EXCEPTION ' + r.exception : ''}`);
        }
        // l'image dans le journal écrit PAR LA CHAÎNE (mémoire)
        const jr = await dbPrincipale.collection('journal_scans').find({}).project({ imageStatut: 1, imageGagnant: 1, idProduct: 1, motifEchec: 1, imageMotif: 1 }).toArray().catch(() => []);
        const tot = { bras, instantane: { debutUTC: manifeste.debutUTC, finUTC: manifeste.finUTC }, lignes: resultats.length, appelsDepartage: appelsDepartage.length, sortantsHorsModele: sortants.filter(h => !/openrouter\.ai/.test(h)).length, refusReseau: garde.refus().length, journalMemoire: jr.map(x => ({ imageStatut: x.imageStatut ?? null, imageGagnant: x.imageGagnant ?? null, idProduct: x.idProduct ?? null, motifEchec: x.motifEchec ?? null })) };
        console.log('\n══ BILAN ══\n' + JSON.stringify({ ...tot, journalMemoire: undefined, imageStatutsEcritsParLaChaine: jr.reduce((o, x) => { const k = x.imageStatut ?? 'absent'; o[k] = (o[k] || 0) + 1; return o; }, {}) }, null, 1));
        if (sortie) fs.writeFileSync(sortie, JSON.stringify({ totaux: tot, resultats }, null, 1));
    } finally {
        garde.retirer();
        try { await require('mongoose').disconnect(); } catch { /* déjà fermé */ }
        await banc.arreter();
    }
}

module.exports = { lectureDepuisLigne, avisDuJournal };
if (require.main === module) principal().then(() => process.exit(0)).catch(e => { console.error('🔴', String(e && e.message || e).replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, '<uri masquée>')); process.exit(1); });
