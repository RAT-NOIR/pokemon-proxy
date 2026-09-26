// ============================================================
// LES DATES DE SORTIE DES SETS — celle que le site lit, là où elle manque, et jamais inventée
// ============================================================
//   node poser-dates-sets.js --clone=<clone de tcgdex/cards-database>            (mesure seule, c'est le défaut)
//   node poser-dates-sets.js --clone=<…> --ecrire                                  (par lot-additif.js)
//
// 🔴 POURQUOI (testeur, 2026-09-25, PRIORITÉ 0) : le site range un set sans date sous « Date non renseignée », tout en bas du
// catalogue — Destined Rivals, Prismatic Evolutions et les autres y semblaient ABSENTS. Le site lit (lib/cartes.ts:257) :
// région `jp` → `dateSortieJa`, région `intl` → `dateSortieEn` — y compris pour un set chinois, indonésien ou thaï, rangé `intl` :
// ce champ y porte la date DE CE TIRAGE, jamais celle du jumeau. Mesuré le 2026-09-25 : 683 sets publiés, 434 sans date.
// ⚠️ ADDITIF STRICT : un champ déjà rempli n'est jamais réécrit (le filtre d'écriture l'exige), même illisible pour Date.parse
// (« March 9 / May 25, 2024 », 4 sets) — ceux-là sont LISTÉS.
//
// LES RÈGLES, ÉCRITES AVANT LA MESURE :
// • Tirage `intl` : releaseDate de TCGdex (le DÉPÔT public cloné, aucun appel d'API). Le set TCGdex doit être désigné par AU
//   MOINS DEUX clés indépendantes — l'idExpansion Cardmarket que TCGdex écrit (`thirdParty.cardmarket`), le nom anglais exact
//   (celui d'affichage, « EX » en tête toléré, règle du site scripts/tcgdex-clone.mjs), l'abréviation officielle = notre code —
//   et AUCUNE clé ne doit en désigner un autre. Une seule clé : listé, pas écrit. La page Bulbapedia archivée est TÉMOIN :
//   un autre jour → rien d'écrit (« si les sources divergent, on écrit null, jamais l'une des deux », rapatrier-noms-fr.js).
// • Tirages `jp`, `zh-hans`, `zh-hant`, `id`, `th`, `idth` : l'infobox de la page de set Bulbapedia ARCHIVÉE (R2, zéro requête).
//   Une valeur étiquetée (« Japan: … <br> Korea: … », « '''Traditional Chinese''': … ») donne la date de l'étiquette du tirage ;
//   une valeur SANS étiquette n'est prise que si la page est celle de ce tirage (suffixe (ATCG)/(SCTCG) pour le chinois
//   simplifié, (TCTCG) traditionnel, (ITCG) indonésien, (TTCG) thaï ; pour le japonais, une page sans `enrelease`, qui n'est donc
//   pas partagée avec un set occidental). Pour le japonais, TCGdex (data-asia, même code) est TÉMOIN.
// • Jamais : plusieurs séries sans région (EXS), un jour incomplet, un set de réimpressions (aucune page).
//
// LES DÉCISIONS DU TESTEUR (2026-09-25, soir, et 2026-09-26), écrites comme des règles et appliquées ici, jamais à la main en base :
// • 🔑 LA DATE RETENUE EST LA SORTIE EN BOUTIQUE DANS LA RÉGION DU SET, et les sources ont un RANG : OFFICIELLE > BULBAPEDIA >
//   TCGdex (règle du 2026-09-26, pour toute divergence présente et future). La source du rang le plus haut qui date le set décide ;
//   les autres sont TÉMOINS, et un témoin contraire est ÉCRIT (`temoin`), jamais tu. TCGdex retient souvent la date de Pokémon TCG
//   Live (Black Bolt, White Flare, Mega Evolution : le 17/07 et le 25/09 au lieu du 18/07 et du 26/09 en boutique) ; et sur
//   Champion Road / Thunderclap Spark, pokemon-card.com donne raison à Bulbapedia (3 mai, 6 juillet 2018) contre TCGdex.
//   ⚠️ Le rang ne dispense pas de l'IDENTITÉ : TCGdex n'est une source que si deux clés désignent son set (`pairerIntl`) ; désigné
//   par une seule (le code japonais, un nom), il reste témoin. La source officielle est une LIGNE relevée à la main, page lue, citée.
// • Une mention de sortie dans la valeur Bulbapedia se LIT : « (General release) », « (Commercial release) » sont la sortie en
//   boutique ; « (Early release) », une avant-première, une sortie en salle ne le sont pas. Une valeur à plusieurs VERSIONS
//   (« Standard versions », « Pikachu version ») ne se lit que pour un set dont la version est nommée ici (VERSION_DU_SET).
// • Un set « Additionals » prend la date de son set de BASE (même _id sans « -Additionals »), aucune source ne datant cette
//   catégorie Cardmarket ; la source écrite le dit.
// • Une PÉRIODE de distribution (`period`, promos) : la date de rangement est le DÉBUT de la période, quand il est un jour complet ;
//   la période entière s'écrit dans `periodeDistribution` { texte, debut, fin, debutIso } pour que le site l'affiche. Un début au
//   MOIS seul (« November 2016 ») ne fabrique pas de jour : pas de date, la période seule (`debutIso: "2016-11"`), et la raison.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const r2 = require('./collecte-cartes/r2');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const CLONE = arg('clone');
// `--pages=<json>` : des pages de set lues HORS de l'archive R2 (sonde revisionsDe, avec pageid et revid), pour les sets qui n'ont
// pas de `bulba.cleR2` — la voie « sans page ». Clé : l'_id du set (`id`), valeur : { page, revid, content }.
const PAGES = new Map(arg('pages') ? JSON.parse(fs.readFileSync(arg('pages'), 'utf8')).filter(x => x.content).map(x => [x.id, x]) : []);
const MOIS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RE_JOUR = new RegExp(`^(${MOIS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`);

