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
// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion.
// `--base=test_scratch` (et `--journal=`, qui ne vaut qu'avec elle) sert au banc test-lot-garde-scratch.js, jamais à un lot.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { EJSON } = require('mongodb').BSON;
const { compterEtat, comparer, validerAnnonces, planRestauration, cleDoc, setsTouches } = require('./collecte-cartes/garde-lot');
// ➕ 2026-09-25 : le site ne régénère plus ses pages de lui-même (quota Vercel) ; sans appel, une page attend 30 jours. Un lot
// réussi sur la base `cartes` demande donc la revalidation des sets qu'il a TOUCHÉS (documents comparés, pas compteurs) — et
// d'eux seuls. Un échec de revalidation ne défait rien (les données sont justes), mais il s'écrit au journal en 🔴.

const GARDEES = ['cartes', 'cartes_produits', 'sets'];
const RESTAURABLES = ['cartes', 'cartes_produits', 'sets', 'restes', 'collecte_etat'];
const CHAMPS_DU_WORKER = { cartes: ['images', 'image'], sets: ['completImages', 'cartesSansImage', 'remplacementTcgdex'] };

const sep = process.argv.indexOf('--');
const options = sep < 0 ? process.argv.slice(2) : process.argv.slice(2, sep);
const commande = sep < 0 ? [] : process.argv.slice(sep + 1);
const AUTORISES = [/^--quoi=.+/, /^--collections=[\w,]+$/, /^--compte=\w+(:\w+=[^\s]+)?$/, /^--annonce=.+\.json$/,
    /^--base=(cartes|test_scratch)$/, /^--journal=.+\.md$/, /^--confirmation=\d{1,3}$/, /^--sans-revalidation$/];
