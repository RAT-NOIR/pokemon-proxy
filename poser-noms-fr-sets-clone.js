// ============================================================
// LE NOM FRANÇAIS DES SETS OCCIDENTAUX ENCORE EN ANGLAIS — depuis le CLONE TCGdex, zéro requête (2026-10-07)
// ============================================================
//   node poser-noms-fr-sets-clone.js --clone=<clone> --export=<products_singles_*.json> --liste=<LISTE-SETS-SANS-NOM-FR.json du site>   (plan)
//   node lot-additif.js --quoi="…" --collections=sets -- node poser-noms-fr-sets-clone.js … --attendu=<noms>:<absents> --ecrire
//
// LA DEMANDE (site, DEMANDE-NOMS-FR-SETS.md du 2026-10-07, transmise par le testeur) : 89 sets occidentaux publiés s'affichent en anglais.
// Écrire `nomFr`, `nomFrSource`, `nomFrPreuve` — le nom OFFICIEL, avec sa source, jamais une traduction de notre main ; et pour un produit
// jamais sorti en français, `nomFrAbsent` avec sa source.
// POURQUOI UN AUTRE OUTIL QUE collecter-noms-fr-sets.js : celui-ci interrogeait l'API TCGdex sans le verrou `tcgdex/__collecteur__` (règle
// d'aujourd'hui : TCGdex seulement sous ce verrou) et n'appariait que par l'ÉGALITÉ du nom anglais — d'où ces 89 restes. Ici, le DÉPÔT
// public cloné, et une désignation par DEUX clés indépendantes au moins (la règle des dates, poser-dates-sets.js) :
//   · l'idExpansion Cardmarket : `thirdParty.cardmarket` du fichier de set, ou la MAJORITÉ des idProduct portés par ses cartes ;
//   · l'abréviation officielle TCGdex = notre code ;
//   · le nom anglais TCGdex = notre nom affiché ou `nomEn` (accents, casse, ponctuation normalisés ; « EX » de tête toléré).
// Le set TCGdex doit être le SEUL désigné par chacune des clés qui désignent quelque chose. Il doit porter `name.fr`.
// TÉMOIN (jamais source : les traductions de Bulbapedia sont sous licence non commerciale) : le `{{Langtable|fr=}}` de la page du set
// archivée chez nous. Un témoin CONTRAIRE n'écrit rien (règle 2 de rapatrier-noms-fr.js : « si les sources divergent, on écrit null »).
// ABSENT : les WCD 2004 à 2019 — « All of the decks prior to 2022 were exclusively released in English » (page « World Championships Deck
// (TCG) », copie Wayback du 2026-08-10, lue le 2026-10-07). Rien d'autre n'est déclaré absent sans une phrase de cette force.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[&+]/g, ' ').replace(/[^a-z0-9]/g, '');
const W = 'http://web.archive.org/web/20260810163632/https://bulbapedia.bulbagarden.net/wiki/World_Championships_Deck_(TCG)';

function lireSets(clone) {
    const sets = new Map(), idsDe = new Map();
    const d0 = path.join(clone, 'data');
    for (const serie of fs.readdirSync(d0)) {
        const ds = path.join(d0, serie); if (!fs.statSync(ds).isDirectory()) continue;
        for (const f of fs.readdirSync(ds)) {
            const p = path.join(ds, f);
            if (f.endsWith('.ts') && fs.statSync(p).isFile()) {
                const t = fs.readFileSync(p, 'utf8'); if (!/: Set = /.test(t)) continue;
                const nom = l => t.match(new RegExp(`name\\s*:\\s*\\{[^}]*\\b${l}\\s*:\\s*["'\`]([^"'\`]+)`))?.[1] ?? null;
                sets.set(path.join(ds, f.slice(0, -3)), { id: t.match(/\bid\s*:\s*["'`]([^"'`]+)/)?.[1], en: nom('en'), fr: nom('fr'), abbr: t.match(/abbreviations\s*:\s*\{[^}]*official\s*:\s*["'`]([^"'`]+)/)?.[1] ?? null, exp: Number(t.match(/thirdParty\s*:\s*\{[^}]*cardmarket\s*:\s*(\d+)/)?.[1]) || null });
            } else if (fs.statSync(p).isDirectory()) {
                const ids = []; for (const c of fs.readdirSync(p)) if (c.endsWith('.ts')) for (const m of fs.readFileSync(path.join(p, c), 'utf8').matchAll(/cardmarket\s*:\s*(\d+)/g)) ids.push(Number(m[1]));
                idsDe.set(p, ids);
            }
        }
    }
    return { sets, idsDe };
}

