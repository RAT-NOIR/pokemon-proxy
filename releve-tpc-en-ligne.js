// ============================================================
// PHASE 3a — LA LISTE ET LES FICHES NOUVELLES D'UN SET TPC (pokemon-card.com ou TPC Asie), lues EN LIGNE, pour servir de seconde source
// ============================================================
//   node releve-tpc-en-ligne.js --site=pokemon-card-com --langue=ja --code=M-P --max=44 --compteur=<fichier>.json --sortie=<fichier>.json
// Décision du testeur (2026-10-24) : les sources déjà ouvertes en ligne se lisent à rythme lent (≥ 5 s par hôte), identité honnête, sans cookie. Ce relevé passe par le client du dépôt
// (`fabriquerClientTpc` : robots.txt relu avant toute page, cadence 10 s, un réessai, 403/429/défi → BLOQUÉ et plus aucune requête, pause persistante respectée) et, comme le collecteur et son mode
// `--plan-reel` (collecteur-images-tpc.js), il :
//   · SORT (code 1, aucune requête) si une alerte « source bloquée » est ACTIVE pour le site ;
//   · PREND réellement le verrou global de la source (pris puis rendu, même en cas d'erreur) — il écrit donc ce seul document dans `collecte_images_etat`, rien d'autre ; tenu par un autre, il sort ;
//   · CUMULE son plafond `--max` SUR LA JOURNÉE (UTC) dans `--compteur` : le client refuse la requête n° max + 1 de la journée, tous lancements confondus ; le compte est écrit après CHAQUE requête.
// Les fiches déjà en cache (`tpc_fiches`, lecture) ne sont pas redemandées ; le résultat est un fichier local (écrit à chaque fiche lue : un arrêt ne perd pas ce qui a coûté une requête).
// Il n'écrit ni `tpc_fiches` ni `cartes`. ⚠️ Prendre le verrou est une ÉCRITURE : il ne tourne pas sous lancer-a-blanc.js (lecture seule) ; c'est le coordinateur qui le lance.
const fs = require('fs');
const path = require('path');
const T = require('./collecte-cartes/tpc');
const { jourUtc, lireCompteur, ecrireCompteur } = require('./collecte-cartes/compteur-jour');

const AUTORISES = [/^--site=(pokemon-card-com|tpc-asie)$/, /^--langue=(ja|id|th|tw)$/, /^--code=[\w.-]+$/, /^--max=\d{1,3}$/, /^--compteur=.+\.json$/, /^--sortie=.+\.json$/];
// les adresses sont celles du collecteur du dépôt (collecteur-images-tpc.js : urlListe, urlFiche), recopiées mot pour mot — le banc du collecteur les fige
const urlListe = (site, langue, code, page) => site === 'tpc-asie'
    ? `/${langue}/card-search/list/?${page > 1 ? `pageNo=${page}&` : ''}expansionCodes=${encodeURIComponent(code)}`
    : `/card-search/resultAPI.php?keyword=&se_ta=&regulation_sidebar_form=all&pg=${encodeURIComponent(code)}&illust=&sm_and_keyword=true&page=${page}`;
const urlFiche = (site, langue, id) => site === 'tpc-asie' ? `/${langue}/card-search/detail/${id}/` : `/card-search/details.php/card/${id}/regu/all`;

/**
 * @param {object} o
 * @param {string[]} o.argv
 * @param {()=>Promise<{db: object, fermer: ()=>Promise}>} o.ouvrir  ouvre la base `cartes` (écriture : le verrou)
 * @param {(base:object, site:string)=>{prendre:()=>Promise<object|null>, rendre:()=>Promise, tenu:boolean, perdu:boolean}} o.verrouDe  le verrou global de la source
 * @param {(opts:object)=>object} [o.clientDe]  fabriquerClientTpc (injecté par les bancs avec un faux transport)
 * @returns {Promise<number>} le code de sortie
 */
