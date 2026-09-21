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
//
// 🔴 ET CE FICHIER CITAIT LE §23 SANS EN VÉRIFIER LA CONDITION — corrigé le 2026-09-21.
// Le § dit, en toutes lettres : « un seuil vit dans le PROCESSUS, pas dans le dépôt… la remise en
// file ne vaut que si le worker a été redéployé après le changement de seuil — à vérifier, pas à
// supposer ». L'en-tête ci-dessus annonçait « la leçon de ce § appliquée ». Elle ne l'était pas :
// les 37 sets remis en file le 2026-09-21 sont ressortis `refuse-resolution` en une à trois
// secondes, refusés par un worker qui appliquait encore 480 **sans faire une seule requête**.
// 🔑 CITER UN PARAGRAPHE N'EST PAS L'APPLIQUER. Un commentaire juste rend le code d'à côté plus
// crédible, pas plus correct (§21 bis). La vérification est désormais CÂBLÉE, pas écrite : on lit
// `verrou.commit` du verrou global et on refuse d'enfiler si le worker ne porte pas la règle.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { TABLE_MAIN, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { sourceDe } = require('./collecte-cartes/sources-sets');
const { LARGEUR_MIN } = require('./collecte-cartes/seuils-images');
const { workerContient } = require('./collecte-cartes/sources-deployees');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const balise = require('./collecte-cartes/balise-worker');   // le commit du worker, au repos comme au travail

// Les règles dont cette remise en file dépend ENTIÈREMENT : si le worker ne porte pas ces
// fichiers-là, il rejugera chaque set sur l'ancienne règle, en relisant ses mesures en cache, sans
// une requête — et l'unité ressortira `refuse` en une seconde.
// 🔴 IL N'Y EN AVAIT QU'UNE, ET C'ÉTAIT DÉJÀ TROP PEU — corrigé le 2026-09-21, le lendemain du jour
// où la garde a été écrite. `seuils-images.js` porte le NOMBRE (350) ; le CRITÈRE qui s'en sert vit
// ailleurs, et il vient de changer : `collecteur-images.js` refusait un set sur le MINIMUM de ses
// trois mesures et le refuse désormais sur leur MÉDIANE. Une remise en file faite ce matin aurait
// trouvé la garde VERTE — le seuil n'ayant pas bougé — et le worker aurait refusé PCG2 pour la
// troisième fois.
// 🔑 LA QUESTION N'EST PAS « LE WORKER EST-IL À JOUR ? » MAIS « PORTE-T-IL LA RÈGLE DONT JE
// DÉPENDS ? » — et une règle, ce n'est pas une constante : c'est la constante ET le code qui décide
// avec elle. Une garde qui ne surveille qu'un des deux fichiers répond à une question plus étroite
// que celle qu'elle a l'air de poser.
const REGLES = ['collecte-cartes/seuils-images.js', 'collecteur-images.js', 'collecteur-images-bulba.js'];

// 🔴 LA COLLECTION EST `collecte_images_etat`, PAS `etatimages` — et ma première version de cette
// garde a interrogé `etatimages` (le nom du MODÈLE mongoose, pas celui de la collection : le schéma
// porte `{ collection: 'collecte_images_etat' }`). Une collection inexistante rend `null`, `null`
// devient « aucun détenteur », et « aucun détenteur » est NON BLOQUANT par conception.
// **La garde écrite pour empêcher d'enfiler sous un mauvais commit était donc toujours verte.**
// 🔑 C'est le motif dominant du chantier appliqué à la parade elle-même, le jour où je l'écrivais :
// `lecture-sure.js` existait déjà, et je ne l'avais pas utilisé ICI. Une garde qui échoue vers le
// PASSANT est pire qu'une garde absente — l'absence, au moins, ne rassure personne.
const COLLECTION_VERROUS = 'collecte_images_etat';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 TROIS ÉCHECS, TOUS DANS LE MÊME SENS : CE N'EST PLUS UN ACCIDENT, C'EST UNE CONCEPTION
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Cette garde a échoué VERS LE PASSANT trois fois en trois jours, et chaque fois sur une cause
// différente : une collection mal nommée (`etatimages` au lieu de `collecte_images_etat`), une règle
// surveillée au mauvais endroit (le NOMBRE au lieu du CRITÈRE), un verrou MORT qui masquait le
// vivant. Trois causes indépendantes ne peuvent pas donner trois fois la même direction par hasard.
//
// 🔑 LA CAUSE COMMUNE EST DANS LA FORME, PAS DANS LES BOGUES : la garde était écrite comme une liste
// de cas QUI BLOQUENT, et tout le reste passait. Un défaut, quel qu'il soit, sort forcément de cette
// liste — donc tout défaut, quel qu'il soit, laisse passer. **Une garde énumérée par ses refus a un
// défaut par défaut, et c'est d'être ouverte.**
//
// ✅ ELLE EST DONC RETOURNÉE : elle énumère ce qui AUTORISE, et tout le reste bloque. Un seul chemin
// mène à `bloque: false` — une balise fraîche, une seule, dont le commit contient les TROIS règles.
// Verrou ambigu, détenteur périmé, collection vide, état non prévu, exception : tout cela BLOQUE et
// le DIT. C'est la règle des états du §25 appliquée à une garde : **on énumère le petit ensemble
// stable (ce qui est sûr), jamais le grand ensemble ouvert (ce qui est douteux)**, parce que la
// liste des façons d'être douteux s'allonge avec le temps et que personne ne revient la compléter.
//
// ⚠️ L'ÉCHAPPATOIRE RESTE, ET ELLE EST NOMMÉE : `--malgre-le-commit`. Une garde sans sortie de
// secours se fait retirer, pas satisfaire (§41). Elle est bruyante et laisse une trace.

