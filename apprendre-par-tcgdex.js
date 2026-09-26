// ============================================================
// APPRENDRE SANS CARDMARKET — l'idProduct que TCGdex porte (variants[].thirdParty.cardmarket), sous garde
// ============================================================
//   node apprendre-par-tcgdex.js --clone=<clone tcgdex/cards-database>                                   (mesure, n'écrit rien)
//   node apprendre-par-tcgdex.js --clone=<…> --base=test --attendu=<N> --ecrire                          (après backup-collections.js --base=test --collections=numeros_cartes)
//
// 🔑 LA DEMANDE (testeur, 2026-09-26) : la passe Tampermonkey est bloquée (1015), et des produits n'apparaissent jamais dans les
// listes Cardmarket, quels que soient les filtres. TCGdex écrit l'idProduct Cardmarket de chaque variante : s'en servir pour
// APPRENDRE (numéro, code, expansion) ce que Cardmarket ne nous montre pas — « TCGdex et le contrôle du nom doivent concorder,
// 20 regardés au hasard » — et garder la liste de ce que SEUL Cardmarket peut donner.
// ⚠️ TCGdex se trompe de produit, mesuré (§65, DEMANDE-SERVICE-PRODUITS.md) : 93 contradictions sur 97 donnaient raison à nous.
// D'où des gardes écrites AVANT la mesure, chacune sur une donnée que la clé (l'idProduct) n'a pas utilisée :
//   1. UNE carte TCGdex porte l'idProduct (deux cartes : TCGdex ne sait pas lequel) ;
//   2. l'EXPANSION n'est pas contredite : le set TCGdex, s'il écrit son idExpansion Cardmarket, écrit celle du produit ;
//   3. l'expansion a un CODE appris (codes_set) — sans lui la ligne n'ouvre aucune jointure ;
//   4. la NUMÉROTATION TCGdex est CALIBRÉE sur cette expansion : sur les produits déjà appris par Cardmarket que TCGdex porte aussi,
//      son numéro (localId) est celui de Cardmarket, 100 %, sur 5 au moins (« SWSH291 » contre « 291 » : une autre écriture) ;
//   5. le NOM concorde (`clesNom`, la clé de production) : le nom anglais de TCGdex, ou — carte asiatique sans nom anglais — le
//      nom anglais de NOS cartes au même nom japonais, et lui seul ; « δ Delta Species » s'écrit « δ » chez les deux autres ;
//   6. les ATTAQUES concordent quand le produit en porte (une au moins parmi celles de la carte désignée).
// Écriture ADDITIVE : une ligne `numeros_cartes` par produit JAMAIS appris (`$setOnInsert` seul), `source: 'tcgdex'`, sans slug —
// le slug est à Cardmarket seul, et le fabriquer serait deviner.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { cleNumero, clesNom, decomposerNomCardmarket } = require('./collecte-cartes/jointure');

const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CLONE = arg('clone'), EXPORT = arg('export') || 'products_singles_24092026.json';
const ecrire = process.argv.includes('--ecrire'), ATTENDU = arg('attendu') != null ? Number(arg('attendu')) : null;
if (!CLONE || !fs.existsSync(path.join(CLONE, 'data'))) { console.error('❌ --clone=<chemin du clone tcgdex/cards-database> requis'); process.exit(2); }
const estCarteCode = nom => /\b(online|live)\s+code\s+card\b/i.test(String(nom || ''));   // mesure-catalogue.js:24
const chaineDe = (bloc, cle) => { const m = new RegExp(`\\b${cle}:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`).exec(bloc); return m ? m[2].replace(/\\(.)/g, '$1') : null; };
// La FORME d'un numéro (« 095 » → « # », « SWSH291 » → « SWSH# », « Museum » → « Museum ») : un numéro dont la forme n'a jamais été
// vue dans la calibration n'est pas calibré (mep-Museum, 2026-09-26 : 120/120 sur des numéros, et « Museum » n'en est pas un).
const formeDe = id => String(id).replace(/\d+/g, '#');
const sansDelta = nom => String(nom || '').replace(/δ\s+Delta Species\b/g, 'δ');
const cles = nom => clesNom(sansDelta(nom));

