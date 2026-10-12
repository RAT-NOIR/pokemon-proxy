// ============================================================
// LES LOGOS COMPOSÉS AVEC UN VRAI LOGO DE DECK — un fichier partagé, plusieurs logos pour un set, les championnats du monde (2026-10-07)
// ============================================================
//   node poser-logos-composes-decks.js                       (plan + rendus + planche LOGOS-COMPOSES-DECKS.png — rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=sets -- node poser-logos-composes-decks.js --cas=A --attendu=<n> --ecrire
//
// 🔑 LES DÉCISIONS DU TESTEUR (2026-10-07) :
//   A. « Un même fichier pour plusieurs sets (Intro Pack, Gift Box Latias/Latios, paires SP, demi-decks DPt, Entry Pack DPt) : feu vert
//      à ta recommandation. Le vrai logo, composé avec l'étiquette propre à chaque deck, marqué « logo composé ». » — ces fichiers, posés
//      tels quels comme `logo`, seraient GÉNÉRIQUES pour le site (un sha1 porté par des sets de pages différentes) ; composés, chaque set
//      a un fichier UNIQUE.
//   B. « Un set pour plusieurs logos de deck (Battle Strength Decks, VMAX Starter Decks, Master Strategy 1 et 2) : jusqu'à 3 logos,
//      montage côte à côte ; au-delà, le logo commun de la gamme s'il existe, sinon le premier sorti. Montre-moi une capture des cas avant
//      d'écrire. » — tous ont 2 ou 3 logos : le montage seul. ÉCRITURE APRÈS LA CAPTURE (`--cas=B`, pas avant son accord).
//   WCD. « Pour chaque deck WCD, le logo officiel de son année, composé avec l'étiquette propre au deck, marqué « logo composé ». Lis
//      l'année sur chaque logo. » — 🔴 CES VINGT FICHIERS SONT, OCTET POUR OCTET, CEUX QUE LE TESTEUR A FAIT RETIRER LE 2026-10-04 COMME
//      COPIES DE POKÉCARDEX (`LOGOS_COPIES`, collecte-cartes/langue-logo.js). (2026-10-13, décision du testeur : ces copies ne sont
//      PAS restaurées après la perte du 2026-10-12) `planifier` refuse donc tout cas WCD d'après la TABLE DES DÉCISIONS (LOGOS_COPIES),
//      sans lire le fichier ; plus de `--leve-copie`. Les années ont été LUES sur la planche (planche-wcd.png).
// LA GARDE, PAR CE QU'ELLE AUTORISE : la table ci-dessous ÉNUMÈRE les sets et leurs fichiers ; chaque fichier doit avoir le sha1 de la table
// des logos LUS (logos-apport-manuel-lus.json pour l'apport, LOGOS_COPIES pour les WCD) ; le set doit exister, être du tirage du dossier,
// n'avoir AUCUN logo propre (un `logo` présent et non générique : gardé) ; le rendu doit être UNIQUE dans la base. L'étiquette est le nom
// affiché du set (lu en base, jamais recopié) ; le sous-titre d'un set qui a déjà un logo composé est gardé.
// ÉCRITURE : `logoCompose` remplacé, l'ancien gardé sous `logoComposeRemplace` (filtre : l'ancien sha1 est toujours là) ; R2
// `logos/composes/<slug>-<sha10>.png` et sa vignette dans le même geste. La revalidation (sets-info compris) est celle de lot-additif.js.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AUTORISES = [/^--cas=(A|B|WCD)$/, /^--attendu=\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --cas=A|B|WCD, --attendu=<n>, --ecrire (les WCD, copies de Pokécardex, sont refusés par la table des décisions : plus de --leve-copie)`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CAS = arg('cas'), ECRIRE = process.argv.includes('--ecrire'), ATTENDU = arg('attendu') ? Number(arg('attendu')) : null;
if (ECRIRE && (!CAS || ATTENDU == null)) { console.error('❌ --ecrire exige --cas=A|B|WCD et --attendu=<n> (le compte du plan, relu)'); process.exit(2); }
const sharp = require('sharp');
const M = require('./collecte-cartes/logo-compose');
const { LOGOS_COPIES } = require('./collecte-cartes/langue-logo');