/** Un texte de date Bulbapedia → « Month D, YYYY » (le format des 249 dates en base), ou null s'il n'est pas un jour complet. */
function jourComplet(texte) {
    const t = String(texte || '').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/'''?/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
    const m = RE_JOUR.exec(t);
    if (!m) return null;
    const j = Number(m[2]), a = Number(m[3]);
    if (j < 1 || j > 31 || a < 1996 || a > 2030) return null;
    return `${m[1]} ${j}, ${a}`;
}
const depuisIso = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? `${MOIS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null; };

// Étiquettes de région dans une valeur à plusieurs lignes ; une étiquette inconnue ne désigne rien.
const ETIQUETTES = [
    [/^(japan|japanese)$/i, 'jp'], [/^(english|international|north america|united states|usa|europe)$/i, 'intl'],
    [/^(traditional chinese|taiwan|hong kong)$/i, 'zh-hant'], [/^(simplified chinese|china|mainland china)$/i, 'zh-hans'],
    [/^(indonesian|indonesia)$/i, 'id'], [/^(thai|thailand)$/i, 'th'], [/^(korean|korea|south korea)$/i, 'ko']
];
// Une annotation <small>…</small>, un commentaire HTML (même non fermé : « November 22, 2024<!-- ») ne sont pas la date.
const nettoyer = v => String(v || '').replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<small>[\s\S]*?<\/small>/gi, '').trim();
// La NATURE d'une date, dite par sa parenthèse : la sortie en boutique, ou ce qui la précède (avant-première, salle de cinéma).
// « (Standard versions) », « (Pikachu version) » : la version d'un produit à plusieurs sorties.
const NATURES = [[/^(general|commercial|retail) release$/i, 'boutique'], [/(early release|pre-?release|theatrical release)/i, 'avant']];
function natureDe(annotation) {
    const a = String(annotation || '').trim();
    const n = NATURES.find(([re]) => re.test(a));
    if (n) return n[1];
    const v = /^(.+?) versions?$/i.exec(a);
    return v ? `version:${v[1].trim().toLowerCase()}` : null;
}
function parties(valeur) {
    // Une parenthèse dans <small> (« August 3, 2007 <small>(Commercial release)</small> ») dit la nature de la date : elle est
    // gardée comme parenthèse avant que `nettoyer` retire le reste des <small>.
    const brut = String(valeur || '').replace(/<small>\s*(\([^)]*\))\s*<\/small>/gi, ' $1');
    return nettoyer(brut).split(/<br\s*\/?>/i).map(p => p.trim()).filter(Boolean).map(p => {
        // « January 16, 2026 (CSVM1) » : une parenthèse qui porte un CODE de set est une étiquette (comparée au code de la ligne).
        const pc = /^([\s\S]+?)\s*\(([A-Za-z0-9.+-]{2,12})\)$/.exec(p);
        if (pc && /\d/.test(pc[2]) && /[A-Z]/.test(pc[2])) return { etiquette: `code:${pc[2]}`, texte: pc[1] };
        // « March 8, 2024 (Japan) » : une parenthèse qui nomme une RÉGION connue est une étiquette ; une NATURE (« (General
        // release) », « (Standard versions) ») est lue à part ; toute autre (« (Part 1) ») reste dans le texte, qui n'est alors plus
        // un jour complet — rien n'est deviné.
        const pr = /^([\s\S]+?)\s*\(([A-Za-z .]+)\)$/.exec(p);
        const er = pr && ETIQUETTES.find(([re]) => re.test(pr[2].trim()));
        if (er) return { etiquette: er[1], texte: pr[1] };
        const na = pr && natureDe(pr[2]);
        if (na) return { etiquette: null, texte: pr[1], nature: na, annotation: pr[2].trim() };
        const m = /^(?:'''?)?([A-Za-z .]+?)(?:'''?)?\s*:\s*(?:'''?)?\s*([\s\S]+)$/.exec(p);
        if (!m) return { etiquette: null, texte: p };
        const e = ETIQUETTES.find(([re]) => re.test(m[1].trim()));
        return { etiquette: e ? e[1] : `?${m[1].trim()}`, texte: m[2] };
    });
}
const SUFFIXE_PAGE = { 'zh-hans': /\((ATCG|SCTCG)\)$/, 'zh-hant': /\(TCTCG\)$/, id: /\(ITCG\)$/, th: /\(TTCG\)$/ };

