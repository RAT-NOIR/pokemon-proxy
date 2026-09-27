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
//      ⚠️ À DÉFAUT (2026-09-26, EX Holon Phantoms : aucun produit de 1551 n'a jamais été appris par Cardmarket, la calibration
//      rendait 0/0) : sur les numéros que NOS CARTES déclarent pour l'expansion de la ligne de table ADMISE, le set TCGdex qui
//      nomme cette expansion Cardmarket porte au même numéro une carte du même nom — 100 %, sur 5 au moins. Elle calibre TCGdex
//      contre le numéro IMPRIMÉ (Bulbapedia), et la jointure rejugera chaque fiche par son témoin du nom ;
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
const { cleNumero, clesNom, decomposerNomCardmarket, estCarteCode } = require('./collecte-cartes/jointure');
const { TABLE } = require('./collecte-cartes/table-sets');

const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CLONE = arg('clone'), EXPORT = arg('export') || 'products_singles_24092026.json';
const ecrire = process.argv.includes('--ecrire'), ATTENDU = arg('attendu') != null ? Number(arg('attendu')) : null;
if (!CLONE || !fs.existsSync(path.join(CLONE, 'data'))) { console.error('❌ --clone=<chemin du clone tcgdex/cards-database> requis'); process.exit(2); }
const chaineDe = (bloc, cle) => { const m = new RegExp(`\\b${cle}:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`).exec(bloc); return m ? m[2].replace(/\\(.)/g, '$1') : null; };
// La FORME d'un numéro (« 095 » → « # », « SWSH291 » → « SWSH# », « Museum » → « Museum ») : un numéro dont la forme n'a jamais été
// vue dans la calibration n'est pas calibré (mep-Museum, 2026-09-26 : 120/120 sur des numéros, et « Museum » n'en est pas un).
const formeDe = id => String(id).replace(/\d+/g, '#');
const sansDelta = nom => String(nom || '').replace(/δ\s+Delta Species\b/g, 'δ');
const cles = nom => clesNom(sansDelta(nom));
// Pour la calibration par nos cartes seulement : Bulbapedia nomme la page « Raichu δ (EX Holon Phantoms 15) » et la carte « Raichu »,
// TCGdex écrit « Raichu δ » ; « Gyarados ☆ δ » et « Gyarados δ » restent distincts par leur NUMÉRO, qui est ce qu'on calibre.
const nomNu = nom => clesNom(String(nom || '').replace(/δ(\s+Delta Species)?/g, ' ').replace(/☆|\bGold Star\b/g, ' ').replace(/\s+/g, ' ').trim());

/** Le clone : idProduct → cartes TCGdex { tcgId, localId, setId, cmExp, nomEn, nomJa, attaques[] } ; et, par expansion Cardmarket
 *  qu'un fichier de SET nomme, ses cartes par numéro (la calibration par nos cartes). */