const AD = 'apport-manuel/Deck JP', AZ = 'apport-manuel/DECK ZH', W = 'Logo FR/WCD';
const DOSSIER_TIRAGE = { [AD]: ['jp'], [AZ]: ['zh-hans', 'zh-hant'], [W]: ['intl'] };
// les fichiers de chaque set ; WCD : l'année LUE sur chaque logo (planche du 2026-10-07), le fichier n'est qu'un nom
const TABLE = {
    // A — un vrai logo partagé : le logo + le nom du deck
    'Dialga-DPt-Half-Deck': { cas: 'A', fichiers: [`${AD}/EPDIA.png`] },
    'Giratina-DPt-Half-Deck': { cas: 'A', fichiers: [`${AD}/EPGIR.png`] },
    'Palkia-DPt-Half-Deck': { cas: 'A', fichiers: [`${AD}/EPPAL.png`] },
    'Chimchar-DPt-Half-Deck': { cas: 'A', fichiers: [`${AD}/GBCHIM.png`] },
    'Pikachu-DPt-Half-Deck': { cas: 'A', fichiers: [`${AD}/GBPIKA.png`] },
    'Piplup-DPt-Half-Deck': { cas: 'A', fichiers: [`${AD}/GBPIPL.png`] },
    'Turtwig-DPt-Half-Deck': { cas: 'A', fichiers: [`${AD}/GBTURT.png`] },
    'Gift-Box-Latias-ex': { cas: 'A', fichiers: [`${AD}/GBLAHD.png`] },
    'Gift-Box-Latios-ex': { cas: 'A', fichiers: [`${AD}/GBLOHD.png`] },
    'Intro-Pack-Bulbasaur': { cas: 'A', fichiers: [`${AD}/IPB.png`] },
    'Intro-Pack-Squirtle': { cas: 'A', fichiers: [`${AD}/IPS.png`] },
    'Charizard-SP-Half-Deck': { cas: 'A', fichiers: [`${AD}/SPCHA.png`] },
    'Garchomp-SP-Half-Deck': { cas: 'A', fichiers: [`${AD}/SPGAR.png`] },
    'Gallade-SP-Half-Deck': { cas: 'A', fichiers: [`${AD}/SPGAL.png`] },
    'Infernape-SP-Half-Deck': { cas: 'A', fichiers: [`${AD}/SPINF.png`] },
    // B — un set, plusieurs logos de deck (≤ 3) : le montage côte à côte, dans l'ordre des decks
    'Battle-Strength-Decks': { cas: 'B', fichiers: [`${AD}/BKC.png`, `${AD}/BKT.png`, `${AD}/BKV.png`] },
    // SC2.png est SC-C.png (même sha1) : deux logos distincts
    'VMAX-Starter-Decks': { cas: 'B', fichiers: [`${AD}/SC-C.png`, `${AD}/SC-G.png`] },
    'Master-Strategy-Deck-Building-Sets': { cas: 'B', fichiers: [`${AZ}/CSVM1AC.png`, `${AZ}/CSVM1BC.png`, `${AZ}/CSVM1CC.png`] },
    'Master-Strategy-Deck-Building-Sets-Vol-2': { cas: 'B', fichiers: [`${AZ}/CSVM2AC.png`, `${AZ}/CSVM2BC.png`, `${AZ}/CSVM2CC.png`] },
    // WCD — le logo officiel de l'année (lue sur le logo) ; pas de championnat en 2020 ni en 2021
    ...Object.fromEntries([[2004, 76], [2005, 77], [2006, 78], [2007, 79], [2008, 80], [2009, 81], [2010, 82], [2011, 83], [2012, 84], [2013, 85], [2014, 86], [2015, 87],
        [2016, 88], [2017, 89], [2018, 90], [2019, 91], [2022, 92], [2023, 93], [2024, 94], [2025, 95]].map(([a, n]) => [`WCD-${a}`, { cas: 'WCD', fichiers: [`${W}/jap_0${n}.png`], annee: a }]))
};

