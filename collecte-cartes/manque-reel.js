// ============================================================
// LE MANQUE RÉEL, CARTE PAR CARTE — ce qu'une source SERT et que nous n'avons JAMAIS tenté (2026-09-26, soir)
// ============================================================
// 🔴 LA DEMANDE (testeur) : « Tu dis qu'il n'y a plus rien à collecter : c'est contradictoire. » L'alimentateur comptait par
// SET (`images.set`) : une carte qui a UNE image dans le set, à un AUTRE numéro, faisait passer le set pour servi. White
// Flare et Black Bolt : 21 scans que TCGdex sert (Victini n°172, Litwick n°016 et n°101…), jamais demandés, parce que leurs
// unités avaient tourné le 24/09, avant la recollecte du texte du 25/09 — et que le compte par set ne voyait plus de manque.
// « L'alimentateur doit tirer son travail de ce manque réel, carte par carte, et plus seulement des unités déclarées. »
//
// 🔑 LA QUESTION EST POSÉE À LA SOURCE, AVEC LE PLAN MÊME QUE L'UNITÉ EXÉCUTERA : `planifier` du collecteur TCGdex (zéro
// requête : le cache `tcgdex_sets`), puis « quelles impressions de ce plan n'ont AUCUN document `images` ? ». Pas de copie
// de la règle (§21 bis) : l'identifiant d'image est celui du collecteur (`idImageTcgdex`, qu'il importe d'ici).
// PAS DE BOUCLE, PAR CONSTRUCTION : le collecteur écrit un document pour TOUTE impression tentée (ok, trop-petit, échec) ;
// une unité passée rend donc tout son plan « tenté », et le manque d'un set qui a tourné retombe à zéro. Et si une
// impression restait sans document, la CLÉ du manque (l'empreinte de l'ensemble exact) ne sert qu'une fois (`alimCause`).
// Un set TCGdex jamais lu est lui aussi du travail : l'unité le lira (clé `nonlu`, une fois).
const crypto = require('crypto');
const { echecTransitoire } = require('./issue-unite');
/** Un document `images` porte-t-il un VERDICT sur son impression ? Tout, sauf un échec passager (5xx, réseau). */
const estTentee = doc => !!doc && !(doc.etat === 'echec' && echecTransitoire({ message: doc.erreur }));

const SOURCE_TCGDEX = 'tcgdex';
// l'identifiant du document `images` d'une impression TCGdex : le numéro ENTIER (TG01 ≠ 1)
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';
const idImageTcgdex = (slug, carteId, numero) => `${SOURCE_TCGDEX}/${slug}/${carteId}/${cleNum(numero)}`;
// 🔴 LA CLÉ PORTE LA VERSION DU CODE (revue du 2026-09-26) : une unité passée sous un code qui ne SAVAIT PAS faire le travail
// (Arceus avant le préfixe « Platinum: », Hidden Fates avant le compagnon « Shiny Vault ») aurait consommé la clé, et le code
// qui sait l'aurait trouvée « déjà reprise » — 205 impressions bloquées pour toujours. Un redéploiement est une cause neuve.
const cleDuManque = (elements, version) => `${SOURCE_TCGDEX}:${crypto.createHash('sha1').update([...elements].sort().join('\n')).digest('hex').slice(0, 16)}@${version ?? 'inconnue'}`;

/**
 * Le manque TCGdex de chaque ligne occidentale qui nomme un set TCGdex. `version` : le commit du code qui EXÉCUTERA les unités.
 * @returns {Promise<{ manques: object[], examinees: number, avecSet: number, lues: number }>}
 */
async function manqueTcgdex(M, db, { lignes, liste, version = null }) {
    const { planifier } = require('../collecteur-images-tcgdex');          // paresseux : le collecteur importe ce module
    const { fabriquerAppariement, setDeLaLigne } = require('./tcgdex-cache');
    if (!liste?.length) throw new Error('liste TCGdex absente du cache — le manque TCGdex ne peut pas se mesurer');
    const apparier = fabriquerAppariement(liste);
    const manques = [];
    let examinees = 0, avecSet = 0, lues = 0;
    for (const L of lignes) {
        examinees++;
        const d = setDeLaLigne(L, apparier);
        if (!d.set) continue;
        avecSet++;
        const P = await planifier(M, db, null, L, d.set);
        const base = { slug: L.slugSet, code: L.code, tcgdexSet: d.set.id, tcgdexNom: d.set.name };
        if (!P) { manques.push({ ...base, n: 0, nonLu: true, cle: cleDuManque([`nonlu:${d.set.id}`], version) }); continue; }
        lues++;
        const ids = P.plan.map(p => idImageTcgdex(L.slugSet, p.carte._id, p.numero));
        // « tentée » = un document `images` qui porte un VERDICT : ok, trop-petit, ou un échec définitif (404…). Un échec PASSAGER
        // (5xx, réseau — la règle d'issue-unite.js, pas une copie) n'est pas un verdict sur l'impression : il reste dans le manque
        // (revue du 2026-09-26 : un 503 bloquait l'impression pour toujours après 3 passages). La clé borne la reprise : même
        // ensemble, même code → une seule fois.
        const docs = ids.length ? await db.collection('images').find({ _id: { $in: ids } }, { projection: { _id: 1, etat: 1, erreur: 1 } }).toArray() : [];
        const vus = new Set(docs.filter(estTentee).map(x => x._id));
        const manquent = [...new Set(ids.filter(i => !vus.has(i)))].sort();
        // une GALERIE compagnon jamais lue (revue du 2026-09-26 : Shining Fates Shiny Vault, 122 impressions « NON MESURÉ ») est
        // du travail : l'unité la lira. Sans cela le manque valait 0 et aucune unité ne naissait jamais.
        const nonLus = P.compagnonsNonLus || [];
        if (!manquent.length && !nonLus.length) continue;
        manques.push({ ...base, n: manquent.length, ...(nonLus.length ? { nonLus } : {}), cle: cleDuManque([...manquent, ...nonLus.map(i => `nonlu:${i}`)], version), exemples: manquent.slice(0, 3) });
    }
    return { manques, examinees, avecSet, lues };
}

