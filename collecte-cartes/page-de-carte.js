// ============================================================
// UNE PAGE RENDUE PAR BULBAPEDIA N'EST PAS FORCÉMENT UNE CARTE — la décision, puis l'écriture (R4, 2026-10-12)
// ============================================================
// LA CAUSE : `collecteur-texte.js` upsertait chaque page rendue pour un titre de Setlist avec `$addToSet: { sets: slug }`, sans
// regarder ce qu'elle était. Une page d'HOMONYMIE (`{{disambig}}`, `{{tcgdisambig}}`) entrait ainsi dans le set : 6 documents sans nom,
// 12 appartenances dans 9 sets, 0 impression, 0 produit joint. `joindre()` les refusait déjà (« une page sans nom n'est pas une
// carte ») ; la collecte, elle, continuait de les inscrire.
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : une page n'est écrite comme carte que si elle porte un NOM et n'est pas une homonymie.
// (Mesuré avant de câbler : les 6 seuls documents sans `nomEn` des 17 096 de la base sont les 6 homonymies — le critère « un nom »
// ne coûte aucune carte réelle.) Les gabarits d'homonymie sont énumérés en plus pour que le MOTIF écrit soit le bon.
const { epurer, faitsDeCarte, gabarits } = require('./wikitext');
const { reporterChampsPoses } = require('./impressions-posees');
const { rareteDeLaCarte } = require('./champs-du-rejeu');

const GABARITS_HOMONYMIE = new Set(['disambig', 'tcgdisambig']);

/** La page porte-t-elle un gabarit d'homonymie de premier niveau (commentaires ôtés, casse et espaces ignorés) ? */
function estPageDHomonymie(texte) {
    if (typeof texte !== 'string' || !texte) return false;
    return gabarits(texte).some(g => GABARITS_HOMONYMIE.has(String(g.nom).trim().toLowerCase().replace(/\s+/g, '')));
}

/** @returns {{carte: true} | {carte: false, motif: 'homonymie'|'sans-nom'}} */
function decisionDePage(contenu, titre) {
    if (estPageDHomonymie(contenu)) return { carte: false, motif: 'homonymie' };
    if (!faitsDeCarte(contenu, titre).nomEn) return { carte: false, motif: 'sans-nom' };
    return { carte: true };
}

/**
 * Écrit UNE page rendue par Bulbapedia : sa copie R2 puis sa carte (`cartes`), ou — si ce n'est pas une carte — rien d'autre
 * qu'un reste et l'état (le titre n'est pas redemandé au lancement suivant).
 * @returns {Promise<{ecrite: boolean, r2Ecrit?: boolean, motif?: string}>}
 */
async function ecrirePageDeCarte({ M, r2, bucket, pg, slug, lot, redirigeDepuisTout, D, textesEpures, compter, impressionCible, compteRequetes }) {
    // l'état APRÈS l'unité : les titres du lot qui ont mené à cette page (cible + redirigés)
    const titresDeCettePage = [pg.title, ...(redirigeDepuisTout.get(pg.title) || [])].filter(t => lot.includes(t));
    const decision = decisionDePage(pg.content, pg.title);
    if (decision.motif === 'sans-nom') {
        // RÉCUPÉRABLE : une page sans nom qui n'est pas une homonymie (ébauche, gabarit neuf) ne devient pas une carte, mais rien n'en est perdu —
        // son wikitext est déposé sur R2 comme les autres, et son titre n'est PAS marqué « fait » dans l'état : la prochaine collecte le redemande.
        D.pagesSansNom = (D.pagesSansNom || 0) + 1;
        await r2.deposerTexte(bucket, r2.cleWikitext(pg.pageid, pg.revid), epurer(pg.content, D.epure));
        await M.Reste.updateOne({ set: slug, type: 'page-sans-carte', detail: pg.title }, { $set: { motif: 'sans-nom', le: new Date() } }, { upsert: true });
        return { ecrite: false, motif: 'sans-nom' };
    }
    if (!decision.carte) {
        // HOMONYMIE PROUVÉE ({{disambig}}, {{tcgdisambig}}) : jamais une carte, jamais dans `sets` ; le titre est marqué fait (rien à redemander).
        D.pagesHomonymie = (D.pagesHomonymie || 0) + 1;
        await M.Reste.updateOne({ set: slug, type: 'page-sans-carte', detail: pg.title }, { $set: { motif: decision.motif, le: new Date() } }, { upsert: true });
        await M.Etat.updateOne({ _id: slug }, {
            $push: { pages: { $each: titresDeCettePage.map(t => ({ titre: t, pageid: pg.pageid, revid: pg.revid, etat: decision.motif })) } },
            $set: { phase: 'texte', derniereRequete: new Date(), requetes: compteRequetes() }
        });
        return { ecrite: false, motif: decision.motif };
    }
    const epure = epurer(pg.content, D.epure);
    const cle = r2.cleWikitext(pg.pageid, pg.revid);
    const depot = await r2.deposerTexte(bucket, cle, epure);   // R2 AVANT la ligne
    const faits = faitsDeCarte(pg.content, pg.title);
    compter(faits);
    const impCible = impressionCible(faits);
    const { champsNuls, ...champs } = faits;
    // 🔴 une page déjà en base porte des illustrateurs POSÉS APRÈS le parseur : le `$set` du tableau les effaçait
    // (2 179 perdus le 2026-09-24, recollectes de xASC et HSP). Ils se reportent par la clé de l'impression.
    // 🔴 PHASE 3b : la rareté en base ne s'écrase pas par null non plus (collecte-cartes/champs-du-rejeu.js : la page la remplace si elle en donne une)
    const enBase = await M.Carte.findById(pg.pageid).select('impressions rarete').lean();
    const P = reporterChampsPoses(enBase?.impressions, champs.impressions);
    champs.impressions = P.impressions; D.posesReportes = (D.posesReportes || 0) + P.reportes; D.posesPerdus = (D.posesPerdus || 0) + P.perdus;
    await M.Carte.updateOne({ _id: pg.pageid }, {
        $set: {
            ...champs, rarete: rareteDeLaCarte(impCible, enBase?.rarete), champsNuls,
            bulba: { titre: pg.title, pageid: pg.pageid, revid: pg.revid, redirigeDepuis: redirigeDepuisTout.get(pg.title) || [], cleR2: cle },
            collecteLe: new Date()
        },
        $addToSet: { sets: slug }, $setOnInsert: { version: 1, liens: { idProduct: [], idMetacards: [] } }
    }, { upsert: true });
    textesEpures.set(pg.pageid, epure);
    await M.Etat.updateOne({ _id: slug }, {
        $push: { pages: { $each: titresDeCettePage.map(t => ({ titre: t, pageid: pg.pageid, revid: pg.revid, etat: 'ok' })) } },
        $set: { phase: 'texte', derniereRequete: new Date(), requetes: compteRequetes() }
    });
    return { ecrite: true, r2Ecrit: !!depot.ecrit };
}

module.exports = { estPageDHomonymie, decisionDePage, ecrirePageDeCarte, GABARITS_HOMONYMIE };