/**
 * Le worker porte-t-il les règles ? Rend { bloque, phrase, etat }.
 * 🔑 `bloque: false` est le cas PARTICULIER, et il n'a qu'un seul chemin. Tout le reste bloque.
 */
async function etatDuWorker(cx) {
    const lignes = [];
    const bloquer = (...l) => ({ bloque: true, phrase: [...lignes, ...l].join('\n   '), etat: 'bloque' });
    try {
        const col = cx.db.collection(COLLECTION_VERROUS);
        // Le dénominateur AVANT la question : une collection vide ou mal nommée ne peut pas répondre
        // « aucun détenteur », elle doit LEVER (§41) — et l'exception est rattrapée en BLOCAGE.
        await lireMongo(col, {}, { nom: COLLECTION_VERROUS });

        // ── LA BALISE, PAS LE VERROU. Un verrou dit qui a le droit de frapper la source, donc il
        //    disparaît dès que le worker dort — c'est-à-dire dès que la file est vide, c'est-à-dire
        //    exactement quand on veut la remplir. La balise dit quel code tourne, au repos comme au
        //    travail (collecte-cartes/balise-worker.js).
        const { balises, perimees, FRAIS_MS } = await balise.lireBalises(cx.db);
        if (perimees.length)
            lignes.push(`⚪ ${perimees.length} balise(s) périmée(s) ignorée(s) — un processus qui ne bat plus n'est pas un détenteur : ${perimees.map(b => `pid ${b.pid} sur ${b.hote}`).join(' · ')}`);

        if (!balises.length)
            return bloquer(`🔴 AUCUNE balise fraîche (moins de ${FRAIS_MS / 60000} min) : je ne sais pas quel code tourne.`,
                `   Ce n'est pas « aucun worker ne tourne » — c'est « je ne peux pas conclure », et les deux`,
                `   ne se traitent pas pareil. Un worker arrêté redémarrera sur un commit que je n'ai pas lu.`,
                `   ⚠️ Un worker antérieur au 2026-09-21 ne pose PAS de balise : l'absence est alors l'information.`,
                `   → relancer après le redéploiement, ou forcer avec --malgre-le-commit.`);

        // ── DEUX BALISES QUI NE DISENT PAS LA MÊME CHOSE : on ne choisit pas, on bloque. Un
        //    chevauchement de rollout est le cas NORMAL sur Render (§17) ; pendant ce chevauchement,
        //    la file peut être prise par l'ancien pod aussi bien que par le neuf.
        const commits = [...new Set(balises.map(b => b.commit ?? '(aucun)'))];
        if (commits.length > 1)
            return bloquer(`🔴 ${balises.length} balises fraîches sur ${commits.length} commits DIFFÉRENTS : ${commits.join(', ')}.`,
                `   Un chevauchement de déploiement est normal, mais pendant qu'il dure je ne peux pas dire`,
                `   lequel des deux prendra l'unité que j'enfile. On attend qu'il n'en reste qu'un.`);

        const b = balises[0];
        if (!b.commit)
            return bloquer(`🔴 la balise (pid ${b.pid} sur ${b.hote}) n'écrit pas son commit — elle tourne sur du code antérieur au 2026-09-21.`);
        if (b.commit === 'local')
            return bloquer(`🔴 le détenteur est un processus LOCAL (pid ${b.pid} sur ${b.hote}) : un arbre de travail n'est pas un commit,`,
                `   donc je ne peux pas dire quelles règles il porte.`);

        // ── CHAQUE RÈGLE SÉPARÉMENT, et chacune s'imprime. Un « ✅ » global qui cache un fichier en
        //    retard est exactement la garde verte et fausse du 2026-09-20.
        const faux = { verrou: { ...b, depuis: b.depuis } };
        const resultats = REGLES.map(f => ({ f, r: workerContient(faux.verrou, f) }));
        for (const { f, r } of resultats) {
            if (r.etat === 'a-jour') { lignes.push(`✅ ${f} : ${b.commit} contient ${r.dernier}`); continue; }
            lignes.push(`🔴 ${f} : ${r.raison || `état « ${r.etat} »`}`);
        }
        if (resultats.some(x => x.r.etat !== 'a-jour'))
            return bloquer(`🔴 une règle au moins n'est pas portée par le worker — enfiler maintenant fabriquerait des refus.`);

        // ✅ LE SEUL CHEMIN QUI AUTORISE.
        return { bloque: false, phrase: [...lignes, `✅ worker ${b.hote}/${b.pid}, état « ${b.etat} », sur ${b.commit} — les ${REGLES.length} règles sont portées.`].join('\n   '), etat: 'a-jour' };
    } catch (e) {
        // ⚠️ UNE EXCEPTION EST UN DOUTE, DONC UN BLOCAGE. La version précédente n'avait pas de `catch`
        // du tout, ce qui revenait à faire tomber l'outil — mieux qu'un passage, mais moins lisible.
        return bloquer(`🔴 la garde n'a pas pu conclure : ${e.message}`,
            `   Une garde qui ne sait pas BLOQUE. C'est le sens dans lequel elle doit échouer.`);
    }
}

