// ============================================================
// UN LOT D'ÉCRITURES : sauvegarde AVANT, commande, GARDE set par set, restauration si elle crie, une ligne de journal
// ============================================================
//   node lot-additif.js --quoi="<ce que fait le lot>" --collections=a,b [--annonce=baisses.json] [--compte=coll[:champ=valeur]]… -- <commande…>
//   ex. node lot-additif.js --quoi="texte de m6" --collections=restes,collecte_etat -- node collecteur-texte.js --set=m6 --attendre
//
// 🔑 LA RÈGLE DU TESTEUR (2026-09-24) : les écritures ADDITIVES — images nouvelles, fiches nouvelles passées au contrôle
// du nom, remises en file — ont un feu vert PERMANENT, à deux conditions : une sauvegarde automatique avant chaque lot,
// et une ligne de journal par lot (quoi, combien, fichier de sauvegarde). Ce qui MODIFIE ou SUPPRIME une donnée
// existante (noms, fusions, détachements) attend toujours son feu vert : cet outil ne le décide pas.
//
// 🔴 ET LA SECONDE RÈGLE, LE MÊME JOUR, APRÈS TROIS LOTS « ADDITIFS » QUI ONT EFFACÉ (§59) : une recollecte RÉÉCRIT, elle
// n'est pas additive. TOUT lot passe donc par la garde de collecte-cartes/garde-lot.js — fiches, illustrateurs, images et
// noms, comptés PAR SET dans la sauvegarde (avant) et dans la base (après). Un seul compteur qui baisse sans avoir été
// annoncé par la simulation (`--annonce=`) ARRÊTE le lot : il se restaure depuis sa sauvegarde, se relit, et se journalise.
// Les collections que la garde compte (cartes, cartes_produits, sets) sont donc TOUJOURS sauvegardées, quel que soit
// `--collections` : une baisse qu'on ne peut pas restaurer ne se garde pas.
//
// La restauration ne défait pas le worker, qui écrit en même temps : ses champs (images d'une carte, complétude d'un set)
// restent tels qu'il les a écrits, sauf quand la baisse fautive est justement une baisse d'IMAGES hors de ses sets. Les
// collections qu'il tient (file_images, images, collecte_images_etat) ne sont jamais restaurées en automatique : le journal
// dit qu'elles ne l'ont pas été.
//
// ANNONCER une baisse de VIGNETTES (cartes.images[].vignette) — le fichier --annonce est un JSON { "<compteur> <groupe>": n } :
//   par SET (retrait de masse voulu, K vignettes) : { "vignettes-set set:Sun-Moon-Promos": 120 }   — couvre les 120 clés ET le nombre du set
//   par CLÉ (un cas précis)                        : { "vignettes-images set:Sun-Moon-Promos|<carteId>|<numero>|<cleR2>": 1 }
// Sans annonce, une vignette perdue ARRÊTE le lot (incident du 2026-10-08) ; elle se remet champ par champ, jamais en rendant le tableau
// `images` (un remplacement d'image à compte égal s'arrête mais ne se restaure pas : la relecture le dit, la sauvegarde le porte).
// Le rejeu de jointure (collecteur-images.js --rejouer-jointure) écrit aussi sur R2 (vignettes fabriquées) hors de cette garde : additif, idempotent.
//
// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion.
// `--base=test_scratch` (et `--journal=`, qui ne vaut qu'avec elle) sert au banc test-lot-garde-scratch.js, jamais à un lot.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { EJSON } = require('mongodb').BSON;
const { SITE_LIT, PROJECTION_ETAT, compterEtat, comparer, validerAnnonces, planRestauration, planVignettes, restaurerImages, cleDoc, setsTouches } = require('./collecte-cartes/garde-lot');
const GS = require('./collecte-cartes/garde-site-lu');   // la liste de ce que le site lit, confrontée au gabarit du site IMPORTÉ (étape 0 ter)
// ➕ 2026-09-25 : le site ne régénère plus ses pages de lui-même (quota Vercel) ; sans appel, une page attend 30 jours. Un lot
// réussi sur la base `cartes` demande donc la revalidation des sets qu'il a TOUCHÉS (documents comparés, pas compteurs) — et
// d'eux seuls. Un échec de revalidation ne défait rien (les données sont justes), mais il s'écrit au journal en 🔴.

// ➕ 2026-10-19 : la garde rejoue aussi le CONTRAT DE L'API (collecte-cartes/garde-contrat-api.js : sa chaîne importée, jamais recopiée). Active sur la base `cartes` ;
// sur `test_scratch` seulement avec `--contrat-api` (futur banc), sinon inerte et dite « non vérifiée ».
const GC = require('./collecte-cartes/garde-contrat-api');
const { sansGardeLignes, installerGardeLignes } = require('./collecte-cartes/lignes-detachees');

