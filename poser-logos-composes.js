// ============================================================
// POSER LES LOGOS COMPOSÉS — `sets.logoCompose` (planche PROPOSITION-3 validée par le testeur le 2026-10-04 ; règle et table :
// collecte-cartes/logo-compose.js ; ce que le site lit : rat-market-site lib/visuelSet.ts)
// ============================================================
//   node poser-logos-composes.js --sources=<dossier>                (plan + rendus + planche LOGOS-COMPOSES-FINAL.png — rien d'écrit)
//   node lot-additif.js --quoi="logos composés" --collections=sets -- node poser-logos-composes.js --sources=<dossier> --ecrire
//   puis : node generer-vignettes.js --ecrire --logos --champ=logoCompose ; node collecte-cartes/revalider-site.js --sets=… --sets-info
// --sources : le dossier des logos COMMUNS qui ne sont pas un logo de set en base (pop9/logo.png, mcd14/logo.png de ptcg-assets ;
// battle-academy-logo.png de Bulbagarden) — chaque fichier est vérifié contre l'empreinte de SOURCES, puis déposé sur R2 (logos/composes/
// sources/) pour que le rendu se refasse depuis notre archive. Les logos de SÉRIE (promos occidentales) se lisent sur R2 (sets.logo du set
// de tête). ADDITIF : un champ neuf (`logoCompose`), écrit seulement s'il est absent (relu dans le filtre de la requête) ; chaque fichier
// sous une clé qui porte son empreinte (deposerBinaire ne réécrit jamais une clé).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AUTORISES = [/^--sources=.+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --sources=<dossier>, --ecrire`); process.exit(2); }
const SOURCES_DIR = process.argv.find(a => a.startsWith('--sources='))?.slice(10);
const ECRIRE = process.argv.includes('--ecrire');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const sharp = require('sharp');
const M = require('./collecte-cartes/logo-compose');
const FICHIERS_SOURCES = { pop: 'pop9/logo.png', mcdonalds: 'mcd14/logo.png', 'battle-academy': 'battle-academy-logo.png' };

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    const bucket = process.env.R2_BUCKET_IMAGES; await r2.verifierBucket(bucket);
    const S = cx.db.collection('sets');
    const sets = await S.find({}, { projection: { region: 1, tirage: 1, logo: 1, logoFr: 1, logoCompose: 1, 'bulba.pageid': 1 } }).toArray();
    if (!sets.length) throw new Error('collection sets vide : base fausse');
    const plan = M.planifier(sets);
    const nb = a => plan.filter(p => p.action === a).length;
    console.log(`DÉNOMINATEUR : ${sets.length} sets en base · ${plan.length} dans la table des compositions · à écrire ${nb('ecrire')} · gardés (logo propre) ${nb('garde-logo-propre')} · gardés (déjà composé) ${nb('garde-deja-compose')} · refusés ${nb('refus')}`);
    for (const p of plan) console.log(`   ${p.action.padEnd(19)} ${p.slug.padEnd(36)} ${String(p.tirage).padEnd(8)} ${p.logoCle ?? (p.etoile ? '(étoile seule)' : '(étiquette seule)')} + « ${p.etiquette}${p.sous ? ` / ${p.sous}` : ''} » — ${p.raison}`);
    if (nb('refus')) { console.error('❌ des lignes refusées : rien n\'est écrit'); await fermer(); process.exit(1); }
    const col = M.collisions(plan); if (col.length) { console.error(`❌ logos identiques (le site les dirait génériques) : ${JSON.stringify(col)}`); await fermer(); process.exit(1); }

    // les logos communs : vérifiés par leur empreinte, lus sur R2 s'ils y sont déjà, sinon dans --sources
    const tampons = new Map();
    for (const [nom, s] of Object.entries(M.SOURCES)) {
        let buf = null;
        if (await r2.existe(bucket, s.cle)) buf = await r2.lireBinaire(bucket, s.cle);
        else if (SOURCES_DIR) buf = fs.readFileSync(path.join(SOURCES_DIR, FICHIERS_SOURCES[nom]));
        else throw new Error(`source « ${nom} » absente de R2 (${s.cle}) et pas de --sources`);
        if (M.sha1(buf) !== s.sha1) throw new Error(`source « ${nom} » : empreinte ${M.sha1(buf)} ≠ ${s.sha1} attendue`);
        tampons.set(s.cle, buf);
        if (ECRIRE) { const d = await r2.deposerBinaire(bucket, s.cle, buf, 'image/png'); console.log(`   source ${nom} : ${d.ecrit ? 'déposée' : 'déjà sur R2'} (${s.cle})`); }
    }
    // les rendus, et leur unicité contre TOUS les logos de la base (un sha1 partagé serait générique pour le site)
    const existants = new Set(sets.flatMap(s => ['logo', 'logoFr', 'logoCompose'].map(c => s[c]?.sha1?.toLowerCase()).filter(Boolean)));
    const aEcrire = plan.filter(p => p.action === 'ecrire');
    const sortie = path.join(__dirname, 'logos-composes-rendus'); fs.mkdirSync(sortie, { recursive: true });
    for (const p of aEcrire) {
        const logo = p.logoCle ? (tampons.get(p.logoCle) ?? await r2.lireBinaire(bucket, p.logoCle)) : null;
        p.png = await M.composer({ logo, etiquette: p.etiquette, sous: p.sous, etoile: !!p.etoile });
        p.sha1 = M.sha1(p.png);
        const m = await sharp(p.png).metadata(); p.w = m.width; p.h = m.height;
        fs.writeFileSync(path.join(sortie, `${M.cleDe(p.slug)}.png`), p.png);
    }
    const doublons = aEcrire.filter((p, i) => aEcrire.findIndex(q => q.sha1 === p.sha1) !== i || existants.has(p.sha1));
    if (doublons.length) { console.error(`❌ rendu déjà porté par un autre set : ${doublons.map(p => p.slug).join(', ')}`); await fermer(); process.exit(1); }
    console.log(`RENDUS : ${aEcrire.length} fichiers distincts (${sortie})`);
    // la planche, fond clair et fond sombre, pour la regarder
    const CW = 1100, rangs = [];
    for (const p of aEcrire) {
        const leg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="30"><text x="20" y="21" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="#222">${String(`${p.slug} (${p.tirage}) — ${p.logoCle ?? 'sans logo commun'}`).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
        rangs.push(await sharp({ create: { width: CW, height: p.h + 40 + 30, channels: 4, background: '#ffffff' } }).composite([
            { input: await sharp({ create: { width: 520, height: p.h + 20, channels: 4, background: '#f3f4f6' } }).png().toBuffer(), left: 20, top: 10 },
            { input: p.png, left: 40, top: 20 },
            { input: await sharp({ create: { width: 520, height: p.h + 20, channels: 4, background: '#0f1115' } }).png().toBuffer(), left: 560, top: 10 },
            { input: p.png, left: 580, top: 20 },
            { input: Buffer.from(leg), left: 0, top: p.h + 36 }]).png().toBuffer());
    }
    const hs = await Promise.all(rangs.map(async r => (await sharp(r).metadata()).height));
    let y = 0; const comp = rangs.map((r, i) => { const c = { input: r, left: 0, top: y }; y += hs[i]; return c; });
    if (comp.length) await sharp({ create: { width: CW, height: y, channels: 4, background: '#ffffff' } }).composite(comp).png().toFile(path.join(__dirname, 'LOGOS-COMPOSES-FINAL.png'));
    console.log(`PLANCHE : ${path.join(__dirname, 'LOGOS-COMPOSES-FINAL.png')}`);
    if (!ECRIRE) { console.log('(plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }

    let ecrits = 0;
    for (const p of aEcrire) {
        const cle = `logos/composes/${M.cleDe(p.slug)}-${p.sha1.slice(0, 10)}.png`;
        const d = await r2.deposerBinaire(bucket, cle, p.png, 'image/png');
        const valeur = { cleR2: cle, w: p.w, h: p.h, octets: p.png.length, sha1: p.sha1, region: p.region, source: 'compose', famille: p.famille,
            elements: { logo: p.logoCle, etoile: !!p.etoile, etiquette: p.etiquette, sous: p.sous ?? null },
            preuve: `logo composé par rat-market (planche validée par le testeur le 2026-10-04) : ${p.logoCle ? `logo commun ${p.logoCle}` : 'sans logo commun (autre tirage)'}${p.etoile ? ' + étoile noire' : ''} + « ${p.etiquette}${p.sous ? ` / ${p.sous}` : ''} » ; région du set`, le: new Date() };
        const u = await S.updateOne({ _id: p.slug, 'logoCompose.cleR2': { $exists: false } }, { $set: { logoCompose: valeur } });
        if (u.modifiedCount === 1) ecrits++; else console.log(`   ⚠️ ${p.slug} : non écrit — logoCompose apparu depuis le plan${d.ecrit ? ` (fichier ${cle} orphelin)` : ''}`);
    }
    const relus = await S.countDocuments({ 'logoCompose.source': 'compose' });
    console.log(`${ecrits === aEcrire.length ? '✅' : '🔴'} écrits ${ecrits} / ${aEcrire.length} · RELU : ${relus} sets portent un logoCompose`);
    console.log(`SETS : ${aEcrire.map(p => p.slug).join(',')}`);
    if (ecrits !== aEcrire.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