/** Le clone : idProduct → cartes TCGdex { tcgId, localId, setId, cmExp, nomEn, nomJa, attaques[] }. */
function lireClone(racine) {
    const parId = new Map();
    for (const monde of ['data', 'data-asia']) for (const serie of fs.readdirSync(path.join(racine, monde))) {
        const dS = path.join(racine, monde, serie); if (!fs.statSync(dS).isDirectory()) continue;
        for (const e of fs.readdirSync(dS)) {
            const dSet = path.join(dS, e); if (!fs.statSync(dSet).isDirectory()) continue;
            let src = ''; try { src = fs.readFileSync(path.join(dS, `${e}.ts`), 'utf8'); } catch { /* sans fichier de set */ }
            const setId = /\bid:\s*["']([^"']+)["']/.exec(src)?.[1] ?? null, cmExp = Number(/cardmarket:\s*(\d+)/.exec(src)?.[1]) || null;
            for (const f of fs.readdirSync(dSet)) {
                if (!f.endsWith('.ts')) continue;
                const c = fs.readFileSync(path.join(dSet, f), 'utf8');
                const blocs = [...c.matchAll(/\bname:\s*\{([^}]*)\}/g)].map(m => m[1]);
                const carte = { tcgId: `${setId}-${f.slice(0, -3)}`, localId: f.slice(0, -3), setId, cmExp, monde, nomEn: chaineDe(blocs[0] || '', 'en'), nomJa: chaineDe(blocs[0] || '', 'ja'), attaques: blocs.slice(1).map(b => chaineDe(b, 'en')).filter(Boolean) };
                for (const idp of new Set([...c.matchAll(/cardmarket:\s*(\d+)/g)].map(m => Number(m[1])))) (parId.get(idp) || parId.set(idp, []).get(idp)).push(carte);
            }
        }
    }
    return parId;
}

