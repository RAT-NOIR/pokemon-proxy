// ============================================================
// PHASE 3a — LA LISTE ET LES FICHES NOUVELLES D'UN SET TPC (pokemon-card.com ou TPC Asie), lues EN LIGNE, pour servir de seconde source (aucune écriture en base)
// ============================================================
//   node lancer-a-blanc.js releve-tpc-en-ligne.js --site=pokemon-card-com --langue=ja --code=M-P --max=30 --sortie=<fichier>.json
// Décision du testeur (2026-10-24) : les sources déjà ouvertes en ligne se lisent à rythme lent (≥ 5 s par hôte), identité honnête, sans cookie. Ce relevé passe par le client du dépôt
// (`fabriquerClientTpc` : robots.txt relu avant toute page, cadence 10 s, un réessai, 403/429/défi → BLOQUÉ et plus aucune requête, pause persistante respectée), avec un PLAFOND de requêtes
// (`--max`, robots.txt compris) que rien ne dépasse. Les fiches déjà en cache (`tpc_fiches`, lecture) ne sont pas redemandées. Le verrou global de la source est LU (jamais pris, ce serait une
// écriture) : frais, le relevé refuse de partir. Le résultat est un fichier local ; ni `tpc_fiches` ni `cartes` ne sont écrites.
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const T = require('./collecte-cartes/tpc');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const AUTORISES = [/^--site=(pokemon-card-com|tpc-asie)$/, /^--langue=(ja|id|th|tw)$/, /^--code=[\w.-]+$/, /^--max=\d{1,3}$/, /^--sortie=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const SITE = arg('site'), LANGUE = arg('langue'), CODE = arg('code'), MAX = Number(arg('max') || 30), SORTIE = arg('sortie');
if (!SITE || !LANGUE || !CODE || !SORTIE) { console.error('❌ --site, --langue, --code et --sortie obligatoires'); process.exit(2); }
if (!T.SITES[SITE].langues[LANGUE]) { console.error(`❌ la langue ${LANGUE} n'est pas une langue de ${SITE}`); process.exit(2); }
// les adresses sont celles du collecteur du dépôt (collecteur-images-tpc.js : urlListe, urlFiche), recopiées mot pour mot — le banc du collecteur les fige
const urlListe = (page) => SITE === 'tpc-asie'
    ? `/${LANGUE}/card-search/list/?${page > 1 ? `pageNo=${page}&` : ''}expansionCodes=${encodeURIComponent(CODE)}`
    : `/card-search/resultAPI.php?keyword=&se_ta=&regulation_sidebar_form=all&pg=${encodeURIComponent(CODE)}&illust=&sm_and_keyword=true&page=${page}`;
const urlFiche = id => SITE === 'tpc-asie' ? `/${LANGUE}/card-search/detail/${id}/` : `/card-search/details.php/card/${id}/regu/all`;

(async () => {
    const { cartes, fermer } = await ouvrirConnexions({ production: false });
    try {
        const verrou = T.SITES[SITE].verrou;
        const doc = await cartes.db.collection('collecte_images_etat').findOne({ _id: verrou });
        const depuis = doc?.verrou?.depuis ? new Date(doc.verrou.depuis).getTime() : null;
        if (depuis && Date.now() - depuis < T.VERROU_GLOBAL_MS) { console.error(`❌ le verrou ${verrou} est tenu (battement il y a ${Math.round((Date.now() - depuis) / 1000)} s) : aucune requête`); process.exit(1); }
        const alerte = await cartes.db.collection('collecte_images_etat').findOne({ _id: T.idAlerteBloquee(SITE) });
        if (alerte && alerte.active !== false && alerte.resolue !== true) console.log(`   ⚠️ une alerte « source bloquée » existe pour ${SITE} : ${JSON.stringify(alerte).slice(0, 200)}`);
        console.log(`   verrou ${verrou} : libre (${doc ? 'document sans battement frais' : 'aucun document'})`);
        const client = T.fabriquerClientTpc({ site: SITE, verrou: { tenu: true, perdu: false }, plafond: MAX });
        // 1. la liste
        const ids = []; let total = null, pages = null;
        for (let p = 1; p <= 40; p++) {
            if (SITE === 'tpc-asie') { const h = await client.page(urlListe(p)); if (h == null) break; const x = T.lireListeAsie(h); if (p === 1) { total = x.total; pages = x.pages; } for (const i of x.ids) if (!ids.includes(String(i))) ids.push(String(i)); if (!x.ids.length || (pages && p >= pages)) break; }
            else { const j = await client.json(urlListe(p)); if (j == null) break; const x = T.lireApiPcc(j); if (p === 1) { total = x.total; pages = x.pages; } for (const c of x.cartes) if (!ids.includes(c.id)) ids.push(c.id); if (!x.cartes.length || (pages && p >= pages)) break; }
        }
        console.log(`   liste ${CODE} (${SITE}/${LANGUE}) : ${ids.length} ids sur ${total} annoncés, ${pages} page(s) · requêtes ${client.compteRequetes()}`);
        // 2. les fiches : le cache d'abord (lecture), puis les inconnues, dans la limite du plafond
        const cle = id => `${SITE}/${LANGUE}/${id}`;
        const connues = new Map((await cartes.db.collection('tpc_fiches').find({ _id: { $in: ids.map(cle) } }).toArray()).map(d => [d._id, d]));
        const inconnues = ids.filter(id => !connues.has(cle(id)));
        console.log(`   fiches en cache ${connues.size}/${ids.length} · à lire ${inconnues.length} (plafond ${MAX}, déjà ${client.compteRequetes()} requêtes)`);
        const fiches = [...connues.values()].map(d => ({ idFiche: d.idFiche, ...d.fiche, cache: true }));
        let arret = null;
        fs.mkdirSync(require('path').dirname(SORTIE), { recursive: true });
        // le fichier est ÉCRIT à chaque fiche lue : un arrêt, un plafond ou une panne ne perd jamais ce qui a déjà coûté une requête à la source
        const ecrire = () => fs.writeFileSync(SORTIE, JSON.stringify({ le: new Date().toISOString(), site: SITE, langue: LANGUE, code: CODE, total, pages, ids, requetes: client.compteRequetes(), statuts: client.statuts(), arret, fiches }));
        ecrire();
        for (const id of inconnues) {
            try {
                const h = await client.page(urlFiche(id));
                if (h == null) { console.log(`   fiche ${id} : 404`); continue; }
                fiches.push({ idFiche: id, ...(SITE === 'tpc-asie' ? T.lireFicheAsie(h) : T.lireFichePcc(h)), cache: false, url: `${T.SITES[SITE].hote}${urlFiche(id)}` });
                ecrire();
            } catch (e) { arret = e.message; console.log(`   arrêt : ${e.message}`); break; }
        }
        ecrire();
        console.log(`   requêtes ${client.compteRequetes()} · statuts ${JSON.stringify(client.statuts())} · ${fiches.length} fiches écrites dans ${SORTIE}`);
    } finally { await fermer(); }
})().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
