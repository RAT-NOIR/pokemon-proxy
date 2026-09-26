// ============================================================
// LES LOGOS TROUVÉS PAR L'AGENT SITE — DEMANDE-LOGOS.md -> R2 + `sets.logo` (2026-09-23)
// ============================================================
//   node collecter-logos-demande.js            (lit la demande, JUGE chaque fichier, imprime — rien d'écrit)
//   node collecter-logos-demande.js --ecrire   (télécharge sous le verrou global de CHAQUE hôte, écrit, relit)
//
// Un seul écrivain par base : le site cherche, le serveur collecte. La demande n'est PAS crue sur parole : chaque
// fichier repasse par la règle de langue du dépôt (collecte-cartes/langue-logo.js, la même que collecter-logos-sets.js),
// et un logo TCGdex n'est accepté que sous un set occidental (TCGdex n'a aucun logo japonais — mesuré par le site).
// Deux hôtes, deux verrous, deux cadences (§17, §38) : Bulbagarden par collecte-cartes/bulba.js (5 s, verrou
// `bulbapedia/__collecteur__`), TCGdex par collecte-cartes/tcgdex.js (verrou `tcgdex/__collecteur__`, garde fermée).
// Le logo porte sa SOURCE (`logo.source`) : collecter-logos-sets.js ne touche pas un logo qui n'est pas le sien.
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const r2 = require('./collecte-cartes/r2');
const bulba = require('./collecte-cartes/bulba');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { fabriquerClient, VERROU_GLOBAL: VERROU_TCGDEX, VERROU_GLOBAL_MS } = require('./collecte-cartes/tcgdex');
// La table du COUPLE et celle des GÉNÉRIQUES vivent dans langue-logo.js, partagées avec collecter-logos-sets.js : une copie
// locale ici a déjà existé, et un fichier lu à l'œil sur un chemin ne l'était pas sur l'autre (M1, SV11 : 2026-09-24).
const { deciderLangue, cle, refusDuCouple, logoGenerique } = require('./collecte-cartes/langue-logo');

