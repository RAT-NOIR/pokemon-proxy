// ============================================================
// LES LOGOS DÉPOSÉS À LA MAIN — « Logo FR », « Logo JP », « Logo ZH » à la racine (PNG des sites officiels, testeur, 2026-09-28)
// ============================================================
//   node rattacher-logos-manuels.js --proposer            (rattache chaque fichier par son NOM, rien d'écrit ; planches à regarder)
//   node rattacher-logos-manuels.js --table=<json> --ecrire   (sous lot-additif.js : écrit ce que la table LUE À L'ŒIL a validé)
// Le rattachement, dans cet ordre, et une proposition n'est jamais une décision :
//   · « Logo JP » / « Logo ZH » : le nom du fichier est un CODE (« SV11B », « CS15C » = CS1.5C) — comparé au code des sets du bon
//     tirage (jp ; zh-hans/zh-hant), casse, points et tirets ignorés ; UN seul set, sinon rien ;
//   · « Logo FR » : le nom du fichier est un NOM DE SET (« Lumire_interdite ») — comparé au nom français (nomFr, TCGdex), puis au nom
//     affiché, parmi les sets OCCIDENTAUX ; égalité exacte (accents, casse, ponctuation ignorés), sinon un SEUL nom à 2 lettres près
//     (« approché » : à confirmer à l'œil) ; les fichiers « jap_0xx » n'ont pas de nom → l'œil seul.
// 🔑 LA TABLE DE DÉCISION (`--table`) est écrite APRÈS avoir regardé chaque logo (collecte-cartes/logos-manuels-lus.json) : pour chaque
// fichier, le set, la LANGUE LUE, le champ visé. L'écriture ne fait que ce qu'elle dit, et refuse :
//   · `logoFr` déjà présent (« à côté du logo actuel, sans le remplacer ») — listé, jamais écrasé ;
//   · `logo` déjà présent, sauf une ligne `remplacer` portant sa RAISON, dans DEUX cas seulement : un logo anglais d'une série sortie
//     seulement en anglais (« s'il n'en a pas ou si celui-ci est meilleur »), ou un logo actuel GÉNÉRIQUE (`logoGenerique`, refusés par
//     le testeur le 2026-09-28) ; une ligne `remplacer` hors de ces cas REFUSE (rien n'est écrit) ;
//   · un set qui n'existe pas, un fichier absent, un fichier qui a changé depuis la table (sha1).
// Le fichier va sur R2 sous `logos/manuel/<dossier>/<fichier>-<sha1>.png` (l'empreinte dans la clé depuis la revue du 2026-09-28 ; les
// 192 premiers sont sans elle) ; le champ porte `source: 'manuel'`, le dossier, le fichier, la langue
// lue et la preuve. Les vignettes se posent ensuite (generer-vignettes.js --logos), la revalidation par lot-additif.js.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AUTORISES = [/^--proposer$/, /^--table=.+\.json$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --proposer, --table=<json>, --ecrire`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const { ouvrirConnexions } = require('./collecte-cartes/garde');
// ➕ 2026-10-04 : une copie de Pokécardex (par empreinte, collecte-cartes/langue-logo.js) n'est jamais rattachée, même si la table
// lue la rattache (décision du testeur : « les 22 logos copiés de Pokécardex : retirés »).
const { refusCopie } = require('./collecte-cartes/langue-logo');

const DOSSIERS = { 'Logo FR': ['intl'], 'Logo JP': ['jp'], 'Logo ZH': ['zh-hans', 'zh-hant'] };
const plat = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' et ').toLowerCase().replace(/[^a-z0-9]+/g, '');
const codePlat = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
}
function lister(racine) {
    const out = [];
    for (const [dossier] of Object.entries(DOSSIERS)) {
        const base = path.join(racine, dossier);
        if (!fs.existsSync(base)) { out.push({ dossier, absent: true }); continue; }
        const marcher = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) marcher(p); else out.push({ dossier, relatif: path.relative(base, p).replace(/\\/g, '/'), chemin: p }); } };
        marcher(base);
    }
    return out;
}

