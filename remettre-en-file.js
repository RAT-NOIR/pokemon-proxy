// ============================================================
// REMPLIR LA FILE D'IMAGES — « le worker ne doit jamais être à vide »
// ============================================================
//   node remettre-en-file.js            (mesure seule, c'est le défaut)
//   node remettre-en-file.js --ecrire
//
// 🔴 POURQUOI UN OUTIL, ET PAS `--enfiler=` : `--enfiler` fait un `$setOnInsert`. Sur un set DÉJÀ
// présent dans la file, il ne fait RIEN et imprime quand même « enfilé » (§23). Toute remise en file
// d'une unité existante passe donc par une mise à jour DIRECTE, bornée à l'état qu'on veut reprendre,
// avec `remisEnFileLe` et `remisEnFileMotif` écrits sur la ligne — une reprise qui ne dit pas pourquoi
// elle a eu lieu est indistinguable d'un état initial trois semaines plus tard.
//
// 🔑 ET LA RAISON D'ÊTRE EST LE §23 : QUAND UN SEUIL CHANGE, LES REFUS PRIS SOUS L'ANCIEN NE SE
// RÉÉVALUENT PAS TOUT SEULS. Le seuil est passé de 480 à 350 le 2026-09-21 ; les 42 unités refusées
// « refuse-resolution » l'ont été sous 480 et resteraient refusées pour toujours. La liste existe,
// il faut la relire — dans le même geste que le changement, pas plus tard.
//
// ⚠️ TROIS POPULATIONS, ET ELLES NE SE TRAITENT PAS PAREIL :
//   (1) refusées à la résolution qui PASSENT le nouveau seuil → reprises ;
//   (2) absentes de la file, avec une source d'images et des cartes sans visuel → insérées ;
//   (3) `fait/verifie` dont des cartes n'ont toujours pas de visuel → **NON reprises, listées**.
//       Les remettre en file sans cause, c'est demander au worker de refaire ce qu'il a déjà fait et
//       de re-échouer de la même façon. Une file qu'on remplit de travail impossible n'est pas pleine,
//       elle est bouchée.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { TABLE_MAIN, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { sourceDe } = require('./collecte-cartes/sources-sets');
const { LARGEUR_MIN } = require('./collecte-cartes/seuils-images');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });

    // les lignes ADMISES, dédoublonnées par code (`ligne()` rend la première trouvée)
    const parCode = new Map();
    for (const l of [...TABLE_MAIN, ...TABLE_AUTO, ...TABLE_SANS_PAGE])
        if (l.verifie && l.slugSet && l.code && !parCode.has(l.code)) parCode.set(l.code, l);

    // combien de cartes par set, combien portent un visuel POUR CE SET (§19 : la clé est (carte, set))
    const parSet = new Map();
    for await (const c of cx.db.collection('cartes').find({}, { projection: { sets: 1, images: 1 } }))
        for (const s of c.sets || []) {
            if (!parSet.has(s)) parSet.set(s, { n: 0, avec: 0 });
            const g = parSet.get(s); g.n++;
            if ((c.images || []).some(i => i.set === s)) g.avec++;
        }

    const file = new Map((await cx.db.collection('file_images').find({}).toArray()).map(u => [u._id, u]));
    // 🔴 LE CRITÈRE EST LA MÉDIANE, PAS LE MINIMUM — et ma première version lisait le minimum.
    // `collecteur-images-bulba.js:135` refuse un set quand sa largeur MÉDIANE passe sous le seuil ;
    // au-dessus, il ÉCARTE ET COMPTE les fichiers isolés trop petits (l.143). Le filtrage par image
    // existe donc déjà. Lire le minimum, c'était juger le set sur sa pire image alors que la
    // production le juge sur sa masse — 33 sets bloqués à tort, dont Skyridge (min 314, médiane 465)
    // et Diamond & Pearl (min 200, médiane 381).
    // 🔑 C'est le motif dominant du chantier : la sonde doit lire LA MÊME CHOSE que le code de
    // production, sinon elle fabrique le refus qu'elle mesure.
    const medLargeur = new Map();
    for (const e of await cx.db.collection('collecte_images_etat').find({}).toArray()) {
        // la mesure écrite par le collecteur fait foi quand elle existe ; sinon on la recalcule
        // sur le même champ que lui, et de la même façon.
        const slug = String(e._id).split('/').slice(1).join('/');
        if (e.mesure?.mediane != null) { medLargeur.set(slug, e.mesure.mediane); continue; }
        const ws = [...(e.infosListe || []).map(x => x?.w), ...Object.values(e.mesures || {}).flat().map(x => x?.w)]
            .filter(Boolean).sort((a, b) => a - b);
        if (ws.length) medLargeur.set(slug, ws[Math.floor(ws.length / 2)]);
    }

    const reprises = [], insertions = [], bloquees = [], sansSource = [], complets = [];
    for (const [code, l] of parCode) {
        const g = parSet.get(l.slugSet) || { n: 0, avec: 0 };
        if (!g.n) continue;                                   // texte pas encore collecté : rien à imager
        const manque = g.n - g.avec;
        if (manque <= 0) { complets.push(code); continue; }
        const S = sourceDe(code);
        const u = file.get(code);
        const min = medLargeur.get(l.slugSet) ?? null;   // MÉDIANE, le critère de la production
        const ligne = { code, slug: l.slugSet, manque, n: g.n, min, etat: u ? `${u.etat}/${u.resultat ?? '—'}` : 'absent' };
        if (u && u.etat === 'attente') continue;              // déjà en file
        if (u && u.etat === 'refuse' && u.resultat === 'refuse-resolution') {
            if (min != null && min >= LARGEUR_MIN) reprises.push(ligne);
            else bloquees.push({ ...ligne, pourquoi: `largeur MÉDIANE ${min ?? '?'} px < ${LARGEUR_MIN} — le critère de la production` });
            continue;
        }
        if (!S) { sansSource.push(ligne); continue; }
        if (!u) { insertions.push(ligne); continue; }
        bloquees.push({ ...ligne, pourquoi: `déjà ${ligne.etat}, aucune cause neuve — une reprise à l'aveugle re-échouerait` });
    }

    const tot = a => a.reduce((s, x) => s + x.manque, 0);
    console.log(`\n════ DÉNOMINATEUR : ${parCode.size} lignes admises · ${file.size} unités en file · seuil ${LARGEUR_MIN} px ════`);
    console.log(`   ✅ sets complets (toutes les cartes ont leur visuel)     : ${complets.length}`);
    console.log(`   ♻️  À REPRENDRE (refusées au seuil, passent maintenant)  : ${reprises.length} sets · ${tot(reprises)} cartes`);
    console.log(`   ➕ À INSÉRER (absentes de la file, source connue)        : ${insertions.length} sets · ${tot(insertions)} cartes`);
    console.log(`   ⛔ sans source d'images artofpkm                         : ${sansSource.length} sets · ${tot(sansSource)} cartes`);
    console.log(`   🕳️ bloquées, avec leur cause                             : ${bloquees.length} sets · ${tot(bloquees)} cartes`);

    console.log(`\n── À REPRENDRE`);
    for (const x of reprises.sort((a, b) => b.manque - a.manque))
        console.log(`   ${String(x.manque).padStart(4)} cartes · ${x.code.padEnd(9)} ${String(x.slug).slice(0, 34).padEnd(34)} mediane ${x.min} px`);
    console.log(`\n── À INSÉRER (20 plus grosses)`);
    for (const x of insertions.sort((a, b) => b.manque - a.manque).slice(0, 20))
        console.log(`   ${String(x.manque).padStart(4)} cartes · ${x.code.padEnd(9)} ${String(x.slug).slice(0, 34).padEnd(34)}`);
    console.log(`\n── BLOQUÉES (15 plus grosses) — listées avec leur cause, jamais résolues au fil`);
    for (const x of bloquees.sort((a, b) => b.manque - a.manque).slice(0, 15))
        console.log(`   ${String(x.manque).padStart(4)} cartes · ${x.code.padEnd(9)} ${String(x.slug).slice(0, 30).padEnd(30)} — ${x.pourquoi}`);

    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --ecrire)`); await fermer(); return; }

    const F = cx.db.collection('file_images');
    let repris = 0, insere = 0;
    for (const x of reprises) {
        const r = await F.updateOne({ _id: x.code, etat: 'refuse', resultat: 'refuse-resolution' }, {
            $set: { etat: 'attente', remisEnFileLe: new Date(), remisEnFileMotif: `seuil abaissé de 480 à ${LARGEUR_MIN} px le 2026-09-21 ; largeur mediane de ce set : ${x.min} px` },
            $unset: { resultat: '', pris: '', fini: '' }
        });
        repris += r.modifiedCount;
    }
    for (const x of insertions) {
        const r = await F.updateOne({ _id: x.code }, {
            $setOnInsert: { ajouteLe: new Date(), etat: 'attente', ordre: Date.now(), ajouteMotif: `${x.manque} carte(s) sans visuel sur ${x.n}, source artofpkm connue` }
        }, { upsert: true });
        if (r.upsertedCount) insere++;
    }
    const enAttente = await F.countDocuments({ etat: 'attente' });
    console.log(`\n   ✅ reprises : ${repris} · insérées : ${insere}`);
    console.log(`   🔑 LA FILE CONTIENT MAINTENANT ${enAttente} UNITÉS EN ATTENTE.`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
