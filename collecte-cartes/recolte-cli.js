// ============================================================
// LA LIGNE DE COMMANDE COMMUNE DES COLLECTEURS « RECOLTE » (ppr, tcs) — 2026-10-24
// ============================================================
// Les deux collecteurs ont les mêmes modes (§21 bis : une seule ligne de commande, jamais deux copies) ; ce module en tient la grammaire, les gardes d'arguments et l'exécution des modes
// qui ne dépendent pas de la source (téléchargement, planches, compte, retrait, écriture). Chaque collecteur fournit `def` : son code neutre, son descripteur de source, son client, son relevé
// et son plan. Une ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion.
//
//   --plan                         lecture seule (base + relevés) -> plan-<code>.json
//   --releve --plafond=N           les listes de la source (JSON ou pages) : 1 requête chacune -> releves-<code>.json
//   --telecharger --plafond=N [--limite=M]   les images des unités à ajouter -> images-<code>.json (progression-<code>.json) ; --limite : un échantillon de M unités
//   --planche --echantillon=N      planches planche-<code>-N.jpg, À REGARDER avant d'écrire
//   --compter                      lecture seule : la valeur de --attendu
//   --ecrire --attendu=N           AUCUNE requête (cache seulement), seulement sous lot-additif.js
//   --retirer                      à blanc : le retrait exact du lot (l'écriture : retirer-visuels-recolte.js --source=<code>)
//   --dossier= --cache=            (bancs) un autre dossier de sorties / de cache — jamais un dossier d'apports manuels
const path = require('path');
const fs = require('fs');
const RC = require('./recolte-commun');
const RH = require('./reponse-hote');
const HOTE = require('./recolte-hote');
const { largeurMinDe } = require('./seuils-images');

const AUTORISES = [/^--plan$/, /^--releve$/, /^--telecharger$/, /^--planche$/, /^--compter$/, /^--ecrire$/, /^--retirer$/, /^--manifeste$/, /^--plafond=\d{1,4}$/, /^--attendu=\d{1,5}$/, /^--echantillon=\d{1,3}$/, /^--limite=\d{1,4}$/, /^--dossier=.+$/, /^--cache=.+$/, /^--basse-definition$/];
const MODES = ['--plan', '--releve', '--telecharger', '--planche', '--compter', '--ecrire', '--retirer', '--manifeste'];

/** La grammaire des arguments : null si valide, sinon la phrase du refus (code 2, sans connexion). */
function verifierArguments(args) {
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    const modes = MODES.filter(m => args.includes(m));
    const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
    if (inconnus.length) return `argument inconnu : ${inconnus.join(' ')}`;
    if (modes.length !== 1) return `un seul mode parmi ${MODES.join(', ')}`;
    if ((modes[0] === '--releve' || modes[0] === '--telecharger') && !val('plafond')) return `${modes[0]} exige --plafond=<N> (total pour le dossier de cache)`;
    if (modes[0] === '--ecrire' && !val('attendu')) return '--ecrire exige --attendu=<N>';
    if (val('attendu') && modes[0] !== '--ecrire') return '--attendu ne va qu\'avec --ecrire';
    if (val('echantillon') && modes[0] !== '--planche') return '--echantillon ne va qu\'avec --planche';
    if (val('limite') && modes[0] !== '--telecharger') return '--limite ne va qu\'avec --telecharger';
    if (val('plafond') && !['--releve', '--telecharger'].includes(modes[0])) return '--plafond ne va qu\'avec --releve ou --telecharger';
    if (args.includes('--basse-definition') && !['--compter', '--planche', '--ecrire'].includes(modes[0])) return '--basse-definition ne va qu\'avec --compter, --planche ou --ecrire';
    return null;
}
const fichiersDe = (CODE, dossier, cache) => ({ cache: RC.verifierChemin(cache ?? path.join(dossier, `cache-${CODE}`)), plan: path.join(dossier, `plan-${CODE}.json`), releves: path.join(dossier, `releves-${CODE}.json`), images: path.join(dossier, `images-${CODE}.json`),
    progression: path.join(dossier, `progression-${CODE}.json`), journal: path.join(dossier, `journal-${CODE}.jsonl`), essai: path.join(dossier, `essai-ecriture-${CODE}.txt`) });