function proposer(f, sets) {
    const tirages = DOSSIERS[f.dossier];
    const pool = sets.filter(s => tirages.includes(s.tirage ?? s.region));
    const tige = path.basename(f.relatif, path.extname(f.relatif));
    if (/^jap_\d+$/i.test(tige)) return { etat: 'sans-nom', preuve: 'fichier « jap_NNN » : le nom ne dit rien du set — l\'œil seul' };
    if (f.dossier !== 'Logo FR') {
        const c = codePlat(tige);
        const m = pool.filter(s => codePlat(s.code) === c);
        if (m.length === 1) return { etat: 'code', slug: m[0]._id, preuve: `code du fichier « ${tige} » = code du set « ${m[0].code} » (tirage ${m[0].tirage ?? m[0].region})` };
        if (m.length > 1) return { etat: 'ambigu', candidats: m.map(s => s._id), preuve: `code « ${tige} » porté par ${m.length} sets` };
        return { etat: 'aucun', preuve: `aucun set ${tirages.join('/')} au code « ${tige} »` };
    }
    const n = plat(tige.replace(/_/g, ' '));
    for (const champ of ['nomFr', 'nomAffichage', 'nomEn']) {
        const m = pool.filter(s => plat(s[champ]) === n);
        if (m.length === 1) return { etat: 'nom', slug: m[0]._id, preuve: `nom du fichier « ${tige} » = ${champ} « ${m[0][champ]} »` };
        if (m.length > 1) return { etat: 'ambigu', candidats: m.map(s => s._id), preuve: `« ${tige} » = ${champ} de ${m.length} sets` };
    }
    const proches = [];
    for (const s of pool) for (const champ of ['nomFr', 'nomAffichage']) { const v = plat(s[champ]); if (v && distance(v, n) <= 2) proches.push({ s, champ }); }
    const uniques = [...new Map(proches.map(p => [p.s._id, p])).values()];
    if (uniques.length === 1) return { etat: 'approche', slug: uniques[0].s._id, preuve: `nom du fichier « ${tige} » à ≤ 2 lettres du ${uniques[0].champ} « ${uniques[0].s[uniques[0].champ]} » — seul set aussi proche : À CONFIRMER À L'ŒIL` };
    if (uniques.length > 1) return { etat: 'ambigu', candidats: uniques.map(p => p.s._id), preuve: `« ${tige} » proche de ${uniques.length} sets` };
    return { etat: 'aucun', preuve: `aucun set occidental au nom « ${tige} » (nomFr, nomAffichage, nomEn ; ≤ 2 lettres)` };
}