// LES SOURCES OFFICIELLES, une ligne par set : la page LUE, la phrase citée, le jour qu'elle donne. Relevées à la main (une requête
// par page, espacées), jamais déduites. Elles passent avant toute autre source (règle du testeur, 2026-09-26).
const BLK_WHT = { jour: 'July 18, 2025', url: 'https://press.pokemon.com/en/releases/Pokemon-Reveals-New-Split-Expansion-Launching-Soon-for-the-Pokemon-Tra', citation: 'en boutique le 18 juillet 2025 ; le 17 juillet est la sortie sur Pokémon TCG Live', lu: '2026-09-25' };
const OFFICIELLES = {
    'Black-Bolt': BLK_WHT,
    'White-Flare': BLK_WHT,
    'Champion-Road': { jour: 'May 3, 2018', url: 'https://www.pokemon-card.com/products/sm/sm6b.html', citation: '発売日 2018年5月3日（祝・木）', lu: '2026-09-26' },
    'Thunderclap-Spark': { jour: 'July 6, 2018', url: 'https://www.pokemon-card.com/products/sm/sm7a.html', citation: '発売日 2018年7月6日（金）', lu: '2026-09-26' },
    'Scarlet-Violet-ex-Special-Set': { jour: 'May 19, 2023', url: 'https://www.pokemon-card.com/products/sv/svp1.html', citation: '発売日 2023年5月19日（金）', lu: '2026-09-26' },
    // Une page pour les trois « スターターセットex » (ニャオハ＆ルカリオex, ホゲータ＆デンリュウex, クワッス＆ミミッキュex), un seul jour.
    'ex-Starter-Set-Sprigatito-Lucario-ex': { jour: 'January 20, 2023', url: 'https://www.pokemon-card.com/ex/sva/index.html', citation: '発売日 2023年1月20日（金）', lu: '2026-09-26' },
    'ex-Starter-Set-Quaxly-Mimikyu-ex': { jour: 'January 20, 2023', url: 'https://www.pokemon-card.com/ex/sva/index.html', citation: '発売日 2023年1月20日（金）', lu: '2026-09-26' },
    'Play-Pokemon-Prize-Pack-Series-Three': { jour: 'August 14, 2023', url: 'https://www.pokemon.com/us/pokemon-news/visit-your-local-game-store-to-receive-play-pokemon-prize-packs', citation: 'the Prize Pack Series Three will be available starting August 14, 2023', lu: '2026-09-26' }
};
// La version qu'un set désigne, quand sa page date plusieurs versions du même produit : le nom Cardmarket la porte (« … Pikachu »),
// ou le set est le produit de base (« Standard »).
const VERSION_DU_SET = { 'Beginning-Set-Pikachu': 'pikachu', 'Beginning-Set': 'standard', 'XY-Beginning-Set': 'standard' };

const RANGS = ['officielle', 'bulbapedia', 'tcgdex'];
/**
 * LA HIÉRARCHIE DES SOURCES (testeur, 2026-09-26) : la source du rang le plus haut qui donne un jour décide ; chaque autre est un
 * témoin, d'accord (✅) ou contraire (⚠️, écarté par son rang) — et un témoin qui n'est pas une source (TCGdex désigné par une seule
 * clé) s'imprime de même, sans jamais décider.
 * @param {{officielle?: {jour, source}|null, bulbapedia?: {jour, source}|null, tcgdex?: {jour, source}|null}} sources
 * @param {Array<{nom: string, jour: string}>} temoins
 * @returns {{jour, source, rang, temoin: string, divergence: boolean}|null}
 */
function arbitrer(sources, temoins = []) {
    const presents = RANGS.filter(r => sources[r]?.jour);
    if (!presents.length) return null;
    const g = sources[presents[0]];
    const avis = [...presents.slice(1).map(r => ({ nom: r, jour: sources[r].jour })), ...temoins];
    const temoin = avis.map(a => `${a.nom} ${a.jour} ${a.jour === g.jour ? '✅' : '⚠️ contraire, écarté par le rang'}`).join(' · ') || '—';
    return { jour: g.jour, source: g.source, rang: presents[0], temoin, divergence: avis.some(a => a.jour !== g.jour) };
}