const GARDEES = ['cartes', 'cartes_produits', 'sets'];
const RESTAURABLES = ['cartes', 'cartes_produits', 'sets', 'restes', 'collecte_etat'];
// ➕ 2026-09-29 : `visuelsTcgdex` (bilan d'une unité TCGdex d'une autre langue, collecteur-images-tcgdex.js) — écrit par le worker
const CHAMPS_DU_WORKER = { cartes: ['images', 'image'], sets: ['completImages', 'cartesSansImage', 'remplacementTcgdex', 'visuelsTcgdex'] };

const sep = process.argv.indexOf('--');
const options = sep < 0 ? process.argv.slice(2) : process.argv.slice(2, sep);
const commande = sep < 0 ? [] : process.argv.slice(sep + 1);
const AUTORISES = [/^--quoi=.+/, /^--collections=[\w,]+$/, /^--compte=\w+(:\w+=[^\s]+)?$/, /^--annonce=.+\.json$/,
    /^--base=(cartes|test_scratch)$/, /^--journal=.+\.md$/, /^--confirmation=\d{1,3}$/, /^--sans-revalidation$/, /^--estimation-mo=\d+(\.\d+)?$/, /^--contrat-api$/];
const inconnus = options.filter(a => !AUTORISES.some(r => r.test(a)));
const val = nom => options.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const quoi = val('quoi'), collections = val('collections'), BASE = val('base') || 'cartes';
const JOURNAL = val('journal') ? path.resolve(val('journal')) : path.join(__dirname, 'JOURNAL-LOTS.md');
const CONFIRMATION_S = Number(val('confirmation') ?? 20);
// GARDE-ATLAS (2026-10-18) : le lot mesure la grappe CIBLE de son écriture AVANT la sauvegarde et refuse à 90 % de 512 Mo ou plus ;
// `--estimation-mo=<N>` (les Mo que le lot ajoute) : refus si mesure + estimation ≥ 90 %. « Je ne sais pas mesurer » refuse. Après le lot : « Atlas après : X % ».
const T = require('./collecte-cartes/garde-taille-atlas');
const ESTIMATION_MO = val('estimation-mo') !== undefined ? Number(val('estimation-mo')) : 0;
const GRAPPE = BASE === 'cartes' ? 'cartes' : 'production';
const CONTRAT_ACTIF = BASE === 'cartes' || options.includes('--contrat-api');
// 🔴 « idExpansion=6395 » a compté 0 → 0 au premier lot (2026-09-24) : la valeur partait en CHAÎNE, le champ est un
// NOMBRE. Un filtre qui ne mord sur rien rend un zéro plausible (§41). Une valeur numérique cherche donc les deux types,
// et chaque compte s'imprime sur le total de sa collection : « 0 sur 64 000 » se voit, « 0 » non.
const comptes = options.filter(a => a.startsWith('--compte=')).map(a => {
    const [coll, filtre] = a.slice(9).split(':');
    const [champ, valeur] = filtre ? filtre.split('=') : [];
    const v = /^-?\d+$/.test(valeur ?? '') ? { $in: [Number(valeur), valeur] } : valeur;
    return { coll, filtre: champ ? { [champ]: v } : {}, libelle: a.slice(9) };
});
// GARDE-ATLAS (ruling du testeur, 2026-10-18) : aucun chemin de dégagement automatique ; `--degagement` est refusé avant toute connexion.
if (options.includes('--degagement')) {
    console.error('❌ --degagement refusé : au-dessus de 90 %, libérer de la place est une décision du testeur ; outil dédié à venir.');
    process.exit(2);
}
if (inconnus.length || !quoi || !collections || !commande.length || (val('journal') && BASE !== 'test_scratch')) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}${val('journal') && BASE !== 'test_scratch' ? '--journal= ne vaut qu\'avec --base=test_scratch — ' : ''}usage : --quoi="…" --collections=a,b [--annonce=baisses.json] [--compte=coll[:champ=valeur]]… -- <commande…>`);
    process.exit(2);
}
// BASE DE BANC (2026-10-08) : `--base=test_scratch` ne sert qu'aux bancs, et un banc n'écrit plus dans la production. Sans BANC_ISOLE=1
// (posé par collecte-cartes/base-banc.js, hérité par ce processus enfant), test_scratch serait celui de la grappe de production : refus.
if (BASE === 'test_scratch' && process.env.BANC_ISOLE !== '1') {
    console.error('❌ --base=test_scratch refusé hors banc isolé : aucune base de test hors production n\'est ouverte (BANC_ISOLE=1 absent). Rien n\'a été écrit.');
    process.exit(2);
}
const annonces = val('annonce') ? JSON.parse(fs.readFileSync(path.resolve(val('annonce')), 'utf8')) : {};
try { validerAnnonces(annonces); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); }
// `restes` est TOUJOURS sauvegardé (et restauré) : un lot qui détache une ligne pose le reste qui l'interdit (lignes-detachees.js), et une restauration qui remet la ligne doit retirer ce reste. Sur la base `cartes` il doit
// exister (sinon refus, code 6) ; sur le banc il est ajouté s'il existe.
let aSauver = [...new Set([...collections.split(','), ...GARDEES, 'restes'])];

async function ouvrir() {
    if (BASE === 'cartes') {
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        // GARDE-ATLAS : le lot fait SA mesure (avant la sauvegarde, avec son estimation). Les réouvertures d'après-lot ne doivent pas
        // s'arrêter (process.exit) à 90 % : elles servent à comparer et à RESTAURER — d'où lectureSeule, qui saute la garde de connexion
        const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [], lectureSeule: true });
        return { db: cartes.db, client: cartes.getClient(), fermer };
    }
    const mongoose = require('mongoose');
    const cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
    if (cx.db.databaseName !== 'test_scratch') { await cx.close(); throw new Error(`base connectée « ${cx.db.databaseName} » au lieu de test_scratch`); }
    // le banc a le MÊME filet que la production (garde.js::ouvrirConnexions l'installe sur la connexion `cartes`) : sans lui, le banc de la restauration ne verrait jamais le défaut
    installerGardeLignes(cx.db);
    return { db: cx.db, client: cx.getClient(), fermer: () => cx.close() };
}

async function compter(db) {
    const r = [];
    for (const c of comptes) {
        const n = await db.collection(c.coll).countDocuments(c.filtre), total = await db.collection(c.coll).countDocuments({});
        if (!total) throw new Error(`collection « ${c.coll} » VIDE ou mal nommée : un compte sur elle ne mesure rien`);
        r.push(`${n}/${total}`);
    }
    return r;
}

const lireSauvegarde = (dossier, coll) => EJSON.parse(fs.readFileSync(path.join(__dirname, dossier, `${coll}.json`), 'utf8'), { relaxed: true });

// Les documents de la base, projetés sur ce que compterEtat lit : le « après » passe par la MÊME fonction que le « avant ».
// La projection couvre aussi ce que `setsTouches` compare (D1, 2026-10-24 : TOUT champ que le site lit — garde-lot.js SITE_LIT, qui pilote cette projection ET la comparaison —, lignes de jointure, sets entiers).
// Coût mémoire : l'AVANT est la sauvegarde entière, déjà en mémoire ; l'APRÈS n'ajoute aucun document entier, seulement les champs lus par le site (pas bulba, pas sha256, pas les preuves).
// D3.5 (2026-10-24) : UNE SEULE lecture de l'état « après », qui sert les compteurs, les sets touchés ET le contrat de l'API. Avec l'API chargée, les projections sont RÉUNIES (celles du site/des compteurs et celles
// de l'API, sans chemin parent/enfant ensemble) ; la vue de l'API en est dérivée par `projeter`. Avant, une seconde lecture complète (etatContrat) chargeait une troisième copie de la base (≈ 1 073 Mo de tas mesurés)
// et lisait les collections à un autre instant que les compteurs (le worker écrit entre les deux).
async function etatDeLaBase(db, api = null) {
    // la réunion est faite (et validée) par chargerApi, AVANT la sauvegarde : ici plus rien ne peut lever après l'écriture
    const projectionCartes = api ? { ...api.projectionsEtat.cartes } : { ...PROJECTION_ETAT.cartes };
    const projectionLignes = api ? { ...api.projectionsEtat.cartesProduits } : { ...PROJECTION_ETAT.cartesProduits };
    const [cartes, cartesProduits, sets] = await Promise.all([
        db.collection('cartes').find({}).project(projectionCartes).toArray(),
        db.collection('cartes_produits').find({}).project(projectionLignes).toArray(),
        db.collection('sets').find({}).toArray()]);
    for (const [n, l] of [['cartes', cartes], ['cartes_produits', cartesProduits], ['sets', sets]])
        if (!l.length) throw new Error(`« ${n} » est VIDE : un compteur sur elle ne mesure rien (§41)`);
    const docs = { cartes, cartesProduits, sets };
    return Object.assign(compterEtat(docs), { docs });
}

// Les sets où le worker a écrit pendant la fenêtre : prouvé par ses propres dates, jamais supposé.
async function setsDuWorker(db, depuis) {
    const coll = db.collection('collecte_images_etat');
    if (!(await coll.countDocuments({}))) {
        if (BASE === 'cartes') throw new Error('collecte_images_etat VIDE sur la base cartes : l\'activité du worker ne se lit pas (§41)');
        return new Set();
    }
    const docs = await coll.find({ _id: { $not: /__collecteur__$/ }, $or: ['debute', 'derniereRequete', 'fini', 'verrou.depuis'].map(f => ({ [f]: { $gte: depuis } })) }).project({ _id: 1 }).toArray();
    return new Set(docs.map(d => String(d._id).replace(/^[^/]+\//, '')));
}

// Le verdict du contrat : une exception est un refus de conclure (fautive), jamais un « ✅ ». Il juge les documents DÉJÀ LUS (la sauvegarde entière d'un côté, l'état lu une fois de l'autre) : verifierContrat les
// projette comme l'API les lit, à forme égale, puis relâche ces copies.
async function jouerContrat(api, avantDocs, apresDocs) {
    try {
        const v = await GC.verifierContrat({ api, avant: avantDocs, apres: apresDocs });
        return { ligne: GC.ligneContrat(v), fautives: v.nouveaux.map(n => `contrat API ${n.idProduct} : ${n.motif}`), setsFautifs: v.setsFautifs, cartesFautives: v.cartesFautives, persistants: v.persistants, v };
    } catch (e) {
        const raison = String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 300);
        return { ligne: 'contrat API : 🔴 je ne peux pas conclure', fautives: [`contrat API : je ne peux pas conclure (${raison})`], setsFautifs: [], persistants: [], v: null };
    }
}

const decrire = b => `${b.cle} ${b.avant}→${b.apres}${b.annonce ? ` (annoncé −${b.annonce})` : ''}`;
const liste = (l, n = 6) => l.slice(0, n).join(' ; ') + (l.length > n ? ` ; … (+${l.length - n})` : '');

function journaliser(t, dossier, combien, sortie) {
    if (!fs.existsSync(JOURNAL)) fs.writeFileSync(JOURNAL, '# Journal des lots additifs\n\nUne ligne par lot : `lot-additif.js` sauvegarde, lance, compte, écrit ici.\n\n| date (UTC) | quoi | commande | combien (avant → après) | sauvegarde | sortie |\n|---|---|---|---|---|---|\n', 'utf8');
    const cellule = x => String(x).replace(/\|/g, '\\|');
    fs.appendFileSync(JOURNAL, `| ${t.slice(0, 19).replace('T', ' ')} | ${cellule(quoi)} | \`${cellule(commande.join(' '))}\` | ${cellule(combien)} | ${dossier} | ${sortie} |\n`, 'utf8');
    console.log(`   journal : ${path.basename(JOURNAL)}`);
}