// `--demande=<fichier.md>` (2026-09-25) : une liste au MÊME format, écrite par le serveur (logos TCGdex lus par l'API /sets/<id>) ;
// chaque ligne repasse par les mêmes juges que celles du site.
const DEMANDE = process.argv.find(a => a.startsWith('--demande='))?.slice(10) || 'C:/Users/Yung/Desktop/rat-market-site/DEMANDE-LOGOS.md';
const LIGNE = /^- ([^\s(]+) \((jp|intl), ([^)]+)\) → \*\*(https?:\/\/[^*]+)\*\*/;

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const lignes = fs.readFileSync(DEMANDE, 'utf8').split(/\r?\n/);
    const demandes = lignes.map(l => LIGNE.exec(l)).filter(Boolean).map(m => ({ slug: m[1], region: m[2], code: m[3], url: m[4].trim() }));
    console.log(`demande : ${DEMANDE} · ${lignes.filter(l => /^- /.test(l)).length} sets listés · ${demandes.length} avec une source`);
    if (!demandes.length) throw new Error('aucune source lue dans la demande — le motif de ligne ne mord sur rien');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    const M = modeles(cx);
    const sets = new Map((await cx.db.collection('sets').find({ _id: { $in: demandes.map(d => d.slug) } }, { projection: { code: 1, region: 1, tirage: 1, 'bulba.titre': 1, nomAffichage: 1, nomEn: 1, nomJaTraduit: 1, logo: 1 } }).toArray()).map(s => [s._id, s]));
    const retenus = [], refus = [];
    for (const d of demandes) {
        const s = sets.get(d.slug);
        if (!s) { refus.push({ d, motif: 'set absent de la base' }); continue; }
        if (s.region !== d.region) { refus.push({ d, motif: `région ${s.region} en base, ${d.region} dans la demande` }); continue; }
        const u = new URL(d.url);
        const fichier = decodeURIComponent(u.pathname.split('/').pop()).replace(/_/g, ' ');
        // le refus lu à l'œil passe AVANT « déjà un logo » : sinon un logo du couple déjà posé ne se retirerait jamais
        const couple = refusDuCouple(fichier);
        if (couple) { refus.push({ d, s, fichier, couple: true, motif: couple }); continue; }
        if (s.logo?.cleR2) { refus.push({ d, motif: `porte déjà un logo (${s.logo.source})` }); continue; }
        if (u.hostname === 'archives.bulbagarden.net') {
            const v = deciderLangue(s, fichier);
            (v.ok ? retenus : refus).push({ d, s, hote: 'bulbagarden', fichier, ...(v.ok ? { preuve: `archive Bulbagarden « ${fichier} » : ${v.preuve}` } : { motif: v.motif }) });
        } else if (u.hostname === 'assets.tcgdex.net' && /^\/en\//.test(u.pathname)) {
            // le TIRAGE, pas la région : un set chinois, indonésien ou thaï est rangé `intl` (§61) et n'a pas le logo anglais
            if ((s.tirage ?? s.region) !== 'intl') { refus.push({ d, motif: `logo TCGdex anglais sous un set de tirage ${s.tirage ?? s.region}` }); continue; }
            retenus.push({ d, s, hote: 'tcgdex', fichier: u.pathname, preuve: `TCGdex en ${u.pathname} : logo de l'édition anglaise, sous un set occidental` });
        } else refus.push({ d, motif: `hôte non autorisé : ${u.hostname}` });
    }
    const parUrl = new Map(); for (const r of retenus) (parUrl.get(r.d.url) || parUrl.set(r.d.url, []).get(r.d.url)).push(r.d.slug);
    console.log(`\n   ✅ retenus : ${retenus.length} (Bulbagarden ${retenus.filter(r => r.hote === 'bulbagarden').length} · TCGdex ${retenus.filter(r => r.hote === 'tcgdex').length}) · fichiers distincts : ${parUrl.size}`);
    for (const r of retenus) console.log(`      ${r.d.slug.padEnd(34)} ${r.preuve}`);
    for (const [u, s] of parUrl) if (s.length > 1) console.log(`   ⚠️ UN fichier pour ${s.length} sets (${s.join(', ')}) : ${u} — à regarder à l'œil`);
    console.log(`   🔴 refusés : ${refus.length}`);
    for (const r of refus) console.log(`      ${r.d.slug.padEnd(34)} ${r.motif}`);
    if (!ecrire) { console.log('\n   (jugement seul — --ecrire télécharge et écrit)'); await fermer(); return; }
    // Un refus s'écrit (§46) — et un logo du couple déjà posé se RETIRE : la règle d'aujourd'hui le rejette.
    for (const r of refus.filter(x => x.s && x.couple)) {
        await cx.db.collection('sets').updateOne({ _id: r.s._id, $or: [{ logo: { $exists: false } }, { 'logo.source': 'bulbagarden:demande-site' }] },
            { $set: { logoRefus: { motif: r.motif, fichier: r.fichier, le: new Date(), instrument: 'collecter-logos-demande.js', source: 'bulbagarden:demande-site' } }, $unset: { logo: 1 } });
    }

    const bucket = process.env.R2_BUCKET_IMAGES;
    await r2.verifierBucket(bucket);   // le point d'accès UE : sans lui, R2 répond « UnknownError » (§52, et ici le 2026-09-23)
    const objets = new Map();
    // On écrit APRÈS CHAQUE HÔTE : un verrou tenu chez l'un ne doit pas faire perdre ce que l'autre a déjà rendu.
    let ecrits = 0;
    const ecrireCeQuiEstObtenu = async () => {
        for (const r of retenus) {
            const o = objets.get(r.d.url);
            if (!o || r.ecrit) continue;
            const gen = logoGenerique(o.sha1);
            await cx.db.collection('sets').updateOne({ _id: r.s._id }, { $set: { logo: { ...o, fichier: r.fichier, source: r.hote === 'tcgdex' ? 'tcgdex:en' : 'bulbagarden:demande-site', preuve: r.preuve, le: new Date() }, logoGenerique: !!gen, ...(gen ? { logoGeneriquePreuve: gen } : {}) }, $unset: { logoRefus: 1, ...(gen ? {} : { logoGeneriquePreuve: 1 }) } });
            r.ecrit = true; ecrits++;
        }
    };
    const deposer = async (url, buffer, source) => {
        const meta = await sharp(buffer).metadata();
        const cleR2 = `logos/${source}/${cle(decodeURIComponent(url.split('/').slice(-3).join('-')))}.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
        await r2.deposerBinaire(bucket, cleR2, buffer, `image/${meta.format}`);
        objets.set(url, { cleR2, w: meta.width, h: meta.height, urlOriginal: url, sha1: crypto.createHash('sha1').update(buffer).digest('hex') });
    };
    // Bulbagarden, sous SON verrou, à SA cadence
    const urlsB = [...parUrl.keys()].filter(u => u.includes('bulbagarden'));
    if (urlsB.length) {
        const vb = fabriquerVerrou({ Modele: M.EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: 3 * 60 * 1000, surInsertion: { phase: 'logos' }, nom: 'verrou global bulbapedia (logos demandés)' });
        const t = await vb.prendre();
        if (t) throw new Error(`verrou bulbapedia tenu par pid ${t.pid} sur ${t.hote} — pas de requête à côté`);
        try { for (const u of urlsB) { const { buffer } = await bulba.telecharger(u); await deposer(u, buffer, 'bulbagarden'); } }
        finally { await vb.rendre(); }
        await ecrireCeQuiEstObtenu();
        console.log(`   Bulbagarden : ${urlsB.length} fichiers, ${ecrits} sets écrits`);
    }
    // TCGdex, sous SON verrou, lié au client
    const urlsT = [...parUrl.keys()].filter(u => u.includes('tcgdex'));
    if (urlsT.length) {
        const vt = fabriquerVerrou({ Modele: M.EtatImages, id: VERROU_TCGDEX, dureeMs: VERROU_GLOBAL_MS, surInsertion: { phase: 'logos' }, nom: 'verrou global tcgdex (logos demandés)' });
        const t = await vt.prendre();
        if (t) { console.error(`   ⛔ verrou tcgdex tenu par pid ${t.pid} sur ${t.hote} — les ${urlsT.length} logos TCGdex attendront, rien n'est tenté à côté`); await fermer(); process.exit(1); }
        const client = fabriquerClient({ verrou: vt });
        try { for (const u of urlsT) { const b = await client.telecharger(u); if (b) await deposer(u, b, 'tcgdex'); else console.warn(`   ⚠️ ${u} : 404`); } }
        finally { await vt.rendre(); }
        await ecrireCeQuiEstObtenu();
    }
    for (const r of retenus) if (!r.ecrit) console.warn(`   ⚠️ ${r.d.slug} : fichier non obtenu`);
    const relu = await cx.db.collection('sets').countDocuments({ 'logo.cleR2': { $nin: [null, ''] } });
    console.log(`\n   ✅ ${objets.size} fichiers déposés · ${ecrits} sets écrits · RELU : ${relu} sets portent un logo`);
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