const MOIS_ISO = Object.fromEntries(MOIS.map((m, i) => [m.toLowerCase(), String(i + 1).padStart(2, '0')]));
/** « November 18, 2022 » → « 2022-11-18 » ; « November 2016 » → « 2016-11 » ; « 2004 » → « 2004 » ; sinon null. La précision de la source, rien de plus. */
function isoPartiel(texte) {
    const t = String(texte || '').replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    let m = /^([A-Za-z]+) (\d{1,2}) (\d{4})$/.exec(t);
    if (m && MOIS_ISO[m[1].toLowerCase()]) return `${m[3]}-${MOIS_ISO[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
    m = /^([A-Za-z]+) (\d{4})$/.exec(t);
    if (m && MOIS_ISO[m[1].toLowerCase()]) return `${m[2]}-${MOIS_ISO[m[1].toLowerCase()]}`;
    return /^\d{4}$/.test(t) ? t : null;
}
/** Une valeur `period` → { texte, debut, fin, jourDebut, debutIso }. « From December 4, 2024 » : un début, pas de fin. */
function periodeDe(brut) {
    const texte = nettoyer(brut).replace(/'''?/g, '').replace(/\s+/g, ' ').trim();
    const m = /^(?:from\s+)?(.+?)(?:\s*[-–—]\s*|\s+to\s+|\s+until\s+)(.+)$/i.exec(texte);
    const debut = (m ? m[1] : texte.replace(/^from\s+/i, '')).trim(), fin = m ? m[2].trim() : null;
    return { texte, debut, fin, jourDebut: jourComplet(debut), debutIso: isoPartiel(debut) };
}

/** La date d'un set depuis son infobox archivée, ou { raison }. */
function dateBulbapedia(texte, set) {
    const ib = /\{\{\s*(\w*Infobox)([\s\S]*?)\n\}\}/.exec(texte);
    if (!ib) return { raison: 'aucune infobox dans la page archivée' };
    const p = {};
    // Une infobox écrite sur UNE ligne (« |release=November 18, 2011 |cards=30 ») : la valeur s'arrête au premier « | » hors
    // gabarit ou lien — 18 decks japonais restaient « pas un jour complet : November 18, 2011 | » (2026-09-25).
    const coupe = v => { let d = 0; for (let i = 0; i < v.length; i++) { const n2 = v.slice(i, i + 2); if (n2 === '{{' || n2 === '[[') { d++; i++; continue; } if (n2 === '}}' || n2 === ']]') { d--; i++; continue; } if (v[i] === '|' && d <= 0) return v.slice(0, i); } return v; };
    for (const m of ib[2].matchAll(/\|\s*([a-z]*(?:release|date|period)[a-z0-9]*)\s*=([^\n]*)/gi)) p[m[1].toLowerCase()] = coupe(m[2]).trim();
    const tir = set.tirage;
    const code = String(set.code || ''), codeNu = code.replace(/C$/, '');
    // La valeur d'une clé qui désigne CE tirage : l'étiquette du tirage ou du CODE du set (Cardmarket suffixe « C » les codes
    // chinois que Bulbapedia écrit sans, §39) ; sinon une valeur unique sans étiquette, seulement si la page est celle du tirage.
    const valeursDuTirage = k => {
        const ps = parties(p[k]);
        const etiq = ps.filter(x => x.etiquette === tir || (tir === 'idth' && ['id', 'th'].includes(x.etiquette)) || x.etiquette === `code:${code}` || x.etiquette === `code:${codeNu}`);
        if (etiq.length) return etiq.map(x => ({ de: `${k}:${x.etiquette}`, brut: x.texte }));
        // Plusieurs valeurs sans étiquette de région : leur NATURE peut désigner la sortie en boutique (une seule « boutique », toutes
        // les autres AVANT elle), ou la VERSION que ce set est (VERSION_DU_SET). Sinon rien ne désigne la nôtre.
        let retenues = ps;
        if (ps.length > 1 && ps.every(x => !x.etiquette)) {
            const boutique = ps.filter(x => x.nature === 'boutique');
            const version = VERSION_DU_SET[set._id] ? ps.filter(x => x.nature === `version:${VERSION_DU_SET[set._id]}`) : [];
            if (boutique.length === 1 && ps.every(x => x === boutique[0] || x.nature === 'avant')) retenues = boutique;
            else if (version.length === 1) retenues = version;
        }
        if (retenues.length !== 1 || retenues[0].etiquette) return [];   // plusieurs valeurs sans l'étiquette du tirage : rien ne désigne la nôtre
        if (retenues[0].nature === 'avant') return [];                   // une avant-première seule n'est pas la sortie en boutique
        const sienne = k === 'jarelease' || k === 'enrelease'
            || (tir === 'jp' && !p.enrelease && !/\((ATCG|SCTCG|TCTCG|ITCG|TTCG)\)$/.test(set.bulba.titre || ''))
            || (tir === 'intl' && !p.jarelease && /\(TCG\)$/.test(set.bulba.titre || ''))
            || (SUFFIXE_PAGE[tir] && SUFFIXE_PAGE[tir].test(set.bulba.titre || ''));
        return sienne ? [{ de: retenues[0].annotation ? `${k} « ${retenues[0].annotation} »` : k, brut: retenues[0].texte }] : [];
    };
    const candidats = [];
    const cles = tir === 'jp' ? ['jarelease', 'release', 'date'] : tir === 'intl' ? ['enrelease', 'release', 'date'] : ['release', 'date'];
    for (const k of cles) if (p[k]) for (const v of valeursDuTirage(k)) candidats.push({ ...v, jour: jourComplet(v.brut) });
    const jours = [...new Set(candidats.map(c => c.jour).filter(Boolean))];
    if (jours.length === 1) return { jour: jours[0], de: candidats.find(c => c.jour === jours[0]).de, brut: candidats.find(c => c.jour === jours[0]).brut };
    if (jours.length > 1) return { raison: `plusieurs jours pour ce tirage : ${jours.join(' / ')}` };
    if (candidats.length) return { raison: `pas un jour complet : « ${String(candidats[0].brut).slice(0, 80)} »` };
    if (p.period) {
        // Décision du testeur (2026-09-25) : une période se range à son DÉBUT ; la période entière s'écrit pour l'affichage.
        const v = valeursDuTirage('period');
        if (v.length !== 1) return { raison: `période de distribution qui ne désigne pas ce tirage : « ${p.period.slice(0, 60)} »` };
        const periode = { ...periodeDe(v[0].brut), de: v[0].de };
        return periode.jourDebut ? { periode, raison: null }
            : { periode, raison: `période « ${periode.texte.slice(0, 60)} » : son début (« ${periode.debut} ») n'est pas un jour complet — la période seule est écrite` };
    }
    if (Object.keys(p).length) return { raison: `aucune valeur de ce tirage (${tir}) : ${Object.entries(p).map(([k, v]) => `${k}=« ${v.slice(0, 50)} »`).join(' ; ')}` };
    return { raison: 'aucun paramètre de date dans l\'infobox' };
}