(async () => {
    const parId = lireClone(CLONE);
    console.log(`TCGdex (clone) : ${parId.size} idProduct distincts`);
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const ex = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products;
    const nc = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, idExpansion: 1, numero: 1, slug: 1, slugSet: 1, source: 1 } });
    const appris = new Map(nc.map(n => [n.idProduct, n]));
    const codeDe = new Map((await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set', projection: { idExpansion: 1, codeSet: 1 } })).map(c => [c.idExpansion, c.codeSet]));
    const prix = new Map((await lireMongo(prod.db.collection('guide_prix'), {}, { nom: 'guide_prix', projection: { idProduct: 1, trend: 1, avg: 1 } })).map(g => [g.idProduct, g.trend ?? g.avg ?? null]));
    const parJa = new Map();
    for (const d of await lireMongo(cx.db.collection('cartes'), { nomJa: { $type: 'string' }, nomEn: { $type: 'string', $ne: '' } }, { nom: 'cartes à nom japonais', projection: { nomJa: 1, nomEn: 1, 'attaques.nom': 1 } }))
        (parJa.get(d.nomJa) || parJa.set(d.nomJa, []).get(d.nomJa)).push(d);
    const horsCode = ex.filter(p => !estCarteCode(p.name));
    const jamais = horsCode.filter(p => !appris.has(p.idProduct));
    const sansSlug = nc.filter(n => !n.slug && ex.some(() => true)).filter(n => { const p = ex.find(x => x.idProduct === n.idProduct); return p && !estCarteCode(p.name); });
    console.log(`DÉNOMINATEURS : export ${ex.length} produits (${horsCode.length} hors cartes-code) · JAMAIS APPRIS ${jamais.length} · appris SANS slug ${sansSlug.length}`);

    // ── garde 4 : la numérotation TCGdex, calibrée par expansion sur ce que Cardmarket nous a déjà appris
    const calib = new Map();
    for (const n of nc) {
        if (n.source === 'tcgdex' || !n.numero) continue;
        const cs = parId.get(n.idProduct); if (!cs || new Set(cs.map(c => c.tcgId)).size !== 1) continue;
        const g = calib.get(n.idExpansion) || calib.set(n.idExpansion, { n: 0, ok: 0, formes: new Set() }).get(n.idExpansion);
        g.n++; if (cleNumero(cs[0].localId) === cleNumero(n.numero)) { g.ok++; g.formes.add(formeDe(cs[0].localId)); }
    }
    const slugSetDe = new Map();
    for (const n of nc) if (n.slugSet) { const m = slugSetDe.get(n.idExpansion) || slugSetDe.set(n.idExpansion, new Map()).get(n.idExpansion); m.set(n.slugSet, (m.get(n.slugSet) || 0) + 1); }
    const majoritaire = e => { const m = slugSetDe.get(e); return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : null; };

    const retenus = [], refus = [];
    for (const p of jamais) {
        const cs = parId.get(p.idProduct);
        const dire = raison => refus.push({ p, raison });
        if (!cs) { dire('TCGdex ne porte pas cet idProduct'); continue; }
        const cartesTc = [...new Map(cs.map(c => [c.tcgId, c])).values()];
        if (cartesTc.length !== 1) { dire(`TCGdex le porte sur ${cartesTc.length} cartes (${cartesTc.map(c => c.tcgId).join(', ')})`); continue; }
        const c = cartesTc[0];
        if (c.cmExp && c.cmExp !== p.idExpansion) { dire(`expansion contredite : le set TCGdex ${c.setId} écrit l'expansion ${c.cmExp}`); continue; }
        const code = codeDe.get(p.idExpansion);
        if (!code) { dire('expansion sans code appris (codes_set) : aucune jointure possible'); continue; }
        const k = calib.get(p.idExpansion);
        if (!k || k.n < 5 || k.ok !== k.n) { dire(`numérotation TCGdex non calibrée sur cette expansion (${k ? `${k.ok}/${k.n}` : '0/0'})`); continue; }
        if (!k.formes.has(formeDe(c.localId))) { dire(`numéro TCGdex « ${c.localId} » d'une forme jamais vue dans la calibration (${[...k.formes].join(', ')})`); continue; }
        const { nom, attaques } = decomposerNomCardmarket(p.name);
        const clesProduit = cles(nom);
        let temoinNom = null, attaquesCarte = c.attaques;
        if (c.nomEn) { if (cles(c.nomEn).some(x => clesProduit.includes(x))) temoinNom = `nom TCGdex « ${c.nomEn} »`; }
        else if (c.nomJa) {
            const docs = (parJa.get(c.nomJa) || []).filter(d => cles(d.nomEn).some(x => clesProduit.includes(x)));
            if (docs.length) { temoinNom = `nom japonais « ${c.nomJa} » → nos cartes « ${[...new Set(docs.map(d => d.nomEn))].join(' / ')} »`; attaquesCarte = docs.flatMap(d => (d.attaques || []).map(a => a.nom)); }
        }
        if (!temoinNom) { dire(c.nomEn ? `nom TCGdex « ${c.nomEn} » ≠ produit « ${nom} »` : `nom japonais « ${c.nomJa ?? '—'} » : aucune de nos cartes ne le relie au produit « ${nom} »`); continue; }
        const nu = s => cles(s)[0];
        if (attaques.length && !attaques.some(a => attaquesCarte.map(nu).includes(nu(a)))) { dire(`attaques du produit (${attaques.join(' | ')}) absentes de la carte désignée (${attaquesCarte.join(' | ') || '—'})`); continue; }
        retenus.push({ p, c, code, slugSet: majoritaire(p.idExpansion), temoinNom, calibre: `${k.ok}/${k.n}`, attaques: attaques.length ? `${attaques.join(' | ')} ✅` : 'sans attaque' });
    }
    const parRaison = {}; for (const r of refus) { const cleR = r.raison.replace(/«[^»]*»/g, '«…»').replace(/\([^)]*\)/g, '(…)').replace(/\d+/g, '#'); parRaison[cleR] = (parRaison[cleR] || 0) + 1; }
    console.log(`\n✅ APPRIS PAR TCGDEX (toutes gardes) : ${retenus.length} sur ${jamais.length} jamais appris · par expansion : ${JSON.stringify(retenus.reduce((o, r) => (o[`${r.code}(${r.p.idExpansion})`] = (o[`${r.code}(${r.p.idExpansion})`] || 0) + 1, o), {}))}`);
    console.log('🔴 NON APPRIS, par raison :'); for (const [k2, v] of Object.entries(parRaison).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(5)} · ${k2}`);
    let g = 20260926; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    console.log('\n20 TIRÉS AU SORT parmi les appris :');
    for (const r of [...retenus].sort(() => hasard() - 0.5).slice(0, 20)) console.log(`   ${r.p.idProduct} « ${r.p.name} » (exp ${r.p.idExpansion}, ${r.code}) → TCGdex ${r.c.tcgId} n°${r.c.localId} · ${r.temoinNom} · attaques ${r.attaques} · numérotation calibrée ${r.calibre}`);

    // ── la liste de ce que SEUL Cardmarket peut donner, par importance (le prix de tendance au guide, puis l'expansion)
    const pris = new Set(retenus.map(r => r.p.idProduct));
    const seul = jamais.filter(p => !pris.has(p.idProduct)).map(p => ({ idProduct: p.idProduct, idExpansion: p.idExpansion, code: codeDe.get(p.idExpansion) ?? null, nom: p.name, prixTendance: prix.get(p.idProduct) ?? null, pourquoi: refus.find(r => r.p.idProduct === p.idProduct)?.raison }));
    const parExp = new Map(); for (const s of seul) { const e = parExp.get(s.idExpansion) || parExp.set(s.idExpansion, { idExpansion: s.idExpansion, code: s.code, produits: 0, prixTotal: 0 }).get(s.idExpansion); e.produits++; e.prixTotal += s.prixTendance || 0; }
    const liste = {
        genere: new Date().toISOString(), outil: 'apprendre-par-tcgdex.js', export: EXPORT,
        lecture: 'Produits que SEUL Cardmarket peut apprendre : jamais appris et hors de portée de TCGdex (raison par produit), puis les lignes apprises sans slug (le slug n\'est que chez Cardmarket). Importance : prix de tendance du guide (30/08), les plus chers d\'abord ; par expansion : nombre de produits.',
        jamaisAppris: { total: seul.length, parExpansion: [...parExp.values()].sort((a, b) => b.produits - a.produits || b.prixTotal - a.prixTotal).map(e => ({ ...e, prixTotal: Math.round(e.prixTotal * 100) / 100 })), produits: seul.sort((a, b) => (b.prixTendance ?? -1) - (a.prixTendance ?? -1)) },
        sansSlug: { total: sansSlug.length, produits: sansSlug.map(n => ({ idProduct: n.idProduct, idExpansion: n.idExpansion, numero: n.numero ?? null, nom: ex.find(p => p.idProduct === n.idProduct)?.name ?? null, prixTendance: prix.get(n.idProduct) ?? null })).sort((a, b) => (b.prixTendance ?? -1) - (a.prixTendance ?? -1)) }
    };
    const fichierListe = path.join(__dirname, `LISTE-SEUL-CARDMARKET-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(fichierListe, JSON.stringify(liste, null, 1));
    console.log(`\n📋 ${fichierListe} : ${seul.length} jamais appris sur ${parExp.size} expansions + ${sansSlug.length} sans slug`);

    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --base=test --attendu=${retenus.length} --ecrire, après la sauvegarde de numeros_cartes)`); await fermer(); return; }
    if (ATTENDU !== retenus.length) { console.error(`❌ ARRÊT : ${retenus.length} à apprendre contre ${ATTENDU} attendus`); await fermer(); process.exit(1); }
    await fermer();
    // L'ÉCRITURE : la base est NOMMÉE (--base=test) et vérifiée par mongo-connexion.js — la connexion de lecture ci-dessus est
    // en lecture seule par construction et ne peut pas écrire.
    const mongoose = require('mongoose');
    const { connecterMongo } = require('./mongo-connexion');
    const base = await connecterMongo({ script: 'apprendre-par-tcgdex.js', ecrit: true });
    if (base !== 'test') { console.error(`❌ ARRÊT : les numéros appris vivent dans « test », pas dans « ${base} »`); await mongoose.disconnect(); process.exit(1); }
    const N = mongoose.connection.db.collection('numeros_cartes'), le = new Date();
    let n = 0;
    for (const r of retenus) {
        const res = await N.updateOne({ idProduct: r.p.idProduct }, { $setOnInsert: {
            idProduct: r.p.idProduct, idExpansion: r.p.idExpansion, numero: r.c.localId, codeSet: r.code, ...(r.slugSet ? { slugSet: r.slugSet } : {}),
            source: 'tcgdex', certitude: 'exacte', setTcgdex: r.c.setId,
            preuveTcgdex: `idProduct porté par TCGdex ${r.c.tcgId} (variants[].thirdParty.cardmarket) · ${r.temoinNom} · attaques ${r.attaques} · numérotation TCGdex calibrée ${r.calibre} sur l'expansion · apprendre-par-tcgdex.js`,
            apprisLe: le } }, { upsert: true });
        n += res.upsertedCount;
    }
    const relus = await N.countDocuments({ source: 'tcgdex', preuveTcgdex: { $exists: true } });
    console.log(`\n   ✅ ${n} produits appris (attendu ${retenus.length}) · relu : ${relus} lignes portent preuveTcgdex`);
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