const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
/** Le montage côte à côte de 2 ou 3 logos : chacun détouré (fond blanc rendu transparent), rogné, à la même hauteur, 18 px entre deux. */
async function montage(bufs, hauteur = 120) {
    const parts = [];
    for (let b of bufs) {
        if (await M.fondBlancOpaque(b)) b = await M.transparentiserFond(b);
        const r = await sharp(b).trim().resize({ height: hauteur }).png().toBuffer({ resolveWithObject: true });
        parts.push(r);
    }
    const ecart = 18, largeur = parts.reduce((t, p) => t + p.info.width, 0) + ecart * (parts.length - 1);
    let x = 0; const calques = parts.map(p => { const c = { input: p.data, left: x, top: Math.round((hauteur - p.info.height) / 2) }; x += p.info.width + ecart; return c; });
    return sharp({ create: { width: largeur, height: hauteur, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(calques).png().toBuffer();
}

/** Le plan, pur : une ligne par set de la table. sets : les documents ; lus : sha1 attendu par fichier ; fichiers : sha1 réel par fichier. */
function planifier(sets, lus, fichiers, copies = LOGOS_COPIES) {
    const parSlug = new Map(sets.map(s => [s._id, s]));
    const gen = M.generiquesDe(sets);
    return Object.entries(TABLE).map(([slug, t]) => {
        const s = parSlug.get(slug), base = { slug, ...t };
        if (!s) return { ...base, action: 'refus', raison: 'set absent de la base' };
        // (2026-10-13) la TABLE DES DÉCISIONS décide, pas la présence d'un fichier : un WCD est une copie de Pokécardex refusée
        // (LOGOS_COPIES), il sort refusé SANS que son fichier soit lu — présent, absent ou modifié. Tout cas WCD, et tout fichier que
        // la table des copies nomme, est refusé ici ; seul le reste (cas A/B) atteint les contrôles de fichier plus bas.
        const copie = t.cas === 'WCD' || t.fichiers.some(f => [...copies.values()].some(v => v.startsWith(`${f} `) || v === f));
        if (copie) return { ...base, action: 'refus', raison: `copie de Pokécardex refusée par la table des décisions (LOGOS_COPIES, 2026-10-04) : ${t.fichiers.join(' + ')} — le fichier n'est pas lu` };
        const tirage = s.tirage ?? s.region;
        for (const f of t.fichiers) {
            const d = f.slice(0, f.lastIndexOf('/'));
            if (!DOSSIER_TIRAGE[d]?.includes(tirage)) return { ...base, action: 'refus', raison: `fichier de « ${d} » sur un set ${tirage}` };
            if (!fichiers.has(f)) return { ...base, action: 'refus', raison: `fichier absent : ${f}` };
            if (lus.get(f) !== fichiers.get(f)) return { ...base, action: 'refus', raison: `${f} : sha1 ${String(fichiers.get(f)).slice(0, 10)} ≠ celui de la table des logos lus (${String(lus.get(f)).slice(0, 10)})` };
        }
        if (t.fichiers.length > 3) return { ...base, action: 'refus', raison: 'plus de 3 logos : le logo commun de la gamme, pas un montage' };
        const propre = s.logo?.cleR2 && s.logo.logoGenerique !== true && !(s.logo.sha1 && gen.has(String(s.logo.sha1).toLowerCase()));
        if (propre) return { ...base, action: 'garde-logo-propre', raison: `logo propre au set (${s.logo.cleR2})` };
        if (typeof s.nomAffichage !== 'string' || !s.nomAffichage) return { ...base, action: 'refus', raison: 'set sans nom affiché : pas d\'étiquette' };
        return { ...base, action: 'ecrire', region: s.region, tirage, etiquette: t.cas === 'WCD' ? (s.logoCompose?.elements?.etiquette ?? s.nomAffichage) : s.nomAffichage,
            sous: s.logoCompose?.elements?.sous ?? null, ancien: s.logoCompose ?? null };
    });
}
module.exports = { TABLE, planifier, montage };

if (require.main === module) (async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const r2 = require('./collecte-cartes/r2');
    const { fabriquerVignette, cleVignette, LARGEUR_VIGNETTE_LOGO } = require('./collecte-cartes/vignette');
    // les sha1 attendus : la table des logos apportés LUE ce matin. Les WCD (copies de Pokécardex) ne se lisent pas : la table des décisions les refuse.
    const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes/logos-apport-manuel-lus.json'), 'utf8'));
    const lus = new Map();
    for (const l of (Array.isArray(T) ? T : T.lignes)) lus.set(`${l.dossier === 'Deck JP' ? AD : l.dossier === 'DECK ZH' ? AZ : l.dossier}/${l.fichier}`, l.sha1);
    const fichiers = new Map(), bufs = new Map();
    for (const t of Object.values(TABLE)) { if (t.cas === 'WCD') continue; for (const f of t.fichiers) { const p = path.join(__dirname, f); if (fs.existsSync(p)) { const b = fs.readFileSync(p); bufs.set(f, b); fichiers.set(f, sha1(b)); } } }
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const S = cx.db.collection('sets');
    const sets = await S.find({}, { projection: { region: 1, tirage: 1, nomAffichage: 1, logo: 1, logoFr: 1, logoCompose: 1, 'bulba.pageid': 1 } }).toArray();
    if (!sets.length) throw new Error('sets vide');
    const plan = planifier(sets, lus, fichiers).filter(p => !CAS || p.cas === CAS);
    console.log(`DÉNOMINATEUR : ${Object.keys(TABLE).length} sets dans la table${CAS ? ` · cas ${CAS} : ${plan.length}` : ''} · ${plan.filter(p => p.action === 'ecrire').length} à écrire`);
    for (const p of plan.filter(p => p.action !== 'ecrire')) console.log(`   ✗ ${p.slug} (${p.cas}) : ${p.action} — ${p.raison}`);
    const aEcrire = plan.filter(p => p.action === 'ecrire');
    const sortie = path.join(__dirname, 'logos-composes-rendus', 'decks'); fs.mkdirSync(sortie, { recursive: true });
    for (const p of aEcrire) {
        const logo = p.fichiers.length > 1 ? await montage(p.fichiers.map(f => bufs.get(f))) : bufs.get(p.fichiers[0]);
        p.png = await M.composer({ logo, etiquette: p.etiquette, sous: p.sous ?? undefined });
        p.sha1 = sha1(p.png); const m = await sharp(p.png).metadata(); p.w = m.width; p.h = m.height;
        fs.writeFileSync(path.join(sortie, `${M.cleDe(p.slug)}.png`), p.png);
    }
    const existants = new Set(sets.flatMap(s => ['logo', 'logoFr', 'logoCompose'].map(c => s[c]?.sha1?.toLowerCase()).filter(Boolean)));
    const doublons = aEcrire.filter((p, i) => aEcrire.findIndex(q => q.sha1 === p.sha1) !== i || existants.has(p.sha1));
    if (doublons.length) { console.error(`❌ rendu déjà porté par un autre set : ${doublons.map(p => p.slug).join(', ')}`); await fermer(); process.exit(1); }
    // la planche : par cas, fond clair et fond sombre, le nom du set et ses fichiers
    const CW = 1100, rangs = [];
    for (const p of aEcrire) {
        const leg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="30"><text x="20" y="21" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="#222">${String(`[${p.cas}] ${p.slug} (${p.tirage}) — ${p.fichiers.map(f => path.basename(f)).join(' + ')}${p.annee ? ` · année lue ${p.annee}` : ''}`).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
        rangs.push(await sharp({ create: { width: CW, height: p.h + 70, channels: 4, background: '#ffffff' } }).composite([
            { input: await sharp({ create: { width: 520, height: p.h + 20, channels: 4, background: '#f3f4f6' } }).png().toBuffer(), left: 20, top: 10 },
            { input: p.png, left: 40, top: 20 },
            { input: await sharp({ create: { width: 520, height: p.h + 20, channels: 4, background: '#0f1115' } }).png().toBuffer(), left: 560, top: 10 },
            { input: p.png, left: 580, top: 20 },
            { input: Buffer.from(leg), left: 0, top: p.h + 36 }]).png().toBuffer());
    }
    const hs = await Promise.all(rangs.map(async r => (await sharp(r).metadata()).height));
    let y = 0; const comp = rangs.map((r, i) => { const c = { input: r, left: 0, top: y }; y += hs[i]; return c; });
    const planche = path.join(__dirname, `LOGOS-COMPOSES-DECKS${CAS ? `-${CAS}` : ''}.png`);
    if (comp.length) await sharp({ create: { width: CW, height: y, channels: 4, background: '#ffffff' } }).composite(comp).png().toFile(planche);
    console.log(`RENDUS : ${aEcrire.length} distincts (${sortie}) · PLANCHE : ${planche}`);
    if (!ECRIRE) { console.log('(plan seul — --cas=A|B|WCD --attendu=<n> --ecrire sous lot-additif.js)'); await fermer(); return; }
    if (aEcrire.length !== ATTENDU) { console.error(`❌ ARRÊT : le plan rend ${aEcrire.length}, attendu ${ATTENDU}`); await fermer(); process.exit(1); }
    const bucket = process.env.R2_BUCKET_IMAGES; await r2.verifierBucket(bucket);
    let ecrits = 0; const le = new Date();
    for (const p of aEcrire) {
        const cle = `logos/composes/${M.cleDe(p.slug)}-${p.sha1.slice(0, 10)}.png`;
        await r2.deposerBinaire(bucket, cle, p.png, 'image/png');
        const vg = await fabriquerVignette(p.png, { largeur: LARGEUR_VIGNETTE_LOGO, qualite: 85 });
        const cv = cleVignette(cle); await r2.deposerBinaire(bucket, cv, vg.buffer, 'image/webp');
        const valeur = { cleR2: cle, w: p.w, h: p.h, octets: p.png.length, sha1: p.sha1, region: p.region, source: 'compose', famille: p.cas === 'WCD' ? 'wcd' : 'deck-apport',
            elements: { logo: p.fichiers.map(f => ({ fichier: f, sha1: fichiers.get(f) })), montage: p.fichiers.length > 1, etiquette: p.etiquette, sous: p.sous ?? null, ...(p.annee ? { anneeLue: p.annee } : {}) },
            preuve: `logo composé par rat-market (${p.cas === 'A' ? 'décision du testeur du 2026-10-07 : un vrai logo partagé par plusieurs decks, composé avec le nom du deck' : p.cas === 'B' ? 'décision du testeur du 2026-10-07 : jusqu\'à 3 logos de deck côte à côte' : `cas WCD inatteignable : les copies de Pokécardex sont refusées par la table des décisions`}) : ${p.fichiers.join(' + ')} + « ${p.etiquette}${p.sous ? ` / ${p.sous}` : ''} » ; région du set`,
            le, vignette: { cleR2: cv, w: vg.w, h: vg.h } };
        const filtre = { _id: p.slug, ...(p.ancien?.sha1 ? { 'logoCompose.sha1': p.ancien.sha1 } : { 'logoCompose.cleR2': { $exists: false } }) };
        const u = await S.updateOne(filtre, { $set: { logoCompose: valeur, ...(p.ancien ? { logoComposeRemplace: { ...p.ancien, remplaceLe: le } } : {}) } });
        if (u.modifiedCount === 1) ecrits++; else console.log(`   ⚠️ ${p.slug} : non écrit — le logo composé a changé depuis le plan`);
    }
    const relus = await S.countDocuments({ _id: { $in: aEcrire.map(p => p.slug) }, 'logoCompose.sha1': { $in: aEcrire.map(p => p.sha1) } });
    console.log(`${ecrits === aEcrire.length && relus === ecrits ? '✅' : '🔴'} écrits ${ecrits} / ${aEcrire.length} · RELU ${relus} sets portent leur nouveau logo composé`);
    console.log(`SETS : ${aEcrire.map(p => p.slug).join(',')}`);
    if (ecrits !== aEcrire.length || relus !== ecrits) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
