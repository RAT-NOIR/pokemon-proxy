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
// • Jamais : une PÉRIODE de distribution (`period`, promos), plusieurs séries sans région (EXS), un jour incomplet, un set
//   « Additionals » (catégorie Cardmarket qu'aucune source ne date), un set de réimpressions (aucune page).
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
function parties(valeur) {
    return nettoyer(valeur).split(/<br\s*\/?>/i).map(p => p.trim()).filter(Boolean).map(p => {
        // « January 16, 2026 (CSVM1) » : une parenthèse qui porte un CODE de set est une étiquette (comparée au code de la ligne).
        const pc = /^([\s\S]+?)\s*\(([A-Za-z0-9.+-]{2,12})\)$/.exec(p);
        if (pc && /\d/.test(pc[2]) && /[A-Z]/.test(pc[2])) return { etiquette: `code:${pc[2]}`, texte: pc[1] };
        // « March 8, 2024 (Japan) » : une parenthèse qui nomme une RÉGION connue est une étiquette ; toute autre (« (Early
        // release) », « (Part 1) ») reste dans le texte, qui n'est alors plus un jour complet — rien n'est deviné.
        const pr = /^([\s\S]+?)\s*\(([A-Za-z .]+)\)$/.exec(p);
        const er = pr && ETIQUETTES.find(([re]) => re.test(pr[2].trim()));
        if (er) return { etiquette: er[1], texte: pr[1] };
        const m = /^(?:'''?)?([A-Za-z .]+?)(?:'''?)?\s*:\s*(?:'''?)?\s*([\s\S]+)$/.exec(p);
        if (!m) return { etiquette: null, texte: p };
        const e = ETIQUETTES.find(([re]) => re.test(m[1].trim()));
        return { etiquette: e ? e[1] : `?${m[1].trim()}`, texte: m[2] };
    });
}
const SUFFIXE_PAGE = { 'zh-hans': /\((ATCG|SCTCG)\)$/, 'zh-hant': /\(TCTCG\)$/, id: /\(ITCG\)$/, th: /\(TTCG\)$/ };

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
    const candidats = [];
    const cles = tir === 'jp' ? ['jarelease', 'release', 'date'] : tir === 'intl' ? ['enrelease', 'release', 'date'] : ['release', 'date'];
    for (const k of cles) {
        if (!p[k]) continue;
        const ps = parties(p[k]);
        // L'étiquette du tirage, ou celle du CODE du set (Cardmarket suffixe « C » les codes chinois que Bulbapedia écrit sans, §39).
        const code = String(set.code || ''), codeNu = code.replace(/C$/, '');
        const etiq = ps.filter(x => x.etiquette === tir || (tir === 'idth' && ['id', 'th'].includes(x.etiquette)) || x.etiquette === `code:${code}` || x.etiquette === `code:${codeNu}`);
        if (etiq.length) { for (const x of etiq) candidats.push({ jour: jourComplet(x.texte), de: `${k}:${x.etiquette}`, brut: x.texte }); continue; }
        if (ps.length !== 1 || ps[0].etiquette) continue;   // plusieurs valeurs sans l'étiquette du tirage : rien ne désigne la nôtre
        const sienne = k === 'jarelease' || k === 'enrelease'
            || (tir === 'jp' && !p.enrelease && !/\((ATCG|SCTCG|TCTCG|ITCG|TTCG)\)$/.test(set.bulba.titre || ''))
            || (tir === 'intl' && !p.jarelease && /\(TCG\)$/.test(set.bulba.titre || ''))
            || (SUFFIXE_PAGE[tir] && SUFFIXE_PAGE[tir].test(set.bulba.titre || ''));
        if (sienne) candidats.push({ jour: jourComplet(ps[0].texte), de: k, brut: ps[0].texte });
    }
    const jours = [...new Set(candidats.map(c => c.jour).filter(Boolean))];
    if (jours.length === 1) return { jour: jours[0], de: candidats.find(c => c.jour === jours[0]).de, brut: candidats.find(c => c.jour === jours[0]).brut };
    if (jours.length > 1) return { raison: `plusieurs jours pour ce tirage : ${jours.join(' / ')}` };
    if (candidats.length) return { raison: `pas un jour complet : « ${String(candidats[0].brut).slice(0, 80)} »` };
    if (p.period) return { raison: `période de distribution, pas une date : « ${p.period.slice(0, 60)} »` };
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
    const sets = await lireMongo(cx.db.collection('sets'), { nomAffichage: { $type: 'string' } }, { nom: 'sets publiés', projection: { code: 1, region: 1, tirage: 1, nomAffichage: 1, dateSortieJa: 1, dateSortieEn: 1, reimpressions: 1, idExpansion: 1, bulba: 1 } });
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
        const d = { id: s._id, code: s.code, tirage: s.tirage, nom: s.nomAffichage, champ: champDe(s) };
        decisions.push(d);
        if (s.reimpressions) { d.raison = `set de réimpressions (${s.reimpressions}) : aucune page, aucune source ne le date`; continue; }
        if (/-Additionals$/.test(s._id)) { d.raison = 'Additionals : catégorie Cardmarket qu\'aucune source ne date'; continue; }
        let b = null;
        if (s.bulba?.cleR2) b = dateBulbapedia(await r2.lireTexte(process.env.R2_BUCKET_BRUT, s.bulba.cleR2), s);
        else if (PAGES.has(s._id)) {
            // Un set « sans page » : la page de son expansion (déclarée par ses cartes), lue par la sonde et gardée avec sa révision.
            const pg = PAGES.get(s._id);
            b = dateBulbapedia(pg.content, { ...s, bulba: { ...(s.bulba || {}), titre: pg.page } });
            if (b.jour) b.de = `${b.de} (page « ${pg.page} » rév. ${pg.revid})`;
        }
        if (s.tirage === 'intl') {
            const p = pairerIntl(tcgIntl, s);
            const t = p.id && !p.uneCle ? tcgIntl.find(x => x.id === p.id) : null;
            const jourT = t ? depuisIso(t.releaseDate) : null;
            if (jourT && b?.jour && b.jour !== jourT) { d.raison = `TCGdex ${t.id} ${jourT} contre Bulbapedia ${b.jour} : sources divergentes`; continue; }
            if (jourT) { Object.assign(d, { jour: jourT, source: `tcgdex:${t.id}:${p.par}`, temoin: b?.jour ? `bulbapedia ${b.de} ${b.jour} ✅` : `bulbapedia : ${b?.raison ?? 'page non archivée'}` }); continue; }
            d.raison = `TCGdex : ${p.raison}${t && !jourT ? ' (set sans releaseDate)' : ''} · Bulbapedia : ${b ? (b.jour ? `${b.jour} (${b.de}) — seule, non écrite pour un set intl` : b.raison) : 'page non archivée'}`;
            if (p.uneCle) d.uneCle = p.id;
            continue;
        }
        if (!b) { d.raison = s.bulba?.titre ? `page « ${s.bulba.titre} » non archivée` : 'aucune page Bulbapedia (voie sans page)'; continue; }
        if (!b.jour) { d.raison = `Bulbapedia : ${b.raison}`; continue; }
        if (s.tirage === 'jp') {
            const t = tcgAsie.find(x => x.id.toLowerCase() === String(s.code || '').toLowerCase());
            const jourT = t ? depuisIso(t.releaseDate) : null;
            if (jourT && jourT !== b.jour) { d.raison = `Bulbapedia ${b.jour} (${b.de}) contre TCGdex ${t.id} ${jourT} : sources divergentes`; continue; }
            Object.assign(d, { jour: b.jour, source: `bulbapedia:${b.de}`, temoin: jourT ? `tcgdex ${t.id} ${jourT} ✅` : 'tcgdex : aucun set de ce code' });
            continue;
        }
        Object.assign(d, { jour: b.jour, source: `bulbapedia:${b.de}`, temoin: '—' });
    }
    const poses = decisions.filter(d => d.jour), refus = decisions.filter(d => !d.jour);
    const parT = {}; for (const d of decisions) { const g = parT[d.tirage] || (parT[d.tirage] = { n: 0, date: 0 }); g.n++; if (d.jour) g.date++; }
    console.log(`\nDATÉS PAR CET OUTIL : ${poses.length} / ${decisions.length} · par tirage ${Object.entries(parT).map(([k, g]) => `${k} ${g.date}/${g.n}`).join(' · ')}`);
    const raisons = {}; for (const d of refus) { const k = d.raison.replace(/«[^»]*»/g, '«…»').replace(/\b\d{4}\b|\d+/g, '#').slice(0, 90); raisons[k] = (raisons[k] || 0) + 1; }
    console.log('RESTENT SANS DATE, par raison :'); for (const [k, n] of Object.entries(raisons).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)} · ${k}`);
    const temoins = { accord: poses.filter(d => /✅/.test(d.temoin)).length, sans: poses.filter(d => !/✅/.test(d.temoin)).length };
    console.log(`témoin d'accord ${temoins.accord} · sans témoin ${temoins.sans} · divergences refusées ${refus.filter(d => /divergentes/.test(d.raison)).length}`);
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
    const relus = await cx.db.collection('sets').countDocuments({ dateSortiePoseeLe: { $exists: true } });
    console.log(`\n   ✅ ${n} dates posées (attendu ${poses.length}) · relu : ${relus} sets portent dateSortiePoseeLe`);
    if (n !== poses.length) console.log(`   🔴 ${poses.length - n} non posées : le champ s'est rempli entre la mesure et l'écriture — à ouvrir`);
    await fermer();
}

module.exports = { jourComplet, parties, dateBulbapedia, pairerIntl, depuisIso };
if (require.main === module) principal().catch(e => { console.error(e); process.exit(1); });