(async () => {
    const racine = __dirname;
    const fichiers = lister(racine);
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: process.argv.includes('--ecrire') ? ['R2_BUCKET_IMAGES'] : [] });
    const sets = await cx.db.collection('sets').find({}, { projection: { code: 1, tirage: 1, region: 1, nomAffichage: 1, nomFr: 1, nomEn: 1, logo: 1, logoFr: 1, logoGenerique: 1 } }).toArray();
    const parSlug = new Map(sets.map(s => [s._id, s]));
    for (const d of fichiers.filter(f => f.absent)) console.log(`⚠️ dossier « ${d.dossier} » absent`);
    const presents = fichiers.filter(f => !f.absent);
    console.log(`DÉNOMINATEUR : ${presents.length} fichiers — ${Object.keys(DOSSIERS).map(d => `${d} ${presents.filter(f => f.dossier === d).length}`).join(' · ')} · ${sets.length} sets en base`);

    if (process.argv.includes('--proposer')) {
        const sharp = require('sharp');
        const lignes = [];
        for (const f of presents) {
            const buf = fs.readFileSync(f.chemin);
            const meta = await sharp(buf).metadata();
            const p = proposer(f, sets);
            const s = p.slug ? parSlug.get(p.slug) : null;
            lignes.push({ dossier: f.dossier, fichier: f.relatif, sha1: crypto.createHash('sha1').update(buf).digest('hex'), w: meta.width, h: meta.height, alpha: !!meta.hasAlpha, ...p,
                set: s ? { code: s.code, tirage: s.tirage ?? s.region, nomAffichage: s.nomAffichage, nomFr: s.nomFr ?? null, logo: s.logo ? { source: s.logo.source, w: s.logo.w, h: s.logo.h, generique: !!s.logoGenerique, fichier: s.logo.fichier ?? null } : null, logoFr: s.logoFr ? { source: s.logoFr.source, w: s.logoFr.w } : null } : null });
        }
        const parEtat = {}; for (const l of lignes) { const k = `${l.dossier} · ${l.etat}`; parEtat[k] = (parEtat[k] || 0) + 1; }
        console.log(JSON.stringify(parEtat, null, 1));
        const doublons = new Map(); for (const l of lignes.filter(l => l.slug)) (doublons.get(l.slug) || doublons.set(l.slug, []).get(l.slug)).push(`${l.dossier}/${l.fichier}`);
        for (const [slug, fs_] of doublons) if (fs_.length > 1) console.log(`   ⚠️ ${slug} ← ${fs_.length} fichiers : ${fs_.join(', ')}`);
        const sortie = path.join(racine, 'logos-manuels-propositions.json');
        fs.writeFileSync(sortie, JSON.stringify(lignes, null, 1));
        console.log(`écrit : ${path.basename(sortie)} (${lignes.length} lignes) — à regarder à l'œil avant toute table de décision`);
        await fermer(); return;
    }
    // ── LA TABLE LUE À L'ŒIL → le plan, puis (--ecrire) l'écriture
    const T = arg('table');
    if (!T) { console.error('❌ --table=<collecte-cartes/logos-manuels-lus.json> requis (hors --proposer)'); await fermer(); process.exit(2); }
    const table = JSON.parse(fs.readFileSync(path.resolve(racine, T), 'utf8'));
    const parFichier = new Map(presents.map(f => [`${f.dossier}/${f.relatif}`, f]));
    const plan = planifier(table.lignes, { parFichier, parSlug });
    const compte = {}; for (const p of plan) { const k = `${p.dossier} · ${p.action}`; compte[k] = (compte[k] || 0) + 1; }
    console.log(`PLAN (table du ${table.lu}, ${table.lignes.length} lignes) :\n${Object.entries(compte).sort().map(([k, v]) => `   ${String(v).padStart(4)} · ${k}`).join('\n')}`);
    for (const p of plan.filter(p => p.action === 'refus')) console.log(`   🔴 REFUS ${p.dossier}/${p.fichier} : ${p.raison}`);
    for (const p of plan.filter(p => p.action === 'remplacer')) console.log(`   ↻ ${p.slug} (${p.champ}) : ${p.raison}`);
    // les sets GARDÉS se nomment (revue du 2026-09-28) : un logo générique gardé est une proposition de remplacement, pas un oubli
    for (const p of plan.filter(p => p.action.startsWith('garde-'))) console.log(`   = ${p.action.padEnd(21)} ${p.slug} ← ${p.dossier}/${p.fichier} (${p.raison})`);
    if (plan.some(p => p.action === 'refus')) { console.error('❌ la table a des lignes refusées : rien n\'est écrit'); await fermer(); process.exit(1); }
    if (!process.argv.includes('--ecrire')) { console.log('   (plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }
    const r2 = require('./collecte-cartes/r2');
    const bucket = process.env.R2_BUCKET_IMAGES;
    await r2.verifierBucket(bucket);
    const S = cx.db.collection('sets');
    let ecrits = 0;
    for (const p of plan.filter(p => p.action === 'ecrire' || p.action === 'remplacer')) {
        const f = parFichier.get(`${p.dossier}/${p.fichier}`);
        const buf = fs.readFileSync(f.chemin);
        // 🔴 revue du 2026-09-28 : la clé porte l'EMPREINTE du fichier — `deposerBinaire` ne réécrit pas une clé existante, et un fichier
        // redéposé sous le même nom (un remplacement) aurait laissé l'ancienne image sur R2 sous le nouveau sha1 en base. (Les 192 premiers
        // logos, 2026-09-28, sont sous la clé sans empreinte : aucune collision, `logos/manuel/` était vide.)
        const cle = `logos/manuel/${cleDe(p.dossier)}/${cleDe(p.fichier).replace(/\.png$/i, '')}-${p.sha1.slice(0, 10)}.png`;
        const depot = await r2.deposerBinaire(bucket, cle, buf, 'image/png');
        const valeur = { cleR2: cle, w: p.w, h: p.h, octets: buf.length, sha1: p.sha1, fichier: `${p.dossier}/${p.fichier}`, source: 'manuel', langue: p.langue,
            preuve: `déposé à la main par le testeur (${p.montage ? 'image-texte ou montage « Promos », pas un logo de set officiel seul' : 'PNG d\'un site officiel'}) ; lu à l'œil le ${table.lu} : ${p.parQuoi}${p.memeTexteEnAnglais ? ' ; le nom s\'écrit pareil en anglais' : ''}`, le: new Date() };
        // la condition d'écriture est celle du PLAN, relue dans la requête : un champ apparu entre-temps n'est pas écrasé ; un champ
        // null ou sans image ({}) compte comme absent, comme dans le plan (revue du 2026-09-28)
        const filtre = { _id: p.slug, ...(p.action === 'remplacer' ? { [`${p.champ}.sha1`]: p.ancienSha1 ?? null, [`${p.champ}.cleR2`]: p.ancienneCle } : { [`${p.champ}.cleR2`]: { $exists: false } }) };
        const maj = { $set: { [p.champ]: valeur, ...(p.champ === 'logo' ? { logoGenerique: false } : {}) }, ...(p.champ === 'logo' ? { $unset: { logoRefus: '', logoGeneriquePreuve: '' } } : {}) };
        const u = await S.updateOne(filtre, maj);
        if (u.modifiedCount !== 1) console.log(`   ⚠️ ${p.slug} (${p.champ}) : non écrit — le champ a changé depuis le plan${depot?.ecrit ? ` (fichier déposé sous ${cle}, orphelin)` : ''}`); else ecrits++;
    }
    const attendus = plan.filter(p => p.action === 'ecrire' || p.action === 'remplacer').length;
    const relus = await S.countDocuments({ $or: [{ 'logo.source': 'manuel' }, { 'logoFr.source': 'manuel' }] });
    console.log(`\n${ecrits === attendus ? '✅' : '🔴'} écrits ${ecrits} / ${attendus} · RELU : ${relus} sets portent un logo « manuel » · logo ${await S.countDocuments({ 'logo.cleR2': { $type: 'string' } })} · logoFr ${await S.countDocuments({ 'logoFr.cleR2': { $type: 'string' } })}`);
    if (ecrits !== attendus) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

const cleDe = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9./-]+/g, '-').replace(/-+/g, '-');

