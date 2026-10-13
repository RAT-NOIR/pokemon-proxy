// ============================================================
// LE NIVEAU D'UN LOGO DE SET — officiel / semi-officiel / compose / generique / inconnu (testeur, 2026-10-13 : « chaque logo porte son niveau et sa source »)
// ============================================================
// Une fonction PURE à TABLE FERMÉE : `classer(champ, entree, set, ctx)`. Elle s'écrit par ce qu'elle AUTORISE (§51) : un seul chemin mène à « officiel » (une provenance
// prouvée par la SOURCE écrite sur l'entrée, ni générique, ni logo du couple, ni copie de Pokécardex) ; tout ce qu'elle ne reconnaît pas est `inconnu` — jamais deviné.
//   logoCompose                      → compose
//   logoOfficiel.<fr|ja|en>          → par la SOURCE de l'entrée, table fermée : tcgdex, billsarchive → officiel ; bulbapedia → officiel seulement du lot logos-officiels-bulba-2026-10 ET avec
//                                      `setlogo` dans la preuve ; toute autre source (ou aucune) → inconnu. Plus « officiel par construction ».
//   logoSemiOfficiel.<…>             → semi-officiel seulement avec sa phrase `represente`, sinon inconnu
//   logo / logoFr                    → generique si logoGenerique ou empreinte de la table des génériques ; inconnu si copie de Pokécardex ou logo du couple ; sinon par la SOURCE :
//        tcgdex:en, tcgdex:assets-fr, billsarchive, bulbapedia:setlogo (le `setlogo` de la page du set, collecter-logos-sets.js)  → officiel
//        manuel, apport-manuel → officiel SEULEMENT si la table lue (`ctx.officielsManuels`, issue des lignes de logos-apport-manuel-lus.json / logos-manuels-lus.json qui portent
//        `officiel: true`) nomme le fichier. 🔴 Mesuré le 2026-10-13 : AUCUNE ligne de ces deux tables ne porte `officiel` (elles disent ce que le fichier REPRÉSENTE, pas d'où il vient) →
//        ces logos sont `inconnu`. (La phrase « PNG d'un site officiel » de leur `preuve` est du texte libre du dépôt par le testeur : elle se compte, elle ne se lit pas comme une table.)
//        ptcg-assets, bulbagarden:demande-site, toute autre source, source absente → inconnu
// `source` : posée seulement si elle MANQUE et se lit sans deviner (logoCompose → « compose » ; logoOfficiel → l'hôte de urlSource, TCGdex ou Bill's) ; jamais reposée.
const { refusCopie, refusDuCouple, logoGenerique } = require('./langue-logo');

const CHAMPS = ['logo', 'logoFr', 'logoCompose', 'logoOfficiel.fr', 'logoOfficiel.ja', 'logoOfficiel.en', 'logoSemiOfficiel.fr', 'logoSemiOfficiel.ja', 'logoSemiOfficiel.en'];
const SOURCES_OFFICIELLES = new Set(['tcgdex:en', 'tcgdex:assets-fr', 'billsarchive', 'bulbapedia:setlogo']);
const SOURCES_MANUELLES = new Set(['manuel', 'apport-manuel']);
const LOT_BULBA = 'logos-officiels-bulba-2026-10';
const HOTES = { 'assets.tcgdex.net': 'tcgdex', 'billsarchive.com': 'billsarchive' };
const hoteDe = u => { try { return new URL(u).hostname; } catch { return null; } };
const phrase = s => typeof s === 'string' && s.trim().length >= 20;