// ── TCGdex : le dépôt cloné, lu au motif comme scripts/tcgdex-clone.mjs du site (on ne l'exécute pas)
const chaine = (src, cle) => { const m = src.match(new RegExp(`^\\s*${cle}:\\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`, 'm')); return m ? m[2] : null; };
function lireSetsTcgdex(racine, dossier) {
    const sets = [];
    for (const serie of fs.readdirSync(path.join(racine, dossier))) {
        const d = path.join(racine, dossier, serie);
        if (!fs.statSync(d).isDirectory()) continue;
        for (const f of fs.readdirSync(d)) {
            if (!f.endsWith('.ts')) continue;
            const src = fs.readFileSync(path.join(d, f), 'utf8');
            const id = chaine(src, 'id'); if (!id) continue;
            const nom = /^\s*name:\s*\{([\s\S]*?)\}/m.exec(src)?.[1] || '';
            sets.push({ id, fichier: `${dossier}/${serie}/${f}`, nomEn: /(?:^|[\s{,])en:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/.exec(nom)?.[2] ?? null,
                releaseDate: chaine(src, 'releaseDate'), abreviation: /abbreviations:\s*\{[\s\S]*?official:\s*(["'])([^"']+)\1/.exec(src)?.[2] ?? null,
                cardmarket: Number(/thirdParty:\s*\{[\s\S]*?cardmarket:\s*(\d+)/.exec(src)?.[1]) || null });
        }
    }
    return sets;
}
const normNom = t => String(t ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

/** Le set TCGdex d'un de nos sets intl : au moins deux clés d'accord, aucune en désaccord. */
function pairerIntl(tcg, s) {
    const exps = [].concat(s.idExpansion ?? []);
    const k1 = new Set(tcg.filter(t => t.cardmarket && exps.includes(t.cardmarket)).map(t => t.id));
    const noms = [normNom(s.nomAffichage), normNom(String(s.nomAffichage || '').replace(/^EX\s+/i, ''))];
    const k2 = new Set(tcg.filter(t => t.nomEn && noms.includes(normNom(t.nomEn))).map(t => t.id));
    const k3 = new Set(tcg.filter(t => t.abreviation && String(t.abreviation).toUpperCase() === String(s.code || '').toUpperCase()).map(t => t.id));
    const cles = [['idExpansion', k1], ['nom', k2], ['abréviation', k3]].filter(([, k]) => k.size);
    const tous = new Set(cles.flatMap(([, k]) => [...k]));
    if (!cles.length) return { raison: 'aucune clé ne désigne un set TCGdex' };
    if (tous.size > 1) return { raison: `clés en désaccord : ${cles.map(([n, k]) => `${n}→${[...k].join('/')}`).join(' ; ')}` };
    const id = [...tous][0];
    if (cles.length < 2) return { raison: `une seule clé (${cles[0][0]} → ${id})`, id, uneCle: true };
    return { id, par: cles.map(([n]) => n).join('+') };
}

async function principal() {
    const ecrire = process.argv.includes('--ecrire');
    if (!CLONE || !fs.existsSync(path.join(CLONE, 'data'))) { console.error('❌ --clone=<chemin du clone tcgdex/cards-database> requis (git clone --depth 1)'); process.exit(2); }
    const tcgIntl = lireSetsTcgdex(CLONE, 'data'), tcgAsie = lireSetsTcgdex(CLONE, 'data-asia');
    console.log(`TCGdex (clone) : ${tcgIntl.length} sets internationaux (${tcgIntl.filter(t => t.releaseDate).length} datés, ${tcgIntl.filter(t => t.cardmarket).length} avec idExpansion Cardmarket) · ${tcgAsie.length} sets asiatiques (${tcgAsie.filter(t => t.releaseDate).length} datés)`);
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'] });
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const sets = await lireMongo(cx.db.collection('sets'), { nomAffichage: { $type: 'string' } }, { nom: 'sets publiés', projection: { code: 1, region: 1, tirage: 1, nomAffichage: 1, dateSortieJa: 1, dateSortieEn: 1, dateSortieJaSource: 1, dateSortieEnSource: 1, periodeDistribution: 1, reimpressions: 1, idExpansion: 1, bulba: 1 } });
    const champDe = s => s.region === 'jp' ? 'dateSortieJa' : s.region === 'intl' ? 'dateSortieEn' : null;
    // « N/A » n'est pas une date (le site l'écrit, DEMANDE du 2026-09-25 : Black Bolt, White Flare) : c'est l'absence écrite en
    // toutes lettres, traitée comme l'absence. Toute AUTRE valeur présente, même illisible, n'est jamais réécrite.
    const ABSENT = [null, '', 'N/A'];
    const sans = sets.filter(s => champDe(s) && ABSENT.includes(s[champDe(s)] ?? null));
    const illisibles = sets.filter(s => champDe(s) && !ABSENT.includes(s[champDe(s)] ?? null) && Number.isNaN(Date.parse(s[champDe(s)])));
    console.log(`« N/A » traités comme absents : ${sets.filter(s => champDe(s) && s[champDe(s)] === 'N/A').map(s => s.code).join(', ') || 'aucun'}`);
    console.log(`DÉNOMINATEUR : ${sets.length} sets publiés · sans date (règle du site) ${sans.length} · date présente mais illisible par Date.parse ${illisibles.length} (non touchées) : ${illisibles.map(s => `${s.code} « ${s[champDe(s)]} »`).join(' · ')}`);
    const decisions = [];
    for (const s of sans) {
        // Un set de réimpressions (Prize Packs, WCD…) n'a pas de tirage propre écrit ; il est occidental par sa région.
        const tirage = s.tirage ?? (s.reimpressions && s.region === 'intl' ? 'intl' : null);
        const d = { id: s._id, code: s.code, tirage, nom: s.nomAffichage, champ: champDe(s) };
        decisions.push(d);
        // Aucune source ne date un Additionals : il prendra la date de son set de base, en seconde passe (la base peut être datée
        // par ce même passage — Black Bolt pour xBLK).
        if (/-Additionals$/.test(s._id)) { d.base = s._id.replace(/-Additionals$/, ''); continue; }
        const off = OFFICIELLES[s._id];
        const o = off ? { jour: off.jour, source: `officielle:${off.url} (« ${off.citation} », lu le ${off.lu})` } : null;
        // Un set de réimpressions n'a pas de page de SET archivée ; la page du PRODUIT (« Play! Pokémon Prize Pack Series One (TCG) »,
        // « Trick or Trade 2023 (TCG) ») est lue par la sonde et fournie par --pages, avec sa révision.
        if (s.reimpressions && !PAGES.has(s._id) && !o) { d.raison = `set de réimpressions (${s.reimpressions}) : aucune page du produit fournie (--pages), aucune source officielle relevée`; continue; }
        let b = null;
        if (s.bulba?.cleR2) b = dateBulbapedia(await r2.lireTexte(process.env.R2_BUCKET_BRUT, s.bulba.cleR2), { ...s, tirage });
        else if (PAGES.has(s._id)) {
            // Un set « sans page » : la page de son expansion (déclarée par ses cartes), lue par la sonde et gardée avec sa révision.
            const pg = PAGES.get(s._id);
            b = dateBulbapedia(pg.content, { ...s, tirage, bulba: { ...(s.bulba || {}), titre: pg.page } });
            if (b.jour) b.de = `${b.de} (page « ${pg.page} » rév. ${pg.revid})`;
            if (b.periode) b.periode.de = `${b.periode.de} (page « ${pg.page} » rév. ${pg.revid})`;
        }
        if (b?.periode) d.periode = b.periode;
        // Le début d'une période, quand il est un jour complet, est la date de rangement (décision du testeur, 2026-09-25).
        const bj = b?.jour ? { jour: b.jour, source: `bulbapedia:${b.de}` }
            : b?.periode?.jourDebut ? { jour: b.periode.jourDebut, source: `bulbapedia:${b.periode.de} (début de la période « ${b.periode.texte} ») — décision du testeur 2026-09-25 : une période se range à son début` } : null;
        // TCGdex : une SOURCE seulement désigné par deux clés (occidental) ; par une seule (le code japonais, un nom), un témoin.
        let t = null; const temoins = [];
        if (tirage === 'intl') {
            const p = pairerIntl(tcgIntl, s);
            const ts = p.id ? tcgIntl.find(x => x.id === p.id) : null, jt = ts ? depuisIso(ts.releaseDate) : null;
            if (jt && !p.uneCle) t = { jour: jt, source: `tcgdex:${ts.id}:${p.par}` };
            else if (jt) temoins.push({ nom: `tcgdex ${ts.id} (une clé, témoin)`, jour: jt });
            d.tcgdex = p.raison ?? (jt ? null : `${ts?.id ?? '?'} sans releaseDate`);
        } else if (tirage === 'jp') {
            const ta = tcgAsie.find(x => x.id.toLowerCase() === String(s.code || '').toLowerCase()), jt = ta ? depuisIso(ta.releaseDate) : null;
            if (jt) temoins.push({ nom: `tcgdex ${ta.id} (code seul, témoin)`, jour: jt });
        }
        const r = arbitrer({ officielle: o, bulbapedia: bj, tcgdex: t }, temoins);
        if (r) { Object.assign(d, { jour: r.jour, source: r.source, rang: r.rang, temoin: r.temoin }, r.divergence ? { divergence: true } : {}); continue; }
        d.raison = [`Bulbapedia : ${b ? b.raison : s.bulba?.titre ? `page « ${s.bulba.titre} » non archivée` : 'aucune page (voie sans page)'}`,
            tirage === 'intl' ? `TCGdex : ${d.tcgdex ?? 'sans date'}` : null, 'aucune source officielle relevée'].filter(Boolean).join(' · ');
    }
    // Seconde passe : un Additionals prend la date de son set de base (décision du testeur, 2026-09-25) — celle que ce passage
    // vient de décider, sinon celle déjà en base. Une base sans date laisse l'Additionals sans date, avec la raison.
    for (const d of decisions.filter(x => x.base)) {
        const sBase = sets.find(x => x._id === d.base), dBase = decisions.find(x => x.id === d.base && x.jour);
        if (!sBase) { d.raison = `Additionals : set de base « ${d.base} » absent des sets publiés`; continue; }
        const cb = champDe(sBase), enBase = ABSENT.includes(sBase[cb] ?? null) ? null : sBase[cb];
        const jourBase = dBase?.jour ?? (enBase && jourComplet(enBase)) ?? null;
        if (!jourBase) { d.raison = `Additionals : son set de base « ${d.base} » n'a pas de date${enBase ? ` lisible (« ${enBase} »)` : ''}`; continue; }
        Object.assign(d, { jour: jourBase, source: `base:${d.base} (${dBase ? dBase.source : sBase[`${cb}Source`] ?? 'date déjà en base'}) — décision du testeur 2026-09-25 : un Additionals prend la date de son set de base`, temoin: '—' });
    }
    const poses = decisions.filter(d => d.jour), refus = decisions.filter(d => !d.jour);
    const parT = {}; for (const d of decisions) { const g = parT[d.tirage] || (parT[d.tirage] = { n: 0, date: 0 }); g.n++; if (d.jour) g.date++; }
    console.log(`\nDATÉS PAR CET OUTIL : ${poses.length} / ${decisions.length} · par tirage ${Object.entries(parT).map(([k, g]) => `${k} ${g.date}/${g.n}`).join(' · ')}`);
    const raisons = {}; for (const d of refus) { const k = d.raison.replace(/«[^»]*»/g, '«…»').replace(/\b\d{4}\b|\d+/g, '#').slice(0, 90); raisons[k] = (raisons[k] || 0) + 1; }
    console.log('RESTENT SANS DATE, par raison :'); for (const [k, n] of Object.entries(raisons).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)} · ${k}`);
    const temoins = { accord: poses.filter(d => /✅/.test(d.temoin)).length, sans: poses.filter(d => !/✅/.test(d.temoin)).length };
    console.log(`témoin d'accord ${temoins.accord} · sans témoin ${temoins.sans} · par rang ${RANGS.map(r => `${r} ${poses.filter(d => d.rang === r).length}`).join(' · ')}`);
    // Les décisions du testeur, imprimées une à une : c'est leur première application.
    const periodes = decisions.filter(d => d.periode);
    console.log(`\nDÉCISIONS DU TESTEUR (2026-09-25 et 2026-09-26) :`);
    for (const id of Object.keys(OFFICIELLES)) { const d = decisions.find(x => x.id === id); console.log(`   source officielle ${id} : ${d ? (d.jour ? `${d.champ} = ${d.jour} · témoins ${d.temoin}` : d.raison) : 'déjà daté ou non publié'}`); }
    for (const d of poses.filter(x => x.divergence)) console.log(`   DIVERGENCE tranchée par le rang ${String(d.code).padEnd(7)} ${d.champ} = ${d.jour} (${d.rang}) · témoins ${d.temoin}`);
    for (const d of decisions.filter(x => x.base)) console.log(`   Additionals ${String(d.code).padEnd(6)} ${d.id} → ${d.jour ? `${d.champ} = ${d.jour} (base ${d.base})` : d.raison}`);
    console.log(`   PÉRIODES : ${periodes.length} lues · ${periodes.filter(d => d.jour).length} datées par leur début · ${periodes.filter(d => !d.jour).length} sans date (début au mois, ou témoin contraire)`);
    for (const d of periodes) console.log(`   période ${String(d.code).padEnd(8)} « ${d.periode.texte} » → début ${d.periode.debut} (${d.periode.debutIso ?? '—'})${d.periode.fin ? ` · fin ${d.periode.fin}` : ''} · ${d.jour ? `${d.champ} = ${d.jour}` : d.raison}`);
    fs.writeFileSync(path.join(__dirname, 'collecte-cartes', 'rapports', 'dates-sets.json'), JSON.stringify(decisions, null, 1));
    let g = 20260925; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    console.log('\n20 TIRÉS AU SORT parmi les datés (graine 20260925) :');
    for (const d of [...poses].sort(() => hasard() - 0.5).slice(0, 20)) console.log(`   ${String(d.code).padEnd(9)} ${d.tirage.padEnd(7)} « ${d.nom} » → ${d.champ} = ${d.jour} · ${d.source} · témoin ${d.temoin}`);
    if (!ecrire) { console.log(`\n   (mesure seule : ${poses.length} dates à poser — relancer avec --ecrire, par lot-additif.js)`); await fermer(); return; }
    let n = 0;
    for (const d of poses) {
        const r = await cx.db.collection('sets').updateOne({ _id: d.id, [d.champ]: { $in: ABSENT } }, { $set: { [d.champ]: d.jour, [`${d.champ}Source`]: d.source, dateSortiePoseeLe: new Date() } });
        n += r.modifiedCount;
    }
    // La période entière, pour l'affichage (le site la montre, la date ne sert qu'à ranger) — additive : jamais réécrite.
    let np = 0;
    for (const d of periodes) {
        const { texte, debut, fin, debutIso, de } = d.periode;
        const r = await cx.db.collection('sets').updateOne({ _id: d.id, periodeDistribution: { $exists: false } },
            { $set: { periodeDistribution: { texte, debut, fin, debutIso, source: `bulbapedia:${de}`, le: new Date() } } });
        np += r.modifiedCount;
    }
    const relus = await cx.db.collection('sets').countDocuments({ dateSortiePoseeLe: { $exists: true } });
    const relusP = await cx.db.collection('sets').countDocuments({ periodeDistribution: { $exists: true } });
    console.log(`\n   ✅ ${n} dates posées (attendu ${poses.length}) · ${np} périodes écrites (attendu ${periodes.length}) · relu : ${relus} sets portent dateSortiePoseeLe, ${relusP} portent periodeDistribution`);
    if (n !== poses.length) console.log(`   🔴 ${poses.length - n} non posées : le champ s'est rempli entre la mesure et l'écriture — à ouvrir`);
    if (np !== periodes.length) console.log(`   🔴 ${periodes.length - np} périodes non écrites : le champ existait déjà — à ouvrir`);
    await fermer();
}

module.exports = { jourComplet, parties, dateBulbapedia, pairerIntl, depuisIso, periodeDe, isoPartiel, arbitrer, OFFICIELLES };
if (require.main === module) principal().catch(e => { console.error(e); process.exit(1); });