// Exportée pour son banc : une garde qu'on n'a jamais VUE dire non n'a pas été vérifiée, elle a été
// supposée (§41). `test-garde-worker.js` la fait crier sur huit états fabriqués.
module.exports = { etatDuWorker, REGLES, COLLECTION_VERROUS };

if (require.main !== module) return;

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const quandMeme = process.argv.includes('--malgre-le-commit');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const W = await etatDuWorker(cx);
    console.log(`\n════ LE COMMIT DU WORKER ════\n   ${W.phrase}`);

    // 🔴 L'ÉNUMÉRATION NE SE BORNE PLUS AUX LIGNES ADMISES — corrigé le 2026-09-21, et c'est le §33
    // à un nouvel endroit. Cet outil ne regardait que `l.verifie`, alors que la question qu'il pose
    // est « ce SET a-t-il des cartes sans visuel ? ». Les deux ne coïncident pas : une expansion
    // peut être fichée par la voie « sans page » (jointure par le nom d'expansion déclaré sur la
    // carte) sans que sa ligne soit jamais passée en vérification. **Mesuré : 25 sets, 670 produits,
    // cartes présentes, source artofpkm DÉCLARÉE, aucun visuel — et invisibles à la file pour
    // toujours**, parce qu'une ligne non admise n'était pas même énumérée.
    // 🔑 Un ensemble « ce qu'il y a à faire » se construit sur ce qui PRODUIT (des cartes en base),
    // jamais sur un état administratif de notre travail. La garde utile est déjà trois lignes plus
    // bas — `if (!g.n) continue` : un set sans carte n'a rien à imager, et elle suffit.
    // ⚠️ L'ordre de préférence est conservé : une ligne ADMISE l'emporte sur une non admise de même
    // code, sinon une ligne « à la main » non jugée masquerait la ligne automatique qui, elle, a un
    // verdict écrit (§33, le motif `ligne()` rend TABLE ?? TABLE_AUTO ?? TABLE_SANS_PAGE).
    const parCode = new Map();
    const toutesLignes = [...TABLE_MAIN, ...TABLE_AUTO, ...TABLE_SANS_PAGE].filter(l => l.slugSet && l.code);
    for (const l of toutesLignes) if (l.verifie && !parCode.has(l.code)) parCode.set(l.code, l);
    const admises = parCode.size;
    for (const l of toutesLignes) if (!parCode.has(l.code)) parCode.set(l.code, l);

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
    console.log(`\n════ DÉNOMINATEUR : ${parCode.size} lignes énumérées (${admises} admises + ${parCode.size - admises} non admises mais dont le set peut porter des cartes) · ${file.size} unités en file · seuil ${LARGEUR_MIN} px ════`);
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

    // 🔑 LE REFUS EST ICI, APRÈS LA MESURE ET AVANT L'ÉCRITURE. La mesure reste toujours lisible —
    // on veut savoir ce qu'on ENFILERAIT même quand on ne peut pas enfiler ; c'est l'écriture seule
    // qui est bloquée. Un outil qui refuse de MESURER parce qu'il ne peut pas AGIR cache deux fois.
    if (W.bloque && !quandMeme) {
        console.log(`\n🔴 RIEN N'EST ÉCRIT. ${W.phrase}`);
        console.log(`   Enfiler maintenant refabriquerait le 2026-09-21 : le worker relit ses mesures en cache et`);
        console.log(`   refuse chaque set en une seconde, sans une requête — et le refus repart pour toujours (§23).`);
        console.log(`   → redéployer le worker, PUIS relancer. Forcer : --malgre-le-commit (et dire pourquoi).`);
        await fermer(); process.exitCode = 1; return;
    }
    if (W.bloque) console.log(`\n⚠️ FORCÉ malgré le commit du worker (--malgre-le-commit). ${W.phrase}`);

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
