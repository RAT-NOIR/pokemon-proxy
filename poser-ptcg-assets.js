// ============================================================
// LE DÉPÔT 1niceroli/ptcg-assets — logos manquants et SYMBOLES à part (décision du testeur, 2026-09-27 : « pas de fichier de licence :
// j'ai décidé de l'utiliser. Enregistre la source sur chaque fichier. Garde aussi les SYMBOLES de set à part : ils serviront à
// l'identification. »)
// ============================================================
//   node poser-ptcg-assets.js --clone=<clone local du dépôt>             (plan : ce qui serait posé, rien d'écrit)
//   node poser-ptcg-assets.js --clone=<…> --ecrire                       (sous lot-additif.js)
// Le RATTACHEMENT d'un dossier (un par set : logo.png, symbol.png) à NOS sets : l'identifiant japonais `ja_<code>` = notre code (jp),
// sinon le NOM du README (table ID | Language | Name) = notre nom affiché ou anglais, UN seul set de la langue.
// Ce qui s'écrit, et rien d'autre — écriture ADDITIVE :
//   · `logo` d'un set QUI N'EN A PAS : source `ptcg-assets`, le dossier et le commit du dépôt ; un logo qui ne distingue pas le set
//     (les McDonald's : son empreinte est dans la table des génériques, langue-logo.js) est REFUSÉ depuis le 2026-09-28 (testeur :
//     « les logos génériques sont retirés ») — son refus s'écrit (`logoRefus`) sur un set sans logo, rien d'autre ; un fichier
//     partagé par plusieurs dossiers SANS être dans la table se liste « à regarder » et ne s'écrit pas ;
//   · `symbolesIdentification` : une entrée `ptcg-assets` à côté du `symbole` que le site affiche (jamais lui) — pour l'identification.
// LU À L'ŒIL (2026-09-28, planches) : les exclusions ci-dessous, chacune avec sa raison.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AUTORISES = [/^--clone=.+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --clone=<dossier>, --ecrire`); process.exit(2); }
const CLONE = process.argv.find(a => a.startsWith('--clone='))?.slice(8);
if (!CLONE || !fs.existsSync(path.join(CLONE, 'README.md'))) { console.error('❌ --clone=<clone de 1niceroli/ptcg-assets> requis (README.md introuvable)'); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { logoGenerique, refusGenerique } = require('./collecte-cartes/langue-logo');

const SYMBOLES_EXCLUS = {
    'sv9|JTG': 'le symbole du dossier sv9 est le code japonais « sv9 » (lu) : une carte Journey Together porte « JTG »',
    'sv9|xJTG': 'idem sv9 : code japonais « sv9 » sur un set anglais',
    'tot23|BOO23': 'le « symbol.png » de tot23 est le LOGO Trick or Trade (lu), pas un symbole',
    'tot24|BOO24': 'le « symbol.png » de tot24 est le LOGO Trick or Trade (lu), pas un symbole'
};
const plat = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');

(async () => {
    const readme = fs.readFileSync(path.join(CLONE, 'README.md'), 'utf8');
    const table = [...readme.matchAll(/^\|\s*([\w.-]+)\s*\|\s*(\w+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/gm)].filter(m => m[1] !== 'ID').map(m => ({ id: m[1], langue: m[2], nom: m[3] }));
    const dossiers = fs.readdirSync(CLONE, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '_to_sort').map(e => e.name);
    const fichierDe = (id, base) => { const f = fs.readdirSync(path.join(CLONE, id)).find(x => new RegExp(`^${base}\\.png$`, 'i').test(x)); return f ? path.join(CLONE, id, f) : null; };
    let commit = null;
    try { commit = fs.readFileSync(path.join(CLONE, '.git', 'HEAD'), 'utf8').trim(); if (commit.startsWith('ref:')) commit = fs.readFileSync(path.join(CLONE, '.git', commit.slice(5).trim()), 'utf8').trim(); } catch (_) { /* dit plus bas */ }
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ecrire ? ['R2_BUCKET_IMAGES'] : [] });
    const S = cx.db.collection('sets');
    const sets = await S.find({}, { projection: { code: 1, tirage: 1, region: 1, nomAffichage: 1, nomEn: 1, logo: 1, symbolesIdentification: 1 } }).toArray();
    const parNom = new Map(); for (const r of table) { const k = `${r.langue}|${plat(r.nom)}`; (parNom.get(k) || parNom.set(k, []).get(k)).push(r); }
    const t = s => s.tirage ?? s.region;
    const rattaches = [];
    for (const s of sets) {
        const lang = t(s) === 'jp' ? 'ja' : t(s) === 'intl' ? 'en' : null;
        if (!lang) continue;
        let id = null, par = null;
        if (lang === 'ja' && dossiers.includes(`ja_${String(s.code).toLowerCase()}`)) { id = `ja_${String(s.code).toLowerCase()}`; par = `code « ${s.code} »`; }
        if (!id) for (const n of [s.nomAffichage, s.nomEn]) { const m = parNom.get(`${lang}|${plat(n)}`); if (m && m.length === 1 && dossiers.includes(m[0].id)) { id = m[0].id; par = `nom « ${n} » (README : « ${m[0].nom} »)`; break; } }
        if (id) rattaches.push({ s, id, par });
    }
    // un fichier de logo partagé par plusieurs sets ne les distingue pas : générique (par l'EMPREINTE, pas par le nom)
    const logosLus = new Map();
    for (const r of rattaches) { const f = fichierDe(r.id, 'logo'); if (f) { const b = fs.readFileSync(f); r.logo = { f, b, sha1: sha1(b) }; logosLus.set(r.logo.sha1, (logosLus.get(r.logo.sha1) || 0) + 1); } }
    // Relecture du 2026-09-29 : GÉNÉRIQUE = l'empreinte est dans la table lue à l'œil (langue-logo.js), rien d'autre. Un fichier partagé
    // par plusieurs dossiers sans y être peut être un set et ses Additionals (justes, §56) : il se REGARDE, il ne s'écrit pas.
    const plan = { logos: [], generiques: [], aRegarder: [], symboles: [], exclus: [] };
    for (const r of rattaches) {
        if (r.logo && !r.s.logo?.cleR2) (logoGenerique(r.logo.sha1) ? plan.generiques : logosLus.get(r.logo.sha1) > 1 ? plan.aRegarder : plan.logos).push(r);
        const fs_ = fichierDe(r.id, 'symbol');
        if (!fs_) continue;
        const cle = `${r.id}|${r.s.code}`;
        if (SYMBOLES_EXCLUS[cle]) { plan.exclus.push({ slug: r.s._id, id: r.id, raison: SYMBOLES_EXCLUS[cle] }); continue; }
        if ((r.s.symbolesIdentification || []).some(x => x.source === 'ptcg-assets')) continue;
        const b = fs.readFileSync(fs_);
        plan.symboles.push({ ...r, sym: { f: fs_, b, sha1: sha1(b) } });
    }
    console.log(`DÉNOMINATEUR : README ${table.length} lignes · ${dossiers.length} dossiers · commit ${commit ?? 'inconnu'} · ${rattaches.length} sets rattachés (code ${rattaches.filter(r => r.par.startsWith('code')).length}, nom ${rattaches.filter(r => r.par.startsWith('nom')).length})`);
    console.log(`PLAN : ${plan.logos.length} logo(s) pour des sets SANS logo · ${plan.generiques.length} GÉNÉRIQUE(S) refusé(s) · ${plan.symboles.length} symbole(s) à part · ${plan.exclus.length} symbole(s) exclu(s) à l'œil`);
    for (const l of plan.logos) console.log(`   + logo ${l.s.code} ${l.s._id} ← ${l.id}/logo.png · ${l.par}`);
    for (const l of plan.generiques) console.log(`   ✗ logo ${l.s.code} ${l.s._id} ← ${l.id}/logo.png : GÉNÉRIQUE (table lue à l'œil) — refusé`);
    for (const l of plan.aRegarder) console.log(`   👁️ logo ${l.s.code} ${l.s._id} ← ${l.id}/logo.png : le même fichier pour ${logosLus.get(l.logo.sha1)} dossiers, absent de la table des génériques — à regarder, rien d'écrit`);
    for (const x of plan.exclus) console.log(`   ✗ symbole ${x.slug} ← ${x.id} : ${x.raison}`);
    if (!commit) { console.error('❌ le commit du dépôt n\'est pas lisible : la source ne serait pas datée — rien n\'est écrit'); await fermer(); process.exit(1); }
    if (!ecrire) { console.log('   (plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }
    const sharp = require('sharp');
    const r2 = require('./collecte-cartes/r2');
    const bucket = process.env.R2_BUCKET_IMAGES;
    await r2.verifierBucket(bucket);
    const source = { source: 'ptcg-assets', depot: 'https://github.com/1niceroli/ptcg-assets', commit, le: new Date() };
    let nLogos = 0, nSym = 0;
    for (const l of plan.logos) {
        const m = await sharp(l.logo.b).metadata();
        const cle = `logos/ptcg-assets/${l.id}-${l.logo.sha1.slice(0, 10)}.png`;
        await r2.deposerBinaire(bucket, cle, l.logo.b, 'image/png');
        const valeur = { cleR2: cle, w: m.width, h: m.height, octets: l.logo.b.length, sha1: l.logo.sha1, fichier: `${l.id}/logo.png`, ...source,
            preuve: `dépôt ptcg-assets (décision du testeur, sans fichier de licence) ; dossier ${l.id} rattaché par ${l.par} ; lu à l'œil le 2026-09-28` };
        const u = await S.updateOne({ _id: l.s._id, 'logo.cleR2': { $exists: false } }, { $set: { logo: valeur, logoGenerique: false }, $unset: { logoRefus: '' } });
        if (u.modifiedCount === 1) nLogos++; else console.log(`   ⚠️ logo ${l.s._id} : non écrit (un logo est apparu depuis le plan)`);
    }
    // le refus d'un générique s'écrit (§46) — seulement sur un set sans logo et sans refus déjà écrit (celui d'un autre outil garde sa
    // cause, qui est plus ancienne) : ajout pur, compté
    let nRefusGen = 0;
    for (const l of plan.generiques) nRefusGen += (await S.updateOne({ _id: l.s._id, 'logo.cleR2': { $exists: false }, logoRefus: { $exists: false } }, { $set: { logoRefus: {
        motif: refusGenerique(l.logo.sha1), fichier: `${l.id}/logo.png`, sha1: l.logo.sha1, le: new Date(), instrument: 'poser-ptcg-assets.js', source: 'ptcg-assets' } } })).modifiedCount;
    console.log(`   génériques : ${nRefusGen} refus écrits sur ${plan.generiques.length} (les autres portaient déjà un refus, gardé)`);
    for (const x of plan.symboles) {
        const m = await sharp(x.sym.b).metadata();
        const cle = `symboles/ptcg-assets/${x.id}-${x.sym.sha1.slice(0, 10)}.png`;
        await r2.deposerBinaire(bucket, cle, x.sym.b, 'image/png');
        const entree = { cleR2: cle, w: m.width, h: m.height, octets: x.sym.b.length, sha1: x.sym.sha1, fichier: `${x.id}/symbol.png`, ...source, preuve: `dossier ${x.id} rattaché par ${x.par}` };
        const u = await S.updateOne({ _id: x.s._id, 'symbolesIdentification.source': { $ne: 'ptcg-assets' } }, { $push: { symbolesIdentification: entree } });
        if (u.modifiedCount === 1) nSym++;
    }
    const relus = await S.countDocuments({ 'symbolesIdentification.source': 'ptcg-assets' });
    console.log(`\n${nLogos === plan.logos.length && nSym === plan.symboles.length ? '✅' : '🔴'} logos ${nLogos}/${plan.logos.length} · symboles ${nSym}/${plan.symboles.length} · RELU : ${relus} sets portent un symbole ptcg-assets · ${await S.countDocuments({ 'logo.cleR2': { $type: 'string' } })} sets à logo`);
    if (nLogos !== plan.logos.length || nSym !== plan.symboles.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