async function executer({ argv, ouvrir, verrouDe, clientDe = T.fabriquerClientTpc, jour = jourUtc(), io = {}, log = console.log, err = console.error }) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) || null;
    const SITE = arg('site'), LANGUE = arg('langue'), CODE = arg('code'), MAX = Number(arg('max')), COMPTEUR = arg('compteur'), SORTIE = arg('sortie');
    if (!SITE || !LANGUE || !CODE || !SORTIE || !COMPTEUR || !Number.isInteger(MAX) || MAX < 1) { err('❌ --site, --langue, --code, --max (≥ 1), --compteur et --sortie obligatoires'); return 2; }
    if (!T.SITES[SITE].langues[LANGUE]) { err(`❌ la langue ${LANGUE} n'est pas une langue de ${SITE}`); return 2; }
    // le compte du jour est lu AVANT toute connexion : illisible = je ne pars pas ; plafond déjà atteint = aucune requête, aucun verrou
    let compteInitial;
    try { compteInitial = lireCompteur(COMPTEUR, SITE, jour, io); } catch (e) { err(`❌ ${e.message}`); return 2; }
    if (compteInitial >= MAX) { err(`⛔ le plafond du jour est atteint (${compteInitial} requêtes déjà faites aujourd'hui chez ${SITE}, --max=${MAX}) — aucune requête`); return 1; }

    const base = await ouvrir(), { db, fermer } = base;
    let verrou = null, pris = false;
    try {
        const alerte = await db.collection('collecte_images_etat').findOne({ _id: T.idAlerteBloquee(SITE), active: true });
        if (alerte) { err(`⛔ ${SITE} a bloqué (${alerte.motif ?? 'motif non écrit'}) — alerte ACTIVE, aucune requête`); return 1; }
        verrou = verrouDe(base, SITE);
        const tenuPar = await verrou.prendre();
        if (tenuPar) { err(`⛔ verrou global ${SITE} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote} (battement il y a ${tenuPar.ageS} s) — aucune requête`); return 1; }
        pris = true;
        log(`   verrou global ${SITE} PRIS · requêtes déjà faites aujourd'hui : ${compteInitial} / ${MAX}`);
        const client = clientDe({ site: SITE, verrou, plafond: MAX, compteInitial, surRequete: n => ecrireCompteur(COMPTEUR, SITE, n, jour, io) });
        // 1. la liste
        const ids = []; let total = null, pages = null;
        for (let p = 1; p <= 40; p++) {
            if (SITE === 'tpc-asie') { const h = await client.page(urlListe(SITE, LANGUE, CODE, p)); if (h == null) break; const x = T.lireListeAsie(h); if (p === 1) { total = x.total; pages = x.pages; } for (const i of x.ids) if (!ids.includes(String(i))) ids.push(String(i)); if (!x.ids.length || (pages && p >= pages)) break; }
            else { const j = await client.json(urlListe(SITE, LANGUE, CODE, p)); if (j == null) break; const x = T.lireApiPcc(j); if (p === 1) { total = x.total; pages = x.pages; } for (const c of x.cartes) if (!ids.includes(c.id)) ids.push(c.id); if (!x.cartes.length || (pages && p >= pages)) break; }
        }
        log(`   liste ${CODE} (${SITE}/${LANGUE}) : ${ids.length} ids sur ${total} annoncés, ${pages} page(s) · requêtes du jour ${client.compteRequetes()}`);
        // 2. les fiches : le cache d'abord (lecture), puis les inconnues, dans la limite du plafond du JOUR
        const cle = id => `${SITE}/${LANGUE}/${id}`;
        const connues = new Map((await db.collection('tpc_fiches').find({ _id: { $in: ids.map(cle) } }).toArray()).map(d => [d._id, d]));
        const inconnues = ids.filter(id => !connues.has(cle(id)));
        log(`   fiches en cache ${connues.size}/${ids.length} · à lire ${inconnues.length} (plafond du jour ${MAX}, déjà ${client.compteRequetes()} requêtes)`);
        const fiches = [...connues.values()].map(d => ({ idFiche: d.idFiche, ...d.fiche, cache: true }));
        let arret = null;
        fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
        // écrit à chaque fiche lue : un arrêt, un plafond ou une panne ne perd jamais ce qui a déjà coûté une requête à la source
        const ecrire = () => fs.writeFileSync(SORTIE, JSON.stringify({ le: new Date().toISOString(), site: SITE, langue: LANGUE, code: CODE, total, pages, ids, requetes: client.compteRequetes(), statuts: client.statuts(), arret, fiches }));
        ecrire();
        for (const id of inconnues) {
            try {
                const h = await client.page(urlFiche(SITE, LANGUE, id));
                if (h == null) { log(`   fiche ${id} : 404`); continue; }
                fiches.push({ idFiche: id, ...(SITE === 'tpc-asie' ? T.lireFicheAsie(h) : T.lireFichePcc(h)), cache: false, url: `${T.SITES[SITE].hote}${urlFiche(SITE, LANGUE, id)}` });
                ecrire();
            } catch (e) { arret = e.message; log(`   arrêt : ${e.message}`); break; }
        }
        ecrire();
        log(`   requêtes du jour ${client.compteRequetes()} / ${MAX} · statuts ${JSON.stringify(client.statuts())} · ${fiches.length} fiches écrites dans ${SORTIE}`);
        return arret ? 1 : 0;
    } catch (e) {
        err(`❌ ${e.message}`);
        return 1;
    } finally {
        // le verrou se RENDRE toujours, même sur une erreur ou une sortie anticipée
        if (pris && verrou) { try { await verrou.rendre(); } catch (e) { err(`⚠️ le verrou n'a pas pu être rendu : ${e.message}`); } }
        await fermer();
    }
}

module.exports = { executer, urlListe, urlFiche };

if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { modeles } = require('./collecte-cartes/schemas');
        const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
        const code = await executer({
            argv: process.argv.slice(2),
            ouvrir: async () => { const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [] }); return { db: cartes.db, cx: cartes, fermer }; },
            verrouDe: ({ cx }, site) => fabriquerVerrou({ Modele: modeles(cx).EtatImages, id: T.SITES[site].verrou, dureeMs: T.VERROU_GLOBAL_MS, surInsertion: { phase: 'collecteur' }, surPerte: () => { process.exitCode = 1; }, nom: `verrou global ${site}` })
        });
        process.exit(code || process.exitCode || 0);
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