// Le `fr` de chaque `{{Langtable}}` de la page, lu DANS le gabarit — accolades et liens comptés, un `|` ne sépare que les paramètres du
// Langtable lui-même. (Relecture du 2026-10-07 : la regex paresseuse d'avant traversait la fin d'un Langtable sans `fr` et lisait le `fr=`
// d'un autre gabarit plus bas.) Rend les valeurs DISTINCTES lisibles, `{ fr, reserve }` : une infobulle `{{tt|*|…}}` dit d'où vient le nom
// (Legendary Treasures : « Pokémon Trading Card Game Online » — un nom de jeu en ligne, pas d'un produit imprimé), elle se LIT et se
// rend en `reserve` ; une valeur encore gabaritée après cela est illisible, donc tue.
function frDuLangtable(w) {
    const t = String(w || ''), vals = [];
    for (const m of t.matchAll(/\{\{\s*Langtable\b/gi)) {
        const params = []; let i = m.index + 2, prof = 1, lien = 0, debut = i;
        for (; i < t.length; i++) {
            if (t.startsWith('{{', i)) { prof++; i++; }
            else if (t.startsWith('}}', i)) { if (--prof === 0) break; i++; }
            else if (t.startsWith('[[', i)) { lien++; i++; }
            else if (t.startsWith(']]', i)) { lien = Math.max(0, lien - 1); i++; }
            else if (t[i] === '|' && prof === 1 && !lien) { params.push(t.slice(debut, i)); debut = i + 1; }
        }
        if (prof !== 0) continue;   // gabarit jamais fermé : rien de lisible
        params.push(t.slice(debut, i));
        for (const p of params.slice(1)) {
            const v = /^\s*fr\s*=([\s\S]*)$/.exec(p)?.[1];
            if (v == null) continue;
            const reserves = [];
            const x = v.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{\s*tt\s*\|\s*\*\s*\|([^{}|]*)\}\}/gi, (_, q) => { reserves.push(q.trim()); return ''; })
                .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').trim();
            if (!x || /[{}[\]|]/.test(x) || reserves.length > 1) continue;
            const r = reserves[0] || null;
            if (!vals.some(y => cle(y.fr) === cle(x) && y.reserve === r)) vals.push({ fr: x, reserve: r });
        }
    }
    return vals;
}
module.exports = { frDuLangtable };
if (require.main === module) {
const AUTORISES = [/^--clone=.+$/, /^--export=.+\.json$/, /^--liste=.+\.json$/, /^--attendu=\d+:\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CLONE = arg('clone'), EXPORT = arg('export'), LISTE = arg('liste'), ECRIRE = process.argv.includes('--ecrire');
const ATTENDU = arg('attendu')?.split(':').map(Number) ?? null;
if (!CLONE || !EXPORT || !LISTE) { console.error('❌ --clone=, --export= et --liste= requis'); process.exit(2); }
if (ECRIRE && !ATTENDU) { console.error('❌ --ecrire exige --attendu=<noms>:<absents>'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
(async () => {
    const { sets: T, idsDe } = lireSets(CLONE);
    const E = JSON.parse(fs.readFileSync(EXPORT, 'utf8')).products, expDe = new Map(E.map(p => [p.idProduct, p.idExpansion]));
    // l'expansion de chaque set TCGdex par ses idProduct : la majorité stricte (plus de la moitié des idProduct lus)
    for (const [d, s] of T) { const v = {}; let n = 0; for (const id of idsDe.get(d) || []) { const e = expDe.get(id); if (e) { v[e] = (v[e] || 0) + 1; n++; } } const top = Object.entries(v).sort((a, b) => b[1] - a[1])[0]; s.expVote = top && top[1] * 2 > n ? Number(top[0]) : null; }
    const liste = JSON.parse(fs.readFileSync(LISTE, 'utf8')).sets;
    if (!Array.isArray(liste) || !liste.length) throw new Error('liste vide');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'] });
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const S = cx.db.collection('sets');
    const plan = [];
    for (const l of liste) {
        const s = await S.findOne({ _id: l.set }, { projection: { code: 1, idExpansion: 1, nomAffichage: 1, nomEn: 1, region: 1, tirage: 1, nomFr: 1, nomFrAbsent: 1, 'bulba.cleR2': 1 } });
        if (!s) { plan.push({ id: l.set, refus: 'set absent' }); continue; }
        if (s.region !== 'intl' || (s.tirage ?? 'intl') !== 'intl') { plan.push({ id: s._id, refus: `tirage ${s.tirage ?? s.region} : pas de nom français` }); continue; }
        if (s.nomFr || s.nomFrAbsent) { plan.push({ id: s._id, refus: 'déjà un nomFr ou un nomFrAbsent' }); continue; }
        const wcd = /^WCD-(\d{4})$/.exec(s._id);
        if (wcd && Number(wcd[1]) < 2022) { plan.push({ id: s._id, absent: { valeur: 'jamais sorti en français', source: W, citation: '« All of the decks prior to 2022 were exclusively released in English. »' } }); continue; }
        const exps = [].concat(s.idExpansion ?? []), noms = [s.nomAffichage, s.nomEn].filter(Boolean).flatMap(n => [cle(n), cle(String(n).replace(/^EX\s+/i, ''))]);
        const parCle = { exp: [], code: [], nom: [] };
        for (const [d, t] of T) {
            if ((t.exp && exps.includes(t.exp)) || (t.expVote && exps.includes(t.expVote))) parCle.exp.push(d);
            if (t.abbr && s.code && cle(t.abbr) === cle(s.code)) parCle.code.push(d);
            if (t.en && noms.includes(cle(t.en))) parCle.nom.push(d);
        }
        const designes = new Set(Object.values(parCle).flat());
        const cles = Object.entries(parCle).filter(([, v]) => v.length).map(([k]) => k);
        if (designes.size !== 1 || cles.length < 2) { plan.push({ id: s._id, refus: designes.size > 1 ? `plusieurs sets TCGdex désignés (${[...designes].map(d => T.get(d).id).join(', ')})` : `${cles.length} clé(s) seulement (${cles.join(', ') || 'aucune'})` }); continue; }
        const t = T.get([...designes][0]);
        if (!t.fr) { plan.push({ id: s._id, refus: `TCGdex ${t.id} sans nom français` }); continue; }
        // (relu au plan du 2026-10-07) un `fr` IDENTIQUE à l'anglais de TCGdex n'est pas une traduction (« SVP Black Star Promos ») ; un `fr`
        // porté par PLUSIEURS sets TCGdex ne nomme pas CE set (« Collection McDonald » : 2011, 2012… — l'année perdue)
        if (cle(t.fr) === cle(t.en)) { plan.push({ id: s._id, refus: `TCGdex ${t.id} : le nom « français » est l'anglais (« ${t.fr} »)` }); continue; }
        const memesFr = [...T.values()].filter(x => x.fr && cle(x.fr) === cle(t.fr)).length;
        if (memesFr > 1) { plan.push({ id: s._id, refus: `« ${t.fr} » est le nom français de ${memesFr} sets TCGdex : il ne nomme pas ce set` }); continue; }
        // le témoin : le fr de la page archivée
        let temoin = null;
        if (s.bulba?.cleR2) {
            const v = frDuLangtable(await r2.lireTexte(process.env.R2_BUCKET_BRUT, s.bulba.cleR2));
            if (v.length > 1) { plan.push({ id: s._id, refus: `témoin ambigu — la page porte plusieurs noms français (${v.map(x => `« ${x.fr} »`).join(', ')})` }); continue; }
            // une réserve n'est ni un accord ni un désaccord : elle dit que le nom vient d'ailleurs que d'un produit imprimé — au testeur
            if (v[0]?.reserve) { plan.push({ id: s._id, refus: `réserve du témoin — « ${v[0].fr} » vient de « ${v[0].reserve} » (Bulbapedia) : jamais imprimé en français ?` }); continue; }
            temoin = v[0]?.fr ?? null;
        }
        if (temoin && cle(temoin) !== cle(t.fr)) { plan.push({ id: s._id, refus: `les sources divergent — TCGdex « ${t.fr} » · Bulbapedia « ${temoin} »` }); continue; }
        plan.push({ id: s._id, nom: s.nomAffichage, nomFr: t.fr, preuve: `TCGdex [${t.id}] désigné par ${cles.length} clés (${cles.join(' + ')}), aucun autre set TCGdex désigné ; témoin Bulbapedia ${temoin ? `« ${temoin} » d'accord` : 'absent'} ; set occidental (tirage intl)` });
    }
    const noms = plan.filter(p => p.nomFr), absents = plan.filter(p => p.absent), refus = plan.filter(p => p.refus);
    console.log(`DÉNOMINATEUR : ${liste.length} sets de la liste du site · noms ${noms.length} · absents ${absents.length} · refus ${refus.length}`);
    for (const p of noms) console.log(`   ✓ ${p.id.padEnd(40)} « ${p.nom} » → « ${p.nomFr} » · ${p.preuve}`);
    for (const p of absents) console.log(`   ∅ ${p.id.padEnd(40)} ${p.absent.valeur}`);
    const parMotif = {}; for (const p of refus) { const m = p.refus.replace(/«[^»]*»/g, '«…»').replace(/\([^)]*\)/g, '(…)'); (parMotif[m] = parMotif[m] || []).push(p.id); }
    for (const [m, ids] of Object.entries(parMotif)) console.log(`   ✗ ${ids.length} — ${m} : ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? '…' : ''}`);
    if (!ECRIRE) { console.log('(plan seul — --attendu=<noms>:<absents> --ecrire sous lot-additif.js)'); await fermer(); return; }
    if (ATTENDU[0] !== noms.length || ATTENDU[1] !== absents.length) { console.error(`❌ ARRÊT : plan ${noms.length}:${absents.length}, attendu ${ATTENDU.join(':')}`); await fermer(); process.exit(1); }
    const le = new Date(); let n = 0;
    for (const p of noms) n += (await S.updateOne({ _id: p.id, nomFr: { $in: [null] }, nomFrAbsent: { $exists: false } }, { $set: { nomFr: p.nomFr, nomFrSource: 'tcgdex', nomFrPreuve: p.preuve, nomFrPoseLe: le } })).modifiedCount;
    for (const p of absents) n += (await S.updateOne({ _id: p.id, nomFr: { $in: [null] }, nomFrAbsent: { $exists: false } }, { $set: { nomFrAbsent: p.absent.valeur, nomFrAbsentSource: `${p.absent.source} — ${p.absent.citation}`, nomFrPoseLe: le } })).modifiedCount;
    console.log(`${n === noms.length + absents.length ? '✅' : '🔴'} écrits ${n} / ${noms.length + absents.length}`);
    console.log(`SETS : ${[...noms, ...absents].map(p => p.id).join(',')}`);
    if (n !== noms.length + absents.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
}
