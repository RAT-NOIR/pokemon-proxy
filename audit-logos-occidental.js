// ============================================================
// AUDIT DES LOGOS OCCIDENTAUX — chaque set international publié, dans UNE case, vérifié sur la page réelle (2026-09-26, soir)
// ============================================================
//   node audit-logos-occidental.js                 (base + pages du site ; aucune requête aux sources)
//   node audit-logos-occidental.js --sonder        (+ imageinfo des noms de fichier CONVENTIONNELS sur l'archive Bulbagarden,
//                                                   par lots de 50, sous le verrou global Bulbapedia — 1 requête / 5 s)
// Cases : servi · servi-generique · a (logo en base, absent de la page servie) · b-bulbagarden (un fichier existe sur
// l'archive — la langue et le couple restent jugés par collecter-logos-demande.js) · b-a-confirmer · c (preuve écrite).
// Sortie : audit-logos-occidental.json, et DEMANDE-LOGOS-OCCIDENTAL.md au format de collecter-logos-demande.js pour les b.
// 🔑 La page d'un set qui REDIRIGE (les Additionals → « <parent>#additionals ») n'a pas de logo à elle : elle sort du compte,
// raison écrite. Les preuves TCGdex sont celles déjà obtenues, datées : le 404 du 2026-09-26 10:43 UTC (lot des logos,
// JOURNAL-LOTS.md) et la liste énumérée des sets TCGdex (cache) ; cet outil ne refait aucune requête à TCGdex.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
//   [--clone-tcgdex=<dossier>]                     (clone local du dépôt public tcgdex/cards-database — sans lui, aucun set ne
//                                                   sort en c : la case TCGdex n'est pas vérifiée, il sort « à confirmer »)
const AUTORISES = [/^--sonder$/, /^--clone-tcgdex=.+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --sonder, --clone-tcgdex=<dossier>`); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const bulba = require('./collecte-cartes/bulba');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { pairerIntl, lireSetsTcgdex } = require('./poser-dates-sets');

const SITE = 'https://rat-market.fr';
// Les 404 TCGdex constatés le 2026-09-26 à 10:43 UTC (lot « logos TCGdex », collecter-logos-demande.js) : la preuve est datée.
const TCGDEX_404_20260926 = new Set(['svp', 'mep', '2014xy', '2016xy', '2017sm', '2015xy', '2012bw', '2019sm']);

async function page(slug) {
    for (let essai = 0; essai < 2; essai++) {
        try { const r = await fetch(`${SITE}/fr/sets/${encodeURIComponent(slug)}`, { redirect: 'manual', signal: AbortSignal.timeout(45000) }); return { code: r.status, html: r.status === 200 ? await r.text() : '', location: r.headers.get('location') }; }
        catch (e) { if (essai) return { code: `erreur ${e.name}`, html: '' }; await new Promise(r => setTimeout(r, 3000)); }
    }
}

(async () => {
    const sonder = process.argv.includes('--sonder');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx), db = cx.db;
    const tous = await db.collection('sets').find({}, { projection: { code: 1, region: 1, tirage: 1, nomAffichage: 1, nomEn: 1, logo: 1, logoGenerique: 1, logoRefus: 1, 'bulba.titre': 1 } }).toArray();
    const pop = tous.filter(s => typeof s.nomAffichage === 'string' && (s.tirage ?? s.region) === 'intl');
    console.log(`DÉNOMINATEUR : ${tous.length} sets · ${pop.length} publiés au tirage occidental`);
    const clone = (process.argv.find(a => a.startsWith('--clone-tcgdex=')) || '').slice('--clone-tcgdex='.length) || null;
    if (clone && !fs.existsSync(path.join(clone, 'data'))) throw new Error(`--clone-tcgdex=${clone} : aucun dossier « data » — ce n'est pas un clone de tcgdex/cards-database`);
    const tcg = clone ? lireSetsTcgdex(clone, 'data') : null;
    console.log(`TCGdex : ${tcg ? `${tcg.length} sets (clone du dépôt public ${clone}, lu localement)` : 'aucun clone (--clone-tcgdex) — la case TCGdex n\'est pas vérifiée : aucun set ne sortira en c'}`);

    const lignes = [];
    let requetes = 0;
    for (let i = 0; i < pop.length; i += 3) {
        await Promise.all(pop.slice(i, i + 3).map(async s => {
            const P = await page(s._id); requetes++;
            const L = { slug: s._id, code: s.code, nom: s.nomAffichage, http: P.code };
            if (/^3\d\d$/.test(String(P.code))) { lignes.push({ ...L, cas: 'servi-ailleurs', detail: `la page redirige vers ${P.location} : le logo est celui de cette page` }); return; }
            if (P.code !== 200) { lignes.push({ ...L, cas: 'b-a-confirmer', detail: `page non lue (HTTP ${P.code})` }); return; }
            if (s.logo?.cleR2) {
                const nom = s.logo.cleR2.split('/').pop();
                const servi = P.html.includes(nom) || P.html.includes(encodeURIComponent(nom)) || P.html.includes(encodeURI(nom));
                lignes.push({ ...L, cas: servi ? (s.logoGenerique ? 'servi-generique' : 'servi') : 'a', detail: `${s.logo.cleR2} (${s.logo.source})${servi ? '' : ' — absent de la page servie : page à revalider'}` });
                return;
            }
            const preuves = [];
            preuves.push(s.logoRefus ? `Bulbapedia : ${s.logoRefus.motif}${s.logoRefus.fichier ? ` (${s.logoRefus.fichier})` : ''} — ${s.logoRefus.instrument ?? 'collecteur'}, ${s.logoRefus.le ? new Date(s.logoRefus.le).toISOString().slice(0, 10) : 'date non écrite'}` : 'Bulbapedia : aucune cause écrite en base');
            if (tcg) {
                const p = pairerIntl(tcg, s);
                preuves.push(!p.id ? `TCGdex : ${p.raison ?? 'aucune clé ne désigne un set'} (${tcg.length} sets énumérés)` : p.uneCle ? `TCGdex : ${p.id} désigné par une seule clé — non retenu` : TCGDEX_404_20260926.has(p.id) ? `TCGdex : ${p.id}/logo.png → 404 le 2026-09-26 10:43 UTC` : `TCGdex : ${p.id} désigné par deux clés, logo jamais demandé`);
                if (p.id && !p.uneCle && !TCGDEX_404_20260926.has(p.id)) { lignes.push({ ...L, cas: 'b-a-confirmer', detail: preuves.join(' · '), tcgdex: p.id }); return; }
            } else { lignes.push({ ...L, cas: 'b-a-confirmer', detail: `${preuves.join(' · ')} · TCGdex : non vérifié (aucun clone, --clone-tcgdex)` }); return; }
            lignes.push({ ...L, cas: 'c', preuves, bulbaTitre: s.bulba?.titre ?? null, nomEn: s.nomEn ?? null });
        }));
    }

    // ── les noms CONVENTIONNELS sur l'archive Bulbagarden, pour les c dont l'infobox ne nommait rien (ou pas de page)
    const aSonder = lignes.filter(l => l.cas === 'c');
    const candidatsDe = l => [...new Set([l.nom, l.nomEn, l.bulbaTitre?.replace(/\s*\(TCG\)$/, '')].filter(Boolean).flatMap(n => [`${n} Logo.png`, `${n} logo.png`, `${n.replace(/[':]/g, '')} Logo.png`]).concat([`${l.code} Logo.png`]))];
    if (sonder && aSonder.length) {
        const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: 3 * 60 * 1000, surInsertion: { phase: 'audit-logos' }, surPerte: () => {}, nom: 'verrou global bulbapedia (audit des logos)' });
        for (let essai = 0; ; essai++) {
            const tenu = await verrou.prendre();
            if (!tenu) break;
            if (essai === 0) console.log(`⏳ verrou Bulbapedia tenu par pid ${tenu.pid} sur ${tenu.hote} — j'attends.`);
            if (essai > 450) throw new Error('verrou Bulbapedia non obtenu en 15 min — rien sondé');
            await new Promise(r => setTimeout(r, 2000));
        }
        try {
            const titres = [...new Set(aSonder.flatMap(candidatsDe))].map(f => `File:${f}`);
            const avant = bulba.compteRequetes();
            const infos = await bulba.imageinfoDe(titres);
            console.log(`   sondage Bulbagarden : ${titres.length} noms de fichier, ${bulba.compteRequetes() - avant} requête(s)`);
            // l'API normalise les titres (« File:X_Y.png » → « File:X Y.png ») : on compare sur la forme à espaces
            const trouve = new Map([...infos].filter(([, v]) => v?.url).map(([k, v]) => [k.replace(/_/g, ' '), v]));
            for (const l of aSonder) {
                const hit = candidatsDe(l).map(f => [f, trouve.get(`File:${f}`.replace(/_/g, ' '))]).find(([, v]) => v);
                if (hit) { l.cas = 'b-bulbagarden'; l.detail = `archive Bulbagarden : « ${hit[0]} » ${hit[1].width}×${hit[1].height}`; l.url = hit[1].url; }
                else l.preuves.push(`Bulbagarden : aucun des ${candidatsDe(l).length} noms conventionnels n'existe (${candidatsDe(l).slice(0, 3).join(', ')}…) — imageinfo, ${new Date().toISOString().slice(0, 10)}`);
            }
        } finally { await verrou.rendre(); }
    // sans sondage, l'archive Bulbagarden n'a PAS été interrogée : c) exige les trois sources nommées (§36) — le set est « à confirmer »
    } else for (const l of aSonder) { l.cas = 'b-a-confirmer'; l.detail = `${l.preuves.join(' · ')} · Bulbagarden : noms conventionnels NON sondés (--sonder)`; }

    const tot = {}; for (const l of lignes) tot[l.cas] = (tot[l.cas] || 0) + 1;
    console.log(`\nPAGES lues : ${requetes} · CASES : ${JSON.stringify(tot)}`);
    for (const l of lignes.filter(l => !/^servi/.test(l.cas)).sort((a, b) => a.cas.localeCompare(b.cas))) console.log(`   ${l.cas.padEnd(14)} ${l.code.padEnd(8)} ${l.nom} · ${l.detail ?? l.preuves.join(' · ')}`);
    fs.writeFileSync(path.join(__dirname, 'audit-logos-occidental.json'), JSON.stringify({ genere: new Date().toISOString(), totaux: tot, sets: lignes }, null, 1));
    const b = lignes.filter(l => l.cas === 'b-bulbagarden');
    if (b.length) fs.writeFileSync(path.join(__dirname, 'DEMANDE-LOGOS-OCCIDENTAL.md'), `# Logos occidentaux trouvés sur l'archive Bulbagarden par leur nom conventionnel (${new Date().toISOString().slice(0, 10)})\n\nChaque ligne est RE-JUGÉE par collecter-logos-demande.js (langue, couple, générique) avant tout téléchargement.\n\n${b.map(l => `- ${l.slug} (intl, ${l.code}) → **${l.url}**`).join('\n')}\n`);
    console.log(`\nécrit : audit-logos-occidental.json${b.length ? ` · DEMANDE-LOGOS-OCCIDENTAL.md (${b.length} lignes)` : ''}`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