/** Le plan d'une table lue : pour chaque ligne rattachée, écrire / remplacer / garder l'existant (dit) / refuser (fichier, set, tirage). */
function planifier(lignes, { parFichier, parSlug }) {
    const out = [];
    for (const l of lignes) {
        const base = { dossier: l.dossier, fichier: l.fichier, slug: l.slug, champ: l.champ, langue: l.langue, w: l.w, h: l.h, sha1: l.sha1, parQuoi: l.parQuoi, memeTexteEnAnglais: l.memeTexteEnAnglais, montage: l.montage };
        if (refusCopie(l.sha1)) { out.push({ ...base, action: 'non-rattache', raison: refusCopie(l.sha1) }); continue; }
        if (l.decision !== 'rattache') { out.push({ ...base, action: 'non-rattache', raison: l.raison }); continue; }
        const f = parFichier.get(`${l.dossier}/${l.fichier}`);
        if (!f) { out.push({ ...base, action: 'refus', raison: 'fichier absent du dossier' }); continue; }
        if (crypto.createHash('sha1').update(fs.readFileSync(f.chemin)).digest('hex') !== l.sha1) { out.push({ ...base, action: 'refus', raison: 'le fichier a changé depuis la lecture (sha1)' }); continue; }
        const s = parSlug.get(l.slug);
        if (!s) { out.push({ ...base, action: 'refus', raison: `set « ${l.slug} » absent de la base` }); continue; }
        if (!DOSSIERS[l.dossier].includes(s.tirage ?? s.region)) { out.push({ ...base, action: 'refus', raison: `set de tirage ${s.tirage ?? s.region}, dossier ${l.dossier}` }); continue; }
        // la garde s'écrit par ce qu'elle AUTORISE (revue du 2026-09-28) : les seuls couples (dossier, champ, langue) de la consigne
        const PERMIS = { 'Logo FR': ['logoFr|fr', 'logo|en'], 'Logo JP': ['logo|ja'], 'Logo ZH': ['logo|zh-hans', 'logo|zh-hant'] };
        if (!(PERMIS[l.dossier] || []).includes(`${l.champ}|${l.langue}`)) { out.push({ ...base, action: 'refus', raison: `champ ${l.champ} en langue ${l.langue} depuis ${l.dossier} : hors de la consigne` }); continue; }
        const actuel = s[l.champ];
        if (!actuel?.cleR2) { out.push({ ...base, action: 'ecrire' }); continue; }
        if (actuel.sha1 && actuel.sha1 === l.sha1) { out.push({ ...base, action: 'deja-identique' }); continue; }
        // remplacer : le logo anglais d'une série sortie seulement en anglais, ou un logo GÉNÉRIQUE (le même fichier pour plusieurs sets) —
        // « les logos génériques sont refusés » (testeur, 2026-09-28 : les trois 横空出世 des Storming Emergence)
        if (l.champ === 'logo' && l.remplacer && (l.langue === 'en' || s.logoGenerique === true)) { out.push({ ...base, action: 'remplacer', raison: l.remplacer, ancienSha1: actuel.sha1 ?? null, ancienneCle: actuel.cleR2 }); continue; }
        // une ligne qui DEMANDE un remplacement hors de ces deux cas n'est pas gardée en silence : elle refuse (et rien n'est écrit)
        if (l.remplacer) { out.push({ ...base, action: 'refus', raison: `« remplacer » demandé, mais le ${l.champ} actuel n'est ni générique ni remplaçable par un logo ${l.langue}` }); continue; }
        out.push({ ...base, action: l.champ === 'logoFr' ? 'garde-logoFr' : (s.logoGenerique ? 'garde-logo-generique' : 'garde-logo'), raison: `${l.champ} actuel : ${actuel.source} ${actuel.w ?? '?'} px` });
    }
    return out;
}