const inconnus = options.filter(a => !AUTORISES.some(r => r.test(a)));
const val = nom => options.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const quoi = val('quoi'), collections = val('collections'), BASE = val('base') || 'cartes';
const JOURNAL = val('journal') ? path.resolve(val('journal')) : path.join(__dirname, 'JOURNAL-LOTS.md');
const CONFIRMATION_S = Number(val('confirmation') ?? 20);
// 🔴 « idExpansion=6395 » a compté 0 → 0 au premier lot (2026-09-24) : la valeur partait en CHAÎNE, le champ est un
// NOMBRE. Un filtre qui ne mord sur rien rend un zéro plausible (§41). Une valeur numérique cherche donc les deux types,
// et chaque compte s'imprime sur le total de sa collection : « 0 sur 64 000 » se voit, « 0 » non.
const comptes = options.filter(a => a.startsWith('--compte=')).map(a => {
    const [coll, filtre] = a.slice(9).split(':');
    const [champ, valeur] = filtre ? filtre.split('=') : [];
    const v = /^-?\d+$/.test(valeur ?? '') ? { $in: [Number(valeur), valeur] } : valeur;
    return { coll, filtre: champ ? { [champ]: v } : {}, libelle: a.slice(9) };
});
if (inconnus.length || !quoi || !collections || !commande.length || (val('journal') && BASE !== 'test_scratch')) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}${val('journal') && BASE !== 'test_scratch' ? '--journal= ne vaut qu\'avec --base=test_scratch — ' : ''}usage : --quoi="…" --collections=a,b [--annonce=baisses.json] [--compte=coll[:champ=valeur]]… -- <commande…>`);
    process.exit(2);
}
const annonces = val('annonce') ? JSON.parse(fs.readFileSync(path.resolve(val('annonce')), 'utf8')) : {};
try { validerAnnonces(annonces); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); }
const aSauver = [...new Set([...collections.split(','), ...GARDEES])];

async function ouvrir() {
    if (BASE === 'cartes') {
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        return { db: cartes.db, fermer };
    }
    const mongoose = require('mongoose');
    const cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
    if (cx.db.databaseName !== 'test_scratch') { await cx.close(); throw new Error(`base connectée « ${cx.db.databaseName} » au lieu de test_scratch`); }
    return { db: cx.db, fermer: () => cx.close() };
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
// La projection couvre aussi ce que `setsTouches` compare (numéros, clés d'images, lignes de jointure, sets entiers).
async function etatDeLaBase(db) {
    const [cartes, cartesProduits, sets] = await Promise.all([
        db.collection('cartes').find({}).project({ sets: 1, nomEn: 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'impressions.illustrateur': 1, 'impressions.numero': 1, 'images.set': 1, 'images.cleR2': 1, 'images.numero': 1 }).toArray(),
        db.collection('cartes_produits').find({}).project({ idExpansion: 1, idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1, preuve: 1 }).toArray(),
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
    const c = spawnSync(exe === 'node' ? process.execPath : exe, args, { stdio: 'inherit', cwd: __dirname });

    ({ db, fermer } = await ouvrir());
    let apres = await etatDeLaBase(db), sw = await setsDuWorker(db, depuis);
    let cmp = comparer(avant, apres, { annonces, setsDuWorker: sw });
    if (cmp.nonAutorisees.length && CONFIRMATION_S) {
        // Le worker retire puis remet : une baisse vue entre deux de ses écritures n'en est pas une. On relit une fois.
        console.log(`   4. ${cmp.nonAutorisees.length} baisse(s) non autorisée(s) — relecture dans ${CONFIRMATION_S} s pour écarter une écriture du worker en cours`);
        await new Promise(r => setTimeout(r, CONFIRMATION_S * 1000));
        apres = await etatDeLaBase(db); sw = await setsDuWorker(db, depuis);
        cmp = comparer(avant, apres, { annonces, setsDuWorker: sw });
    }
    const comptesApres = await compter(db);
    const hausses = Object.entries(cmp.hausses).map(([k, v]) => `${k} +${v}`).join(', ') || 'aucune';
    const autorisees = cmp.baisses.filter(b => b.autorisee).map(b => `${decrire(b)} [${b.autorisee}]`);
    console.log(`   5. garde : ${cmp.groupes} groupes · hausses : ${hausses} · baisses autorisées : ${autorisees.length ? liste(autorisees) : 'aucune'}`);
    for (const a of cmp.annoncesNonRealisees) console.log(`      ⚠️ annonce non réalisée telle quelle : ${a.cle} annoncé −${a.annonce}, réel −${a.baisse}`);
    const legacy = comptes.map((x, i) => `${x.libelle} ${comptesAvant[i]} → ${comptesApres[i]}`).join(' ; ');

    if (!cmp.nonAutorisees.length) {
        let revalidation = null;
        if (BASE === 'cartes' && !options.includes('--sans-revalidation')) {
            const touches = setsTouches({ avant: docsAvant, apres: apres.docs });
            console.log(`   6. sets touchés (documents comparés) : ${touches.sets.length}${touches.sets.length ? ` — ${liste(touches.sets, 12)}` : ''} · catalogue ${touches.catalogue} · espèces ${touches.especes}`);
            try {
                const { revaliderSets } = require('./collecte-cartes/revalider-site');
                const r = await revaliderSets(touches.sets, { catalogue: touches.catalogue, especes: touches.especes });
                revalidation = `revalidation ✅ ${r.sets} sets${touches.catalogue ? ' + catalogue' : ''}${touches.especes ? ' + espèces' : ''}`;
            } catch (e) {
                revalidation = `🔴 revalidation ÉCHOUÉE (${e.message.slice(0, 90)}) : ${touches.sets.length} sets à revalider — ${liste(touches.sets, 8)}`;
                console.error(`   ${revalidation}`);
            }
        }
        const combien = [legacy, `garde ✅ ${cmp.groupes} groupes, 0 baisse non annoncée ; hausses ${hausses}${autorisees.length ? ` ; baisses autorisées ${liste(autorisees, 4)}` : ''}`, revalidation].filter(Boolean).join(' ; ');
        console.log(`   ✅ aucune baisse non annoncée · code de sortie ${c.status}`);
        await fermer();
        journaliser(t, dossier, combien, c.status);
        process.exit(c.status ?? 1);
    }

    // ── ARRÊT : restauration depuis la sauvegarde
    const fautives = cmp.nonAutorisees.map(decrire);
    console.log(`\n   🔴 ARRÊT : ${cmp.nonAutorisees.length} baisse(s) NON ANNONCÉE(S) :\n      ${fautives.join('\n      ')}\n   6. restauration depuis ${dossier}`);
    const imagesFautives = new Set(cmp.nonAutorisees.filter(b => b.compteur === 'images').map(b => b.groupe.replace(/^set:/, '')));
    const garderPour = coll => (d, a) => {
        const champs = CHAMPS_DU_WORKER[coll] || [];
        if (coll === 'cartes' && [...(d.images || []), ...(a.images || [])].some(im => imagesFautives.has(im?.set))) return champs.filter(f => f !== 'images');
        return champs;
    };
    const faits = [];
    for (const coll of aSauver.filter(x => RESTAURABLES.includes(x))) {
        const sauves = new Map(lireSauvegarde(dossier, coll).map(d => [cleDoc(d._id), d]));
        const actuels = new Map((await db.collection(coll).find({}).toArray()).map(d => [cleDoc(d._id), d]));
        const plan = planRestauration(sauves, actuels, { garder: garderPour(coll) });
        const ops = [...plan.remplacer.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d } })),
            ...plan.inserer.map(d => ({ insertOne: { document: d } })), ...plan.supprimer.map(id => ({ deleteOne: { filter: { _id: id } } }))];
        if (ops.length) await db.collection(coll).bulkWrite(ops, { ordered: false });
        const champs = Object.entries(plan.champs).map(([f, n]) => `${f}×${n}`).join(' ');
        faits.push(`${coll} ${plan.remplacer.length} remplacé(s)${champs ? ` [${champs}]` : ''}, ${plan.inserer.length} réinséré(s), ${plan.supprimer.length} retiré(s)`);
        console.log(`      ${faits.at(-1)}`);
    }
    const nonRestaurees = aSauver.filter(x => !RESTAURABLES.includes(x));
    if (nonRestaurees.length) console.log(`      ⚠️ NON restaurées (tenues par le worker, ou hors de la garde) : ${nonRestaurees.join(', ')} — la sauvegarde les porte`);
    const relu = comparer(avant, await etatDeLaBase(db), { annonces, setsDuWorker: await setsDuWorker(db, depuis) });
    await fermer();
    const ok = !relu.nonAutorisees.length;
    console.log(`   7. relu après restauration : ${ok ? '✅ aucune baisse non annoncée' : `🔴 RESTAURATION INCOMPLÈTE : ${liste(relu.nonAutorisees.map(decrire))}`}`);
    const combien = [legacy, `🔴 ARRÊT : baisses non annoncées ${liste(fautives)} — RESTAURÉ : ${faits.join(' ; ')}${nonRestaurees.length ? ` ; non restaurées ${nonRestaurees.join(',')}` : ''} ; relu ${ok ? '✅ aucune baisse' : `🔴 INCOMPLET ${liste(relu.nonAutorisees.map(decrire))}`}`].filter(Boolean).join(' ; ');
    journaliser(t, dossier, combien, ok ? `3 (commande ${c.status})` : `4 (commande ${c.status})`);
    process.exit(ok ? 3 : 4);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
