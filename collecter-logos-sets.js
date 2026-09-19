// ============================================================
// LES LOGOS DE SETS — `sets.logo = { cleR2, w, h }`, et la LANGUE décide qui en reçoit un
// ============================================================
//   node collecter-logos-sets.js            (décide et imprime, rien d'écrit — le défaut)
//   node collecter-logos-sets.js --ecrire   (prend le verrou global, télécharge, écrit)
//
// 🔴 LE PIÈGE, MESURÉ À L'ÉCHELLE : sur 192 sets japonais qui portent un logo, **125 pointent un
// fichier suffixé « EN »** — le logo du JUMEAU INTERNATIONAL. « Rocket Gang » reçoit « Team Rocket
// Logo.png », « Gold Silver to a New World » reçoit « Neo Genesis Logo EN.png ». C'est exactement le
// piège de `nomEn` (§26) transposé aux images, et sans la règle de langue **un set japonais sur deux
// aurait affiché le logo d'un autre produit**.
//
// LA SOURCE EST LE PARAMÈTRE D'INFOBOX (`setlogo`, à défaut `logo`), jamais un fichier cité ailleurs
// sur la page : une page de set mentionne des dizaines d'images (boosters, decks, cartes vedettes), et
// en prendre une au hasard afficherait un booster comme logo. Le cas est réel : DP4d et DP4m pointent
// tous deux « DP4 Boosters.png » — ce n'est pas un logo, et ces deux-là ne reçoivent rien.
//
// LA RÈGLE DE LANGUE, par ordre de force, et chaque set écrit LA PREUVE qui l'a fait passer :
//   1. set OCCIDENTAL : le logo lui revient (Bulbapedia est un wiki anglophone ; 0 fichier suffixé
//      « JP » sur les 165 sets occidentaux à logo — vérifié, pas supposé) ;
//   2. set JAPONAIS, fichier suffixé « JP » : décisif ;
//   3. set JAPONAIS, fichier commençant par le CODE du set (« S10a Dark Phantasma Logo.png ») :
//      décisif aussi — un code japonais ne désigne aucun set occidental ;
//   4. set JAPONAIS, fichier portant le nom japonais du set (« Pokémon Card VS Logo.png ») ;
//   5. tout le reste — suffixe « EN », nom du jumeau, ou rien de reconnaissable — N'EST PAS ÉCRIT,
//      et le motif est imprimé. Un logo faux ne se signale jamais tout seul.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const r2 = require('./collecte-cartes/r2');
const bulba = require('./collecte-cartes/bulba');
const { gabarits } = require('./collecte-cartes/wikitext');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');

const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const VERROU_MS = 3 * 60 * 1000, ATTENTE_MS = 30 * 1000;