/** Rend { niveau, raison, source } : `source` n'est non nul que si elle manque sur l'entrée et se lit sans deviner. */
function classer(champ, entree, set = {}, ctx = {}) {
    const e = entree ?? {};
    const sansSource = () => {
        if (e.source) return null;
        if (champ === 'logoCompose') return 'compose';
        if (champ.startsWith('logoOfficiel.')) return HOTES[hoteDe(e.urlSource)] ?? null;
        return null;
    };
    const rendre = (niveau, raison) => ({ niveau, raison, source: sansSource() });
    if (champ === 'logoCompose') return rendre('compose', 'champ logoCompose');
    if (champ.startsWith('logoOfficiel.')) {
        // TOUR 1 : par la SOURCE de l'entrée, table fermée — plus « officiel par construction » (13 entrées .ja ont source « bulbapedia »)
        const src = e.source ?? sansSource();
        if (src === 'tcgdex' || src === 'billsarchive') return rendre('officiel', `logoOfficiel, source ${src} (table fermée)`);
        if (src === 'bulbapedia') {
            return e.lot === LOT_BULBA && /setlogo/i.test(JSON.stringify(e.preuve ?? ''))
                ? rendre('officiel', `logoOfficiel, source bulbapedia, lot ${LOT_BULBA}, \`setlogo\` dans la preuve`)
                : rendre('inconnu', `logoOfficiel, source bulbapedia hors du lot ${LOT_BULBA} ou sans \`setlogo\` dans la preuve`);
        }
        return rendre('inconnu', `logoOfficiel, source « ${src ?? '∅'} » hors de la table fermée (tcgdex, billsarchive, bulbapedia du lot bulba)`);
    }
    if (champ.startsWith('logoSemiOfficiel.')) return phrase(e.represente) ? rendre('semi-officiel', 'logoSemiOfficiel avec sa phrase `represente`') : rendre('inconnu', 'logoSemiOfficiel sans phrase `represente`');
    if (champ !== 'logo' && champ !== 'logoFr') return rendre('inconnu', `champ « ${champ} » hors de la table`);
    const g = set.logoGenerique === true ? 'logoGenerique: true' : logoGenerique(e.sha1);
    if (g) return rendre('generique', `générique (${typeof g === 'string' ? g : 'empreinte de la table'})`);
    if (refusCopie(e.sha1, e.fichier)) return rendre('inconnu', 'copie de Pokécardex');
    if (refusDuCouple(e.fichier)) return rendre('inconnu', 'logo du couple (le fichier nomme plusieurs sets)');
    if (SOURCES_OFFICIELLES.has(e.source)) return rendre('officiel', `source ${e.source}`);
    if (SOURCES_MANUELLES.has(e.source)) {
        return ctx.officielsManuels?.has(e.fichier) ? rendre('officiel', `source ${e.source}, ligne de la table lue : officiel`) : rendre('inconnu', `source ${e.source} : aucune ligne de la table lue ne le dit officiel`);
    }
    return rendre('inconnu', `source « ${e.source ?? '∅'} » hors de la table`);
}

/**
 * La simulation sur les sets lus : comptes par champ et par valeur, par tirage (tirage, à défaut region), 10 exemples par valeur, et la liste de ce qui s'écrirait
 * (champs NEUFS seulement : `niveau`, et `source` si elle manque). Un champ qui porte déjà un `niveau` est compté sous cette valeur et jamais réécrit.
 */
function simuler(sets, ctx = {}) {
    const comptes = {}, parTirage = {}, exemples = {}, aEcrire = [];
    let champsVus = 0;
    for (const s of sets) {
        const tirage = s.tirage ?? s.region ?? 'inconnu';
        for (const champ of CHAMPS) {
            const [racine, cle] = champ.split('.');
            const e = cle ? s[racine]?.[cle] : s[racine];
            if (!e || typeof e !== 'object') continue;
            champsVus++;
            const c = classer(champ, e, s, ctx);
            const niveau = e.niveau ?? c.niveau;
            ((comptes[champ] ??= {})[niveau] = (comptes[champ][niveau] || 0) + 1);
            ((parTirage[tirage] ??= {})[niveau] = (parTirage[tirage][niveau] || 0) + 1);
            const ex = ((exemples[champ] ??= {})[niveau] ??= []);
            if (ex.length < 10) ex.push({ _id: s._id, source: e.source ?? c.source ?? null, fichier: e.fichier ?? null, raison: c.raison });
            if (e.niveau === undefined) {
                const pose = { niveau: c.niveau, ...(c.source ? { source: c.source } : {}) };
                aEcrire.push({ _id: s._id, chemin: champ, pose });
            }
        }
    }
    return { sets: sets.length, champsVus, comptes, parTirage, exemples, aEcrire };
}

module.exports = { classer, simuler, CHAMPS };