function lireClone(racine) {
    const parId = new Map();
    lireClone.parExpansion = new Map();
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
                if (cmExp) { const m = lireClone.parExpansion.get(cmExp) || lireClone.parExpansion.set(cmExp, new Map()).get(cmExp); (m.get(cleNumero(carte.localId)) || m.set(cleNumero(carte.localId), []).get(cleNumero(carte.localId))).push(carte); }
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
    const nc = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, idExpansion: 1, numero: 1, slug: 1, slugSet: 1, source: 1, certitude: 1 } });
    const appris = new Map(nc.map(n => [n.idProduct, n]));
    const codeDe = new Map((await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set', projection: { idExpansion: 1, codeSet: 1 } })).map(c => [c.idExpansion, c.codeSet]));
    const guide = await lireMongo(prod.db.collection('guide_prix'), {}, { nom: 'guide_prix', projection: { idProduct: 1, trend: 1, avg: 1, low: 1 } });
    const prix = new Map(guide.map(g => [g.idProduct, g.trend ?? g.avg ?? null]));
    // `low` = l'offre la plus basse au jour du guide (30/08) : sans offre, Cardmarket ne montre pas le produit dans ses listes
    // (mesuré sur le journal 1.8, 2026-09-26 : BREAKthrough 36 jamais vus, 36 sans offre ; BREAKpoint 33/33 ; Ancient Origins 20/20).
    const avecOffre = new Set(guide.filter(g => g.low > 0).map(g => g.idProduct));
    const parJa = new Map();
    for (const d of await lireMongo(cx.db.collection('cartes'), { nomJa: { $type: 'string' }, nomEn: { $type: 'string', $ne: '' } }, { nom: 'cartes à nom japonais', projection: { nomJa: 1, nomEn: 1, 'attaques.nom': 1 } }))
        (parJa.get(d.nomJa) || parJa.set(d.nomJa, []).get(d.nomJa)).push(d);
    const horsCode = ex.filter(p => !estCarteCode(p.name));
    const jamais = horsCode.filter(p => !appris.has(p.idProduct));
    const sansSlug = nc.filter(n => !n.slug && ex.some(() => true)).filter(n => { const p = ex.find(x => x.idProduct === n.idProduct); return p && !estCarteCode(p.name); });
    console.log(`DÉNOMINATEURS : export ${ex.length} produits (${horsCode.length} hors cartes-code) · JAMAIS APPRIS ${jamais.length} · appris SANS slug ${sansSlug.length}`);

    // ── garde 4 : la numérotation TCGdex, calibrée par expansion sur ce que Cardmarket nous a déjà appris
    const calib = new Map();
    // 🔴 troisième relecture de la déduction (2026-09-26, nuit) : le filtre s'écrivait par ce qu'il refuse (« pas tcgdex ») et laissait
    // calibrer sur les lignes `cardmarket-deduit` — une déduction n'est pas ce que Cardmarket nous a APPRIS. Il s'écrit par ce qu'il
    // autorise (§51) : une ligne LUE chez Cardmarket, exacte ou d'avant le champ `certitude`.
    const lueChezCardmarket = n => n.source === 'cardmarket' && (n.certitude == null || n.certitude === 'exacte');
    for (const n of nc) {
        if (!lueChezCardmarket(n) || !n.numero) continue;
        const cs = parId.get(n.idProduct); if (!cs || new Set(cs.map(c => c.tcgId)).size !== 1) continue;
        const g = calib.get(n.idExpansion) || calib.set(n.idExpansion, { n: 0, ok: 0, formes: new Set() }).get(n.idExpansion);
        g.n++; if (cleNumero(cs[0].localId) === cleNumero(n.numero)) { g.ok++; g.formes.add(formeDe(cs[0].localId)); }
    }
    // ── garde 4, À DÉFAUT d'une calibration par Cardmarket : par NOS cartes, sur la ligne de table ADMISE de l'expansion, contre le
    // set TCGdex qui NOMME cette expansion Cardmarket (thirdParty.cardmarket du fichier de set). Une expansion sans ligne admise,
    // sans set TCGdex qui la nomme, ou sans carte collectée ne se calibre pas : elle reste refusée, et la raison le dit.
    const parCartes = new Map();
    for (const e of new Set(jamais.map(p => p.idExpansion))) {
        const k = calib.get(e); if (k && k.n >= 5) continue;
        const tc = lireClone.parExpansion.get(e); if (!tc) continue;
        const L = TABLE.find(l => l.exp === e && l.verifie && l.bulba?.expansion && l.bulba?.tirage); if (!L) continue;
        const noms = [].concat(L.bulba.expansion), nous = new Map();
        const docs = await lireMongo(cx.db.collection('cartes'), { impressions: { $elemMatch: { expansion: { $in: noms }, tirage: L.bulba.tirage } } }, { nom: `cartes déclarant « ${noms.join(' / ')} »`, projection: { nomEn: 1, impressions: 1 }, videAutorise: 'une expansion dont aucune carte n\'est collectée ne se calibre pas : elle reste refusée' });
        for (const d of docs) for (const i of d.impressions || []) if (noms.includes(i.expansion) && i.tirage === L.bulba.tirage) { const kn = cleNumero(i.numero); (nous.get(kn) || nous.set(kn, []).get(kn)).push(d.nomEn); }
        const g = { n: 0, ok: 0, formes: new Set(), source: `nos cartes « ${noms.join(' / ')} » (${L.bulba.tirage}, ligne ${L.code})`, contredits: [] };
        for (const [kn, ns] of nous) {
            const t = tc.get(kn); if (!t || t.length !== 1 || new Set(ns).size !== 1) continue;
            g.n++;
            if (nomNu(t[0].nomEn).some(x => nomNu(ns[0]).includes(x))) { g.ok++; g.formes.add(formeDe(t[0].localId)); } else g.contredits.push(`${t[0].localId} TCGdex « ${t[0].nomEn} » / nous « ${ns[0]} »`);
        }
        parCartes.set(e, g);
        console.log(`   calibration par nos cartes, exp ${e} : ${g.ok}/${g.n} · ${g.source}${g.contredits.length ? ` · contredits : ${g.contredits.slice(0, 5).join(' | ')}` : ''}`);
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
        const kCm = calib.get(p.idExpansion), kN = parCartes.get(p.idExpansion);
        const k = kCm && kCm.n >= 5 ? { ...kCm, source: 'produits appris par Cardmarket' } : kN;
        if (!k || k.n < 5 || k.ok !== k.n) { dire(`numérotation TCGdex non calibrée sur cette expansion (Cardmarket ${kCm ? `${kCm.ok}/${kCm.n}` : '0/0'}${kN ? ` · nos cartes ${kN.ok}/${kN.n}` : ''})`); continue; }
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
        retenus.push({ p, c, code, slugSet: majoritaire(p.idExpansion), temoinNom, calibre: `${k.ok}/${k.n} (${k.source})`, attaques: attaques.length ? `${attaques.join(' | ')} ✅` : 'sans attaque' });
    }
    const parRaison = {}; for (const r of refus) { const cleR = r.raison.replace(/«[^»]*»/g, '«…»').replace(/\([^)]*\)/g, '(…)').replace(/\d+/g, '#'); parRaison[cleR] = (parRaison[cleR] || 0) + 1; }
    console.log(`\n✅ APPRIS PAR TCGDEX (toutes gardes) : ${retenus.length} sur ${jamais.length} jamais appris · par expansion : ${JSON.stringify(retenus.reduce((o, r) => (o[`${r.code}(${r.p.idExpansion})`] = (o[`${r.code}(${r.p.idExpansion})`] || 0) + 1, o), {}))}`);
    console.log('🔴 NON APPRIS, par raison :'); for (const [k2, v] of Object.entries(parRaison).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(5)} · ${k2}`);
    let g = 20260926; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    console.log('\n20 TIRÉS AU SORT parmi les appris :');
    for (const r of [...retenus].sort(() => hasard() - 0.5).slice(0, 20)) console.log(`   ${r.p.idProduct} « ${r.p.name} » (exp ${r.p.idExpansion}, ${r.code}) → TCGdex ${r.c.tcgId} n°${r.c.localId} · ${r.temoinNom} · attaques ${r.attaques} · numérotation calibrée ${r.calibre}`);

    // ── la liste de ce que SEUL Cardmarket peut donner, par importance (le prix de tendance au guide, puis l'expansion)
    const pris = new Set(retenus.map(r => r.p.idProduct));
    // 🔑 TRIÉE PAR VALEUR (testeur, 2026-09-26 : « pour que mes passes Tampermonkey visent d'abord ce qui compte ») : le prix de
    // tendance du guide Cardmarket quand on l'a, puis le prix moyen ; un produit sans prix au guide vient après tous ceux qui en ont.
    // Par expansion : la VALEUR totale d'abord, le nombre de produits ensuite. Le slug de l'expansion (appris, sinon rien) et le nom
    // que lui donne TCGdex (fichier de set) disent où aller la chercher.
    const nomTcDe = new Map(); for (const cs of parId.values()) for (const c of cs) if (c.cmExp && !nomTcDe.has(c.cmExp)) nomTcDe.set(c.cmExp, c.setId);
    const seul = jamais.filter(p => !pris.has(p.idProduct)).map(p => ({ idProduct: p.idProduct, idExpansion: p.idExpansion, code: codeDe.get(p.idExpansion) ?? null, slugSet: majoritaire(p.idExpansion), nom: p.name, prixTendance: prix.get(p.idProduct) ?? null, visibleDansLesListes: avecOffre.has(p.idProduct), pourquoi: refus.find(r => r.p.idProduct === p.idProduct)?.raison }));
    const parExp = new Map(); for (const s of seul) { const e = parExp.get(s.idExpansion) || parExp.set(s.idExpansion, { idExpansion: s.idExpansion, code: s.code, slugSet: s.slugSet, setTcgdex: nomTcDe.get(s.idExpansion) ?? null, produits: 0, sansPrix: 0, prixTotal: 0 }).get(s.idExpansion); e.produits++; if (s.prixTendance == null) e.sansPrix++; e.prixTotal += s.prixTendance || 0; }
    const parValeur = (a, b) => (b.prixTendance ?? -1) - (a.prixTendance ?? -1);
    const liste = {
        genere: new Date().toISOString(), outil: 'apprendre-par-tcgdex.js', export: EXPORT,
        lecture: 'Produits que SEUL Cardmarket peut apprendre : jamais appris et hors de portée de TCGdex (raison par produit), puis les lignes apprises sans slug (le slug n\'est que chez Cardmarket). TRI PAR VALEUR : prix de tendance du guide Cardmarket (30/08), les plus chers d\'abord, les produits sans prix au guide en dernier ; par expansion : valeur totale, puis nombre de produits. `pourTaPasse` : ceux qui avaient une offre au guide, donc visibles dans les listes ; `invisibles` : AUCUNE offre au 30/08 — Cardmarket ne les montre pas dans ses listes (journal 1.8), ta passe ne les verra pas : ils attendent une autre voie (page produit directe, à tester sur un cas).',
        jamaisAppris: { total: seul.length, sansPrix: seul.filter(s => s.prixTendance == null).length, parExpansion: [...parExp.values()].sort((a, b) => b.prixTotal - a.prixTotal || b.produits - a.produits).map(e => ({ ...e, prixTotal: Math.round(e.prixTotal * 100) / 100 })), produits: seul.sort(parValeur) },
        pourTaPasse: { total: seul.filter(s => s.visibleDansLesListes).length, produits: seul.filter(s => s.visibleDansLesListes).sort(parValeur) },
        invisibles: { total: seul.filter(s => !s.visibleDansLesListes).length, produits: seul.filter(s => !s.visibleDansLesListes).sort(parValeur) },
        sansSlug: { total: sansSlug.length, produits: sansSlug.map(n => ({ idProduct: n.idProduct, idExpansion: n.idExpansion, code: codeDe.get(n.idExpansion) ?? null, slugSet: n.slugSet ?? majoritaire(n.idExpansion), numero: n.numero ?? null, nom: ex.find(p => p.idProduct === n.idProduct)?.name ?? null, prixTendance: prix.get(n.idProduct) ?? null, visibleDansLesListes: avecOffre.has(n.idProduct) })).sort(parValeur) }
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