function deciderLangue(s, logo) {
    const f = cle(logo);
    const suf = String(logo).match(/\s(EN|JP|JA)\.(png|jpg|svg|gif)$/i)?.[1]?.toUpperCase() || null;
    if (s.region === 'intl') return suf === 'JP' || suf === 'JA'
        ? { ok: false, motif: `set occidental, fichier suffixé « ${suf} » : c'est le logo japonais` }
        : { ok: true, preuve: `set occidental${suf ? `, fichier suffixé « ${suf} »` : ', aucun suffixe de langue'}` };
    if (suf === 'JP' || suf === 'JA') return { ok: true, preuve: `fichier suffixé « ${suf} »` };
    if (suf === 'EN') return { ok: false, motif: 'fichier suffixé « EN » : c\'est le logo du jumeau international' };
    const code = cle(s.code);
    if (code && code.length > 1 && f.startsWith(code)) return { ok: true, preuve: `le fichier commence par le code japonais « ${s.code} »` };
    const ja = cle(s.nomJaTraduit || s.nomAffichage);
    if (ja && ja.length > 3 && f.includes(ja)) return { ok: true, preuve: `le fichier porte le nom japonais du set` };
    const jumeau = cle(s.nomEn);
    if (jumeau && jumeau.length > 3 && f.includes(jumeau)) return { ok: false, motif: `le fichier porte le nom du jumeau « ${s.nomEn} »` };
    return { ok: false, motif: 'aucune preuve de langue dans le nom de fichier' };
}

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    const M = modeles(cx);
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);

    const sets = await cx.db.collection('sets').find({}, { projection: { code: 1, region: 1, nomAffichage: 1, nomEn: 1, nomJaTraduit: 1, bulba: 1, logo: 1 } }).toArray();
    const avecArchive = sets.filter(s => s.bulba?.cleR2);
    console.log(`\n════ DÉNOMINATEUR : ${sets.length} sets · ${avecArchive.length} ont leur page archivée (${sets.length - avecArchive.length} sans : rien à lire) ════`);

    const retenus = [], refuses = [];
    for (const s of avecArchive) {
        let txt; try { txt = await r2.lireTexte(process.env.R2_BUCKET_BRUT, s.bulba.cleR2); } catch { refuses.push({ s, motif: 'page illisible sur R2' }); continue; }
        const box = gabarits(txt).find(g => /infobox/i.test(g.nom));
        const logo = String(box?.params?.setlogo ?? box?.params?.logo ?? '').trim().replace(/-->\s*$/, '');
        if (!logo) { refuses.push({ s, motif: 'aucun `setlogo` dans l\'infobox' }); continue; }
        const d = deciderLangue(s, logo);
        (d.ok ? retenus : refuses).push({ s, logo, ...d });
    }
    const parMotif = {};
    for (const r of refuses) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    const parPreuve = {};
    for (const r of retenus) parPreuve[r.preuve.replace(/«[^»]*»/g, '…')] = (parPreuve[r.preuve.replace(/«[^»]*»/g, '…')] || 0) + 1;
    console.log(`   ✅ RETENUS : ${retenus.length}  (occidentaux ${retenus.filter(r => r.s.region === 'intl').length} · japonais ${retenus.filter(r => r.s.region !== 'intl').length})`);
    for (const [k, v] of Object.entries(parPreuve).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(4)} — ${k}`);
    console.log(`   🔴 REFUSÉS : ${refuses.length}`);
    for (const [k, v] of Object.entries(parMotif).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(4)} — ${k}`);
    console.log(`   dix refusés, tels quels :`);
    for (const r of refuses.filter(x => x.logo).slice(0, 10)) console.log(`      ${String(r.s.code).padEnd(9)} « ${String(r.s.nomAffichage).slice(0, 28).padEnd(28)} » → « ${r.logo} » : ${r.motif}`);

    // 🔑 PLUSIEURS SETS PARTAGENT UN LOGO, ET C'EST NORMAL : une page couvre parfois deux variantes
    // (les deux moitiés d'un demi-set, un set et ses Additionals). Le même fichier sert à chacun — on
    // ne dédoublonne donc PAS les sets, seulement les TÉLÉCHARGEMENTS.
    const fichiers = [...new Set(retenus.map(r => r.logo))];
    console.log(`\n   ${retenus.length} sets pour ${fichiers.length} fichiers distincts (un logo peut servir à plusieurs sets : demi-sets, Additionals)`);
    if (!ecrire) { console.log(`\n   (décision seule — relancer avec --ecrire pour télécharger et écrire)`); await fermer(); return; }

    // ---- le verrou global : on frappe Bulbapedia, donc la promesse s'applique (§17) ----
    let arret = false;
    const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: VERROU_MS, surInsertion: { phase: 'logos' }, surPerte: () => { arret = true; }, nom: 'verrou global bulbapedia (logos)' });
    for (let essai = 0; ; essai++) {
        const tenu = await verrou.prendre();
        if (!tenu) break;
        if (essai === 0) console.log(`⏳ verrou global tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s) — j'attends, ${ATTENTE_MS / 1000} s entre deux essais.`);
        await new Promise(r => setTimeout(r, ATTENTE_MS));
    }
    console.log(`🔒 verrou global pris.`);
    try {
        const infos = await bulba.imageinfoDe(fichiers.map(f => `File:${f}`));
        let n = 0, sans = 0;
        const objets = new Map();
        for (const f of fichiers) {
            if (arret) break;
            const info = infos.get(`File:${f}`);
            if (!info?.url) { sans++; console.warn(`   ⚠️ ${f} : aucune imageinfo`); continue; }
            const ext = (info.mime || '').split('/')[1] || 'png';
            const cleObjet = `bulbapedia/logos/${cle(f)}.${ext}`;
            if (!await r2.existe(process.env.R2_BUCKET_IMAGES, cleObjet)) {
                const buf = await bulba.telecharger(info.url);
                await r2.deposerBinaire(process.env.R2_BUCKET_IMAGES, cleObjet, buf, info.mime);
            }
            objets.set(f, { cleR2: cleObjet, w: info.width ?? null, h: info.height ?? null, urlOriginal: info.url, sha1: info.sha1 ?? null });
            n++;
        }
        let ecrits = 0;
        for (const r of retenus) {
            const o = objets.get(r.logo);
            if (!o) continue;
            await cx.db.collection('sets').updateOne({ _id: r.s._id }, { $set: { logo: { ...o, fichier: r.logo, source: 'bulbapedia:setlogo', preuve: r.preuve, le: new Date() } } });
            ecrits++;
        }
        const relu = await cx.db.collection('sets').countDocuments({ 'logo.cleR2': { $nin: [null, ''] } });
        console.log(`\n   TÉLÉCHARGÉS : ${n} fichiers (${sans} sans imageinfo) · ÉCRITS : ${ecrits} sets · relu en base : ${relu} sets portent un logo`);
    } finally { await verrou.rendre(); console.log(`🔓 verrou rendu.`); }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