(async () => {
    const t = new Date().toISOString();
    const depuis = new Date(Date.now() - 60000);
    const dossier = `backup-${t.slice(0, 10)}-lot-${t.slice(11, 19).replace(/:/g, '')}`;
    // 0. GARDE-ATLAS, AVANT la sauvegarde : la grappe cible est-elle sous 90 % de 512 Mo, estimation du lot comprise ?
    {
        let o = null, v;
        try {
            o = await ouvrir();
            const presentes = (await o.db.listCollections().toArray()).map(c => c.name);
            if (!presentes.includes('restes')) {
                if (BASE === 'cartes') { console.error('❌ la collection « restes » est introuvable sur la base cartes : elle est toujours sauvegardée par un lot (le reste d\'une ligne détachée doit se restaurer). Rien n\'a été sauvegardé ni écrit.'); await o.fermer(); process.exit(6); }
                if (!collections.split(',').includes('restes')) aSauver = aSauver.filter(x => x !== 'restes');
            }
            v = await T.verifierEcriture({ client: o.client, estimationMo: ESTIMATION_MO, sansCache: true }); }
        catch (e) { v = { autorise: false, niveau: 'inconnu', raison: `je ne sais pas mesurer la grappe (${String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 150)})` }; }
        finally { try { await o?.fermer(); } catch { /* fermeture sans importance */ } }
        if (!v.autorise) { console.error(`❌ GARDE-ATLAS (grappe ${GRAPPE}) : ${v.raison}. Rien n'a été sauvegardé ni écrit.`); process.exit(5); }
        console.log(`   0. GARDE-ATLAS (grappe ${GRAPPE}) : ${v.raison}${ESTIMATION_MO ? '' : ' — sans --estimation-mo, l\'ajout du lot n\'est pas compté'}`);
    }
    // 0 bis. CONTRAT DE L'API, AVANT la sauvegarde : l'API est-elle chargeable, sa règle embarquée complète ? « Je ne peux pas conclure » refuse (code 6), rien n'est sauvegardé ni écrit.
    let api = null;
    if (CONTRAT_ACTIF) {
        try { api = await GC.chargerApi(); } catch (e) { console.error(`❌ ${e.message}. Rien n'a été sauvegardé ni écrit.`); process.exit(6); }
        console.log('   0 bis. contrat API : chaîne de l\'API importée (projections, décision, règle du site embarquée, validation d\'entrée)');
    } else console.log('   0 bis. contrat API : non vérifié (base de banc)');
    // 0 ter. CE QUE LE SITE LIT, AVANT la sauvegarde (tour de correction 1, 2026-10-24) : SITE_LIT (garde-lot.js) décide quels sets un lot fait revalider ; elle est confrontée au gabarit de lecture du site IMPORTÉ
    // (lib/lireDonnee.ts : SPEC_CARTE, SPEC_PRODUIT, SPEC_SET). Un champ lu par le site et absent de SITE_LIT, un site introuvable, un import qui lève : refus (code 6), rien n'est sauvegardé ni écrit.
    if (BASE === 'cartes') {
        try {
            const vu = await GS.verifierSiteLu({ siteLit: SITE_LIT });
            console.log(`   0 ter. site lu : SITE_LIT couvre les ${vu.champs} champs que le gabarit de lecture du site (lireDonnee.ts, importé) lit`);
        } catch (e) { console.error(`❌ ${e.message}. Rien n'a été sauvegardé ni écrit.`); process.exit(6); }
    } else console.log('   0 ter. site lu : non vérifié (base de banc)');
    console.log(`\n══ LOT : ${quoi}\n   1. sauvegarde ${aSauver.join(',')} → ${dossier} (base ${BASE})`);
    const s = spawnSync(process.execPath, ['backup-collections.js', `--base=${BASE}`, `--collections=${aSauver.join(',')}`, `--dossier=${dossier}`], { stdio: 'inherit', cwd: __dirname });
    if (s.status !== 0) { console.error(`❌ la sauvegarde a échoué (code ${s.status}) : la commande ne part pas.`); process.exit(1); }
    const docsAvant = { cartes: lireSauvegarde(dossier, 'cartes'), cartesProduits: lireSauvegarde(dossier, 'cartes_produits'), sets: lireSauvegarde(dossier, 'sets') };
    const avant = compterEtat(docsAvant);
    let { db, fermer } = await ouvrir();
    const comptesAvant = await compter(db);
    await fermer();
    console.log(`   2. garde : ${avant.size} groupes comptés dans la sauvegarde · annonces : ${Object.keys(annonces).length ? Object.entries(annonces).map(([k, v]) => `${k} −${v}`).join(' ; ') : 'aucune (toute baisse arrête le lot)'}`);
    if (comptes.length) console.log(`      comptes avant : ${comptes.map((c, i) => `${c.libelle} = ${comptesAvant[i]}`).join(' · ')}`);
    console.log(`   3. ${commande.join(' ')}`);
    const [exe, ...args] = commande;
    // LOT_ADDITIF_PID : la commande sait qu'elle tourne SOUS ce lot (retirer-scan-faux-metal.js --ecrire refuse sans lui)
    const c = spawnSync(exe === 'node' ? process.execPath : exe, args, { stdio: 'inherit', cwd: __dirname, env: { ...process.env, LOT_ADDITIF_PID: String(process.pid) } });

    let client;
    ({ db, fermer, client } = await ouvrir());
    // GARDE-ATLAS : où en est la grappe APRÈS l'écriture ? (imprimé et mis au journal ; une mesure impossible se dit, elle ne fait pas échouer le lot)
    const mesureApres = await T.mesurerGrappe(client).catch(() => null);
    const atlasApres = T.ligneAtlasApres(mesureApres, GRAPPE);
    console.log(`   ${atlasApres}`);
    let apres = await etatDeLaBase(db, api), sw = await setsDuWorker(db, depuis);
    let cmp = comparer(avant, apres, { annonces, setsDuWorker: sw });
    if (cmp.nonAutorisees.length && CONFIRMATION_S) {
        // Le worker retire puis remet : une baisse vue entre deux de ses écritures n'en est pas une. On relit une fois.
        console.log(`   4. ${cmp.nonAutorisees.length} baisse(s) non autorisée(s) — relecture dans ${CONFIRMATION_S} s pour écarter une écriture du worker en cours`);
        await new Promise(r => setTimeout(r, CONFIRMATION_S * 1000));
        apres = null;                                                              // relâche l'ancienne lecture avant la nouvelle (une seule copie de l'état « après » en mémoire)
        apres = await etatDeLaBase(db, api); sw = await setsDuWorker(db, depuis);
        cmp = comparer(avant, apres, { annonces, setsDuWorker: sw });
    }
    const comptesApres = await compter(db);
    const hausses = Object.entries(cmp.hausses).map(([k, v]) => `${k} +${v}`).join(', ') || 'aucune';
    const autorisees = cmp.baisses.filter(b => b.autorisee).map(b => `${decrire(b)} [${b.autorisee}]`);
    console.log(`   5. garde : ${cmp.groupes} groupes · hausses : ${hausses} · baisses autorisées : ${autorisees.length ? liste(autorisees) : 'aucune'}`);
    for (const a of cmp.annoncesNonRealisees) console.log(`      ⚠️ annonce non réalisée telle quelle : ${a.cle} annoncé −${a.annonce}, réel −${a.baisse}`);
    // 5 bis. LE CONTRAT DE L'API (2026-10-19) : la chaîne de l'API rejouée sur les sets touchés, avant (sauvegarde) et après (base). Un refus NOUVEAU, ou une variante perdue, arrête le lot
    // comme une baisse non annoncée ; une exception de la garde est un refus de conclure (arrête et restaure).
    const contrat = api ? await jouerContrat(api, docsAvant, apres.docs) : null;      // la MÊME lecture que les compteurs : ni seconde lecture de la base, ni autre instant
    console.log(`   5 bis. ${contrat ? contrat.ligne : 'contrat API : non vérifié (base de banc)'}`);
    if (contrat?.v) {
        for (const p of contrat.persistants.slice(0, 6)) console.log(`      persistant (déjà avant, ne bloque pas) : ${p.idProduct} — ${p.motif}`);
        if (contrat.persistants.length > 6) console.log(`      … (+${contrat.persistants.length - 6} persistants)`);
    }
    const fautivesContrat = contrat ? contrat.fautives : [];
    const legacy = comptes.map((x, i) => `${x.libelle} ${comptesAvant[i]} → ${comptesApres[i]}`).join(' ; ');

    if (!cmp.nonAutorisees.length && !fautivesContrat.length) {
        let revalidation = null;
        if (BASE === 'cartes' && !options.includes('--sans-revalidation')) {
            const touches = setsTouches({ avant: docsAvant, apres: apres.docs });
            console.log(`   6. sets touchés (documents comparés) : ${touches.sets.length}${touches.sets.length ? ` — ${liste(touches.sets, 12)}` : ''} · catalogue ${touches.catalogue} · espèces ${touches.especes} · sets-info ${touches.setsInfo}`);
            try {
                const { revaliderSets } = require('./collecte-cartes/revalider-site');
                // (2026-10-07) `setsInfo` : un nom, une date, un LOGO de set vivent dans l'entrée `sets-info` du site — sans elle, la
                // page régénérée relit l'ancien (188 logos de decks restés composés après un lot revalidé en HTTP 200)
                const r = await revaliderSets(touches.sets, { catalogue: touches.catalogue, especes: touches.especes, setsInfo: touches.setsInfo });
                revalidation = `revalidation ✅ ${r.sets} sets${touches.catalogue ? ' + catalogue' : ''}${touches.especes ? ' + espèces' : ''}${touches.setsInfo ? ' + sets-info' : ''}`;
            } catch (e) {
                // Les sets à revalider ne se perdent pas : ils attendent dans un fichier, rejoué par
                // `node collecte-cartes/revalider-site.js --en-attente` quand la route répond.
                const { mettreEnAttente } = require('./collecte-cartes/revalider-site');
                const n = mettreEnAttente({ le: t, quoi, ...touches, erreur: e.message.slice(0, 200) });
                revalidation = `🔴 revalidation ÉCHOUÉE (${e.message.slice(0, 90)}) : ${touches.sets.length} sets mis en attente (${n} en attente au total) — ${liste(touches.sets, 8)}`;
                console.error(`   ${revalidation}`);
            }
        }
        const combien = [legacy, atlasApres, `garde ✅ ${cmp.groupes} groupes, 0 baisse non annoncée ; hausses ${hausses}${autorisees.length ? ` ; baisses autorisées ${liste(autorisees, 4)}` : ''}`, contrat ? `${contrat.ligne} ✅` : 'contrat API non vérifié (base de banc)', revalidation].filter(Boolean).join(' ; ');
        console.log(`   ✅ aucune baisse non annoncée${contrat ? ' · contrat API respecté' : ''} · code de sortie ${c.status}`);
        await fermer();
        journaliser(t, dossier, combien, c.status);
        // Pas de process.exit ici : il coupe une connexion fetch en cours de fermeture et Node plante sous Windows (code 9
        // au lieu de 0, lot des dates du 2026-09-25). Le code de sortie est posé, le processus finit de lui-même.
        process.exitCode = c.status ?? 1;
        return;
    }

    // ── ARRÊT : restauration depuis la sauvegarde
    const fautives = [...cmp.nonAutorisees.map(decrire), ...fautivesContrat];
    console.log(`\n   🔴 ARRÊT : ${[cmp.nonAutorisees.length ? `${cmp.nonAutorisees.length} baisse(s) NON ANNONCÉE(S)` : '', fautivesContrat.length ? `${fautivesContrat.length} refus du CONTRAT DE L'API` : ''].filter(Boolean).join(' et ')} :\n      ${fautives.join('\n      ')}\n   6. restauration depuis ${dossier}`);
    // une baisse d'images (compteur) est une affaire de SET : le tableau `images` des cartes de ce set est remis (le champ du worker n'y est pas gardé).
    // (tour 2, D1) un refus du contrat se restaure ENTRÉE PAR ENTRÉE (set + cleR2), sur TOUTES les cartes : chaque entrée d'`images` que le LOT a modifiée revient à sa version sauvegardée, ce que le WORKER a écrit pendant la fenêtre
    // reste (les sets de `collecte_images_etat`, la même règle que la garde des compteurs), et ce qui ne se tranche pas (deux entrées de même clé…) est imprimé et fait sortir en code 4. Remettre le tableau des seules cartes
    // fautives laissait les écritures du lot sur les autres entrées marquées pendant que les lignes `cartes_produits` revenaient : un état que l'API refuse (lot B du 19/10).
    const imagesFautives = new Set(cmp.nonAutorisees.filter(b => b.compteur === 'images').map(b => b.groupe.replace(/^set:/, '')));
    const entierParCompteur = (d, a) => [...(d.images || []), ...(a.images || [])].some(im => imagesFautives.has(im?.set));   // une baisse d'images (compteur) : tout le tableau, comme avant
    const swRestauration = fautivesContrat.length ? await setsDuWorker(db, depuis) : new Set();
    const rapportImages = { cartes: new Set(), restaurees: [], gardees: [], indecidables: [] };
    const garderPour = coll => (d, a) => {
        const champs = CHAMPS_DU_WORKER[coll] || [];
        if (coll === 'cartes' && entierParCompteur(d, a)) return champs.filter(f => f !== 'images');
        return champs;
    };
    const surchargePour = coll => (coll === 'cartes' && fautivesContrat.length) ? (d, a) => {
        if (entierParCompteur(d, a)) return {};
        const r = restaurerImages(d.images, a.images, { setsDuWorker: swRestauration });
        for (const [liste, cible] of [[r.restaurees, rapportImages.restaurees], [r.gardees, rapportImages.gardees], [r.indecidables, rapportImages.indecidables]]) for (const x of liste) cible.push({ carte: d._id, ...x });
        if (r.restaurees.length) rapportImages.cartes.add(d._id);
        return r.restaurees.length ? { images: r.images } : {};      // rien à restaurer ou indécidable : le tableau actuel reste tel quel
    } : null;
    const faits = [];
    // 🔑 UNE RESTAURATION REMET L'ÉTAT EXACT D'AVANT LE LOT : le filet des lignes détachées (lignes-detachees.js) ne la juge jamais. Le lot qui détache une ligne pose aussi le reste qui l'interdit ; si la ligne revient
    // (sauvegarde) pendant que ce reste existe encore, le filet la refuserait et la restauration resterait à moitié faite. Le filet est LEVÉ sur cette connexion seulement (compteur local, pas d'environnement hérité),
    // pour les seules écritures de restauration ci-dessous, et `restes` est restauré AVANT `cartes_produits` quel que soit l'ordre de `--collections` (l'état d'avant, dans le bon ordre, même sans le filet).
    console.log('      ⚠️ filet des lignes détachées LEVÉ pour la restauration (état exact d\'avant le lot ; connexion locale, aucune variable d\'environnement ; remis en place ensuite)');
    await sansGardeLignes(db, async () => {
    for (const coll of aSauver.filter(x => RESTAURABLES.includes(x)).sort((a, b) => (b === 'restes') - (a === 'restes'))) {
        const sauves = new Map(lireSauvegarde(dossier, coll).map(d => [cleDoc(d._id), d]));
        const actuels = new Map((await db.collection(coll).find({}).toArray()).map(d => [cleDoc(d._id), d]));
        const plan = planRestauration(sauves, actuels, { garder: garderPour(coll), surcharge: surchargePour(coll) });
        const ops = [...plan.remplacer.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d } })),
            ...plan.inserer.map(d => ({ insertOne: { document: d } })), ...plan.supprimer.map(id => ({ deleteOne: { filter: { _id: id } } }))];
        if (ops.length) await db.collection(coll).bulkWrite(ops, { ordered: false });
        const champs = Object.entries(plan.champs).map(([f, n]) => `${f}×${n}`).join(' ');
        faits.push(`${coll} ${plan.remplacer.length} remplacé(s)${champs ? ` [${champs}]` : ''}, ${plan.inserer.length} réinséré(s), ${plan.supprimer.length} retiré(s)`);
        console.log(`      ${faits.at(-1)}`);
    }
    // le rapport des entrées d'images : restaurées (cartes et entrées), gardées comme écrites par le worker, et ce qui ne se tranche pas
    if (fautivesContrat.length) {
        const nom = x => `carte ${x.carte} ${x.set}|${x.cleR2} (${x.raison})`;
        faits.push(`images entrée par entrée : ${rapportImages.restaurees.length} restaurée(s) sur ${rapportImages.cartes.size} carte(s), ${rapportImages.gardees.length} gardée(s) comme écrite(s) par le worker, ${rapportImages.indecidables.length} indécidable(s)${rapportImages.restaurees.length ? ` — restaurées : ${liste(rapportImages.restaurees.map(nom), 4)}` : ''}${rapportImages.gardees.length ? ` — gardées (worker) : ${liste(rapportImages.gardees.map(nom), 4)}` : ''}${rapportImages.indecidables.length ? ` — INDÉCIDABLES : ${liste(rapportImages.indecidables.map(nom), 4)}` : ''}`);
        console.log(`      ${faits.at(-1)}`);
        for (const [titre, l] of [['restaurées', rapportImages.restaurees], ['gardées (worker)', rapportImages.gardees], ['INDÉCIDABLES (le lot sort en code 4)', rapportImages.indecidables]]) {
            if (!l.length) continue;
            console.log(`        ${titre} :`);
            for (const x of l.slice(0, 80)) console.log(`          ${nom(x)}`);
            if (l.length > 80) console.log(`          … (+${l.length - 80})`);
        }
    }
    // 🔑 Les vignettes se restaurent CHIRURGICALEMENT (relecture du 2026-10-08) : une baisse de `vignettes-images` ne fait JAMAIS remplacer le
    // tableau `images` (le worker y écrit en même temps : les images neuves de la fenêtre, et celles des autres sets de la carte, seraient
    // perdues sans que la relecture le voie — une hausse perdue n'est pas une baisse). On remet le seul champ `vignette` (pas `jointeLe` : voir planVignettes)
    // de chaque entrée du set fautif qui en avait une dans la sauvegarde et n'en a plus.
    const setsVignettesFautifs = new Set(cmp.nonAutorisees.filter(b => b.compteur === 'vignettes-images' || b.compteur === 'vignettes-set').map(b => b.groupe.replace(/^set:/, '').split('|')[0]));
    if (setsVignettesFautifs.size && aSauver.includes('cartes') && RESTAURABLES.includes('cartes')) {
        const aRemettre = planVignettes(lireSauvegarde(dossier, 'cartes'), await db.collection('cartes').find({}, { projection: { images: 1 } }).toArray(), setsVignettesFautifs);
        let n = 0;
        for (const x of aRemettre) {
            const r = await db.collection('cartes').updateOne({ _id: x._id },
                { $set: { 'images.$[e].vignette': x.vignette } },
                { arrayFilters: [{ 'e.set': x.set, 'e.cleR2': x.cleR2, 'e.vignette': { $exists: false } }] });
            n += r.modifiedCount;
        }
        faits.push(`cartes : ${n} vignette(s) remise(s) champ par champ (${aRemettre.length} prévue(s)), tableau images intact`);
        console.log(`      ${faits.at(-1)}`);
    }
    });
    const nonRestaurees = aSauver.filter(x => !RESTAURABLES.includes(x));
    if (nonRestaurees.length) console.log(`      ⚠️ NON restaurées (tenues par le worker, ou hors de la garde) : ${nonRestaurees.join(', ')} — la sauvegarde les porte`);
    apres = null;                                                                  // l'état d'avant la restauration n'est plus utile : une seule copie de l'état « après » à la fois
    const apresRelu = await etatDeLaBase(db, api);
    const relu = comparer(avant, apresRelu, { annonces, setsDuWorker: await setsDuWorker(db, depuis) });
    // la relecture rejoue aussi le contrat (sur la même lecture) : un refus nouveau qui reste est une restauration incomplète
    const contratRelu = api ? await jouerContrat(api, docsAvant, apresRelu.docs) : null;
    await fermer();
    const resteContrat = contratRelu ? contratRelu.fautives : [];
    // un indécidable n'est jamais « restauré » en silence : le lot sort en code 4
    // (tour 3, E1) … et un produit servi dans la SAUVEGARDE et sans entrée dans l'état relu n'a pas été restauré (la perte d'un visuel n'est une « information » qu'avant l'écriture et sans arrêt)
    const perdus = contratRelu?.v ? GC.produitsPerdus(contratRelu.v) : [];
    const ok = !relu.nonAutorisees.length && !resteContrat.length && !rapportImages.indecidables.length && !perdus.length;
    const incomplet = [...relu.nonAutorisees.map(decrire), ...resteContrat, ...rapportImages.indecidables.map(x => `images indécidable : carte ${x.carte} ${x.set}|${x.cleR2} (${x.raison})`),
        ...perdus.map(p => `produit ${p.idProduct} sans entrée après la restauration (servi dans la sauvegarde${p.sets.length ? `, sets ${p.sets.join(', ')}` : ''})`)];
    console.log(`   7. relu après restauration : ${ok ? `✅ aucune baisse non annoncée${contratRelu ? ' · contrat API respecté' : ''}` : `🔴 RESTAURATION INCOMPLÈTE : ${liste(incomplet)}`}${contratRelu ? `\n      ${contratRelu.ligne}` : ''}`);
    const combien = [legacy, atlasApres, contrat ? contrat.ligne : null, `🔴 ARRÊT : ${cmp.nonAutorisees.length ? 'baisses non annoncées' : 'refus du contrat API'} ${liste(fautives)} — RESTAURÉ : ${faits.join(' ; ')}${nonRestaurees.length ? ` ; non restaurées ${nonRestaurees.join(',')}` : ''} ; relu ${ok ? '✅ aucune baisse' : `🔴 INCOMPLET ${liste(incomplet)}`}${contratRelu ? ` ; relu ${contratRelu.ligne}` : ''}`].filter(Boolean).join(' ; ');
    journaliser(t, dossier, combien, ok ? `3 (commande ${c.status})` : `4 (commande ${c.status})`);
    process.exit(ok ? 3 : 4);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