/** Le maximum de requêtes du téléchargement, compté AVANT la première (§38) : le robots.txt de l'hôte des images (s'il n'est pas au cache) + les images ni jugées ni au cache. */
function maximumImages({ F, hoteImages, unites, indexImages, plafondTotal }) {
    const enCache = url => fs.existsSync(path.join(F.cache, HOTE.nomCache(url)));
    const urls = [...new Set(unites.map(u => u.url))].filter(u => !indexImages[u] && !enCache(u));
    const robots = HOTE.robotsFrais(F.cache, hoteImages) ? 0 : 1;           // D2 : un robots.txt de plus de 24 h se redemande
    const total = robots + urls.length;
    return { total, detail: `robots.txt ${robots} + originaux ${urls.length}`, secondes: total * 6, plafondTotal, dejaAuCache: HOTE.nbCache(F.cache) };
}

async function lancer(def, args = process.argv.slice(2)) {
    const refus = verifierArguments(args);
    if (refus) { console.error(`❌ ${refus}`); process.exitCode = 2; return; }
    const { CODE, SRC } = def;
    const mode = MODES.find(m => args.includes(m));
    const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
    try {
        const dossier = RC.verifierChemin(val('dossier') ?? def.DOSSIER);
        const F = fichiersDe(CODE, dossier, val('cache'));
        const plafondTotal = Number(val('plafond') ?? 0);
        const lirePlan = () => { const p = RC.lireJson(F.plan, null); if (!p?.unites) throw new Error(`${F.plan} absent : lancer --plan d'abord`); return p; };
        // T4 : un fournisseur peut élargir ce qui se TÉLÉCHARGE (`def.aTelecharger` : les visuels qu'on lit sans pouvoir les écrire) ; l'écriture, elle, refuse ce que RC.ecrire écarte (`ecrivable: false`)
        const aFaireDe = plan => (def.aTelecharger ? def.aTelecharger(plan, { indexImages: RC.lireJson(F.images, {}) }) : plan.unites.filter(u => u.decision?.action === 'ajouter'));

        if (mode === '--releve') {
            const rel = RC.lireJson(F.releves, {});
            const m = def.maximumReleve({ F, releves: rel, plafondTotal, dossier });
            console.log(`MAXIMUM de ce lancement : ${m.total} requête(s) (${m.detail}) · cadence ≥ 6 s ⇒ ${m.secondes} s au plus · plafond total ${plafondTotal} (déjà au cache : ${m.dejaAuCache}) · ${def.hotesLibelle}`);
            const r = await def.releve({ cli: def.clientDe(F, plafondTotal), fichier: F.releves, dossier });
            console.log(`RELEVÉ : ${r.etat} · ${r.requetes} requête(s) ce passage ${JSON.stringify(r.requetesParHote)} codes ${JSON.stringify(r.codes)} · erreurs serveur sautées ${r.transitoires} · ${r.resume}${r.motif ? ` · ${r.motif}` : ''}`);
            process.exitCode = ['termine', 'plafond', 'deja-synchronise', 'rien-de-neuf'].includes(r.etat) ? 0 : 1;
            return;
        }
        if (mode === '--telecharger') {
            // `--limite=N` : un ÉCHANTILLON (déterministe, en tourniquet sur les groupes) pour faire d'abord le chemin complet sur peu de produits ; sans lui, tout le lot
            const toutes = aFaireDe(lirePlan()), aFaire = val('limite') ? RC.choisirEchantillon(toutes, Number(val('limite'))) : toutes, idx = RC.lireJson(F.images, {});
            const m = maximumImages({ F, hoteImages: def.hoteImages, unites: aFaire, indexImages: idx, plafondTotal });
            const arret = RH.hoteArrete(RH.hoteRacine(def.hoteImages));
            console.log(`MAXIMUM de ce lancement : ${arret ? `0 requête (⛔ arrêt durable de l'hôte, ${arret.motif ?? 'illisible'} : rien ne partira ; sans lui : ${m.total})` : `${m.total} requête(s) (${m.detail})`} · cadence ≥ 6 s ⇒ ${arret ? 0 : m.secondes} s au plus · plafond total ${m.plafondTotal} (déjà au cache : ${m.dejaAuCache}) · hôte ${def.hoteImages}${!arret && m.secondes > 600 ? ` · > 10 min : à lancer en arrière-plan (fichier de progression ${F.progression})` : ''}`);
            if (m.total + m.dejaAuCache > plafondTotal) console.log(`⚠️ le maximum dépasse le plafond total : le lancement s'arrêtera au plafond (${plafondTotal}), reprise à la relance`);
            const cli = def.clientDe(F, plafondTotal);
            const r = await RC.telecharger({ SRC, unites: aFaire, cli, fichier: F.images, hoteImages: def.hoteImages, progression: F.progression });
            console.log(`TÉLÉCHARGEMENT : ${r.etat} · ${r.requetes} requête(s) ce passage ${JSON.stringify(cli.requetesParHote())} codes ${JSON.stringify(cli.codes())} · erreurs serveur sautées ${r.transitoires} · adresses ${r.adresses} · ${JSON.stringify(r.parStatut)} · restantes ${r.restantes}${r.motif ? ` · ${r.motif}` : ''}`);
            if (r.tropPetits.length) console.log(`   trop-petit (largeur < ${largeurMinDe(SRC.SOURCE)}) : ${JSON.stringify(r.tropPetits.slice(0, 20))}`);
            process.exitCode = r.etat === 'termine' || r.etat === 'plafond' ? 0 : 1;
            return;
        }
        const { ouvrirLecture } = require('./ouvrir-lecture');
        const lectureOuRefus = async quoi => { const l = await ouvrirLecture(); if (!l) throw new Error(`MONGODB_CARTES_LECTURE_URI absente : ${quoi} ne lit que par la connexion de lecture seule — refus, aucune connexion ouverte`); return l; };
        if (mode === '--plan') {
            const lecture = await lectureOuRefus('le plan');
            // T4 : la jointure du catalogue complet lit aussi la production (numéros, noms de produits) — EN LECTURE SEULE (garde.ouvrirConnexions({ lectureSeule: true }))
            const cx = def.avecProduction ? await require('./garde').ouvrirConnexions({ production: true, buckets: [], lectureSeule: true }) : null;
            try {
                const plan = await def.construirePlan({ db: lecture.cartes.db, prod: cx?.prod?.db ?? null, releves: RC.lireJson(F.releves, {}), fichiers: F });
                RC.ecrireJson(F.plan, plan);
                console.log(JSON.stringify(plan.resume, null, 1));
                console.log(`→ ${F.plan} (${plan.unites.length} unités, ${plan.restes.length} restes)`);
            } finally { await lecture.fermer(); await cx?.fermer(); }
            return;
        }
        const plan = lirePlan(), aFaire = aFaireDe(plan), indexImages = RC.lireJson(F.images, {});
        const basse = args.includes('--basse-definition');
        if (mode === '--manifeste') {
            if (typeof def.manifeste !== 'function') throw new Error(`${CODE} : pas de manifeste de lecture pour cette source`);
            const r = await def.manifeste({ plan, unites: aFaire, indexImages, dossierCache: F.cache, dossier });
            console.log(`MANIFESTE : ${r.fichier} · ${r.entrees} entrée(s) à lire (champs « lu » VIDES) · sans image au cache ${r.sansImage} · ${JSON.stringify(r.parGroupe)}`);
            return;
        }
        if (mode === '--planche') {
            const r = await RC.planches({ SRC, unites: aFaire, indexImages, dossierCache: F.cache, sortieDossier: dossier, n: Number(val('echantillon') ?? 50), basseDefinition: basse, prefixe: `planche-${CODE}${basse ? '-basse' : ''}` });
            console.log(`PLANCHES : ${r.images} image(s) · ${JSON.stringify(r.parGroupe)} · ${r.planches.join(' ; ')} (à REGARDER avant --ecrire)`);
            return;
        }
        if (mode === '--compter') {
            const lecture = await lectureOuRefus('--compter');
            try {
                const r = await RC.ecrire({ SRC, unites: aFaire, M: { Carte: { db: { db: lecture.cartes.db } } }, dossierCache: F.cache, indexImages, compterSeulement: true, basseDefinition: basse, lecteur: RC.lecteurNatif(lecture.cartes.db) });
                console.log(`COMPTE${basse ? ' BASSE DÉFINITION' : ''} : --attendu=${r.reel} (cédées ${r.cedees}, déjà posées ${r.dejaPosees}, écartées ${r.ecartees}, trop petites ${r.tropPetits}, hors cache ${r.horsCache}, altérées ${r.altere}, retirées ${r.retires})`);
            } finally { await lecture.fermer(); }
            return;
        }
        if (mode === '--retirer') {
            const { planLu } = require('../retirer-visuels-recolte');
            const lecture = await lectureOuRefus('--retirer (à blanc)');
            try {
                const p = await planLu(lecture.cartes.db, SRC);
                console.log(`RETRAIT À BLANC (source ${SRC.SOURCE}, lot ${SRC.LOT}) : ${p.cartes.length} cartes portent ${p.entrees} entrées · ${p.docs} documents « images » non retirés · ${p.cles.length} clés R2 (images et vignettes) · par set ${JSON.stringify(p.parSet)}`);
                console.log(`   écriture (sur demande du testeur) : node lot-additif.js --quoi="retrait de la source ${SRC.SOURCE}" --collections=cartes,images,sets --annonce=<annonce> -- node retirer-visuels-recolte.js --source=${SRC.SOURCE} --ecrire`);
            } finally { await lecture.fermer(); }
            return;
        }
        // --ecrire : seulement sous lot-additif.js, AUCUNE requête
        require('./images-empruntees').garderSousLot(process.env, process.ppid);
        if (def.ecritureFermee) { console.log('ÉCRITURE FERMÉE : '+def.ecritureFermee+' · attendu '+val('attendu')+' · écrit 0 · REQUÊTES 0'); return; }
        const { ouvrirConnexions } = require('./garde');
        const { modeles } = require('./schemas');
        const r2 = require('./r2');
        const { vignetterApresJointure } = require('./vignettes-apres-jointure');
        const { fabriquerVerrou } = require('./verrou-source');
        if (!process.env.R2_BUCKET_IMAGES) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune écriture');
        const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
        try {
            await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
            const r = await RC.ecrire({ SRC, unites: aFaire, M: modeles(cx), dossierCache: F.cache, indexImages, attendu: Number(val('attendu')), basseDefinition: basse, deposer: (b, c, d, t) => r2.deposerBinaire(b, c, d, t), vignetter: vignetterApresJointure,
                fabriquerVerrouSet: ({ Modele, id }) => fabriquerVerrou({ Modele, id, dureeMs: 10 * 60 * 1000, surInsertion: { debute: new Date(), phase: 'plan' }, nom: `verrou de set ${id}` }) });
            console.log(`ÉCRITURE : code ${r.code} · attendu ${r.attendu} · unités à ajouter (réel) ${r.reel} · écartées ${r.ecartees} · cédées ${r.cedees} · hors cache ${r.horsCache} · altérées ${r.altere} · orphelins R2 ${r.orphelins?.length ?? 0} · REQUÊTES 0`);
            process.exitCode = r.code;
        } finally { await fermer(); }
    } catch (e) { console.error('❌', e.message); process.exitCode = 1; }
}

module.exports = { lancer, verifierArguments, fichiersDe, maximumImages, AUTORISES, MODES };