/**
 * La décision, pure : une unité `tcgdex/<code>` par set qui a un manque, du plus gros au plus petit.
 * Absente → insérée ; en attente → rien ; passée → reprise UNE fois par clé de manque.
 */
// 🔴 TROISIÈME RELECTURE (2026-09-26, nuit) : `alimCause` ne gardait que la DERNIÈRE clé. Deux ensembles qui alternent (un fichier en
// 503 tantôt, l'autre ensuite) reprenaient l'unité à chaque mesure, sans fin : 3 passages et 3 revalidations chaque fois. Une unité
// garde l'HISTORIQUE de ses clés (`alimCauses`), et au plus MAX_REPRISES_PAR_VERSION reprises par le manque réel sous un même code.
const MAX_REPRISES_PAR_VERSION = 3;
const versionDeCle = k => String(k).split('@').pop();

function choisirManqueReel({ manques, unites, max = 10 }) {
    const inserer = [], reprendre = [], ecartes = [];
    // 🔴 revue du 2026-09-26 : deux lignes (deux slugs) sous un même code font UNE unité `tcgdex/<code>`. Choisies séparément, leurs
    // deux clés s'écraseraient l'une l'autre dans `alimCause` à chaque tour — une boucle. Elles se fusionnent : une clé sur l'ensemble.
    const parId = new Map();
    for (const m of manques) (parId.get(m.code) || parId.set(m.code, []).get(m.code)).push(m);
    const fusion = [...parId.values()].map(ms => ms.length === 1 ? ms[0] : {
        ...ms[0], n: ms.reduce((s, x) => s + x.n, 0), nonLu: ms.every(x => x.nonLu), nonLus: [...new Set(ms.flatMap(x => x.nonLus || []))],
        cle: `${SOURCE_TCGDEX}:groupe:${crypto.createHash('sha1').update(ms.map(x => x.cle).sort().join('\n')).digest('hex').slice(0, 16)}@${versionDeCle(ms.map(x => x.cle).sort()[0])}`,
        slug: ms.map(x => x.slug).join('+')
    });
    for (const m of fusion.sort((a, b) => b.n - a.n)) {
        if (inserer.length + reprendre.length >= max) break;
        const _id = `${SOURCE_TCGDEX}/${m.code}`;
        const cause = m.nonLu ? `set TCGdex ${m.tcgdexSet} jamais lu — l'unité le lira`
            : [m.n ? `${m.n} impression(s) que TCGdex sert (${m.tcgdexSet}), jamais tentée(s)` : null, m.nonLus?.length ? `galerie(s) TCGdex ${m.nonLus.join(', ')} jamais lue(s) — l'unité la lira` : null].filter(Boolean).join(' ; ');
        const u = unites.get(_id);
        if (!u) { inserer.push({ _id, code: m.code, source: SOURCE_TCGDEX, tcgdexSet: m.tcgdexSet, tcgdexNom: m.tcgdexNom, alimCause: m.cle, alimCauses: [m.cle], slug: m.slug, sans: m.n, ajouteMotif: `alimentateur : ${cause}` }); continue; }
        if (u.etat === 'attente' || u.etat === 'en-cours') continue;
        const vues = [...new Set([...(Array.isArray(u.alimCauses) ? u.alimCauses : []), ...(u.alimCause ? [u.alimCause] : [])])];
        if (vues.includes(m.cle)) { ecartes.push({ slug: m.slug, raison: `${_id} a déjà été repris pour ce manque exact (${m.cle})` }); continue; }
        const sousCetteVersion = vues.filter(k => String(k).startsWith(`${SOURCE_TCGDEX}:`) && versionDeCle(k) === versionDeCle(m.cle)).length;
        if (sousCetteVersion >= MAX_REPRISES_PAR_VERSION) { ecartes.push({ slug: m.slug, raison: `${_id} déjà repris ${sousCetteVersion} fois par le manque réel sous ce code (${versionDeCle(m.cle)}) : plafond atteint, le manque change sans se résorber` }); continue; }
        // la reprise réécrit aussi le set TCGdex : une ligne de table qui a changé de set depuis l'insertion ne garde pas l'ancien
        reprendre.push({ _id, source: SOURCE_TCGDEX, slug: m.slug, sans: m.n, etatAvant: u.etat, causeCle: m.cle, causesAvant: vues, cause, tcgdexSet: m.tcgdexSet, tcgdexNom: m.tcgdexNom });
    }
    return { inserer, reprendre, ecartes };
}

module.exports = { idImageTcgdex, cleDuManque, manqueTcgdex, choisirManqueReel, estTentee, SOURCE_TCGDEX, MAX_REPRISES_PAR_VERSION };
