// ============================================================
// CE QUI RESTE EN VISUELS, PAR CAUSE — « une seconde passe rapportera-t-elle ? »
// ============================================================
//   node reste-visuels.js
// Lecture seule. Les produits qui ont une FICHE et pas de VISUEL (même définition que mesure-catalogue.js,
// recopiée : une carte jointe porte une image de CE set), rangés par la cause qui les tient, set par set.
// 🔑 La question du testeur, avant trois jours d'absence : « repasser sur un échec qui n'a pas changé de
// cause ne donnera rien ». Ce tableau dit, pour chaque reste, SI sa cause a changé — donc s'il a sa place
// dans la file — et l'instrument qui le prouve.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo, champSur } = require('./collecte-cartes/lecture-sure');
const { sourceDe } = require('./collecte-cartes/sources-sets');
const { ligne } = require('./collecte-cartes/table-sets');
const { LARGEUR_MIN } = require('./collecte-cartes/seuils-images');
const estCarteCode = nom => /\b(online|live)\s+code\s+card\b/i.test(String(nom || ''));   // mesure-catalogue.js:24, mot pour mot

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const produits = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, slugSet: 1, nom: 1, nomFr: 1, nomEn: 1, slug: 1 } });
    const libelle = p => p.nom || p.nomFr || p.nomEn || p.slug || '';
    const slugDe = new Map(produits.filter(p => !estCarteCode(libelle(p))).map(p => [p.idProduct, p.slugSet]));
    const liens = await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1, slugSet: 1, preuve: 1 } });
    const img = await lireMongo(cx.db.collection('cartes'), { 'images.0': { $exists: true } }, { nom: 'cartes (avec images)', projection: { 'images.set': 1 } });
    const setsImg = new Map(img.map(c => [c._id, new Set(c.images.map(i => i.set))]));
    const sets = await lireMongo(cx.db.collection('sets'), {}, { nom: 'sets', projection: { code: 1, region: 1 } });
    champSur(sets, 'region', { collection: 'sets' });
    const setDoc = new Map(sets.map(s => [s._id, s]));
    const file = new Map((await cx.db.collection('file_images').find({}).toArray()).map(u => [u._id, u]));
    const med = new Map();
    for (const e of await cx.db.collection('collecte_images_etat').find({}, { projection: { mesure: 1, infosListe: 1, mesures: 1 } }).toArray()) {
        const slug = String(e._id).split('/').slice(1).join('/');
        if (e.mesure?.mediane != null) { med.set(slug, e.mesure.mediane); continue; }
        const ws = [...(e.infosListe || []).map(x => x?.w), ...Object.values(e.mesures || {}).flat().map(x => x?.w)].filter(Boolean).sort((a, b) => a - b);
        if (ws.length) med.set(slug, ws[Math.floor(ws.length / 2)]);
    }

    // produits fichés sans visuel, par set
    const fiche = new Map(), visuel = new Set(), preuveDe = new Map();
    for (const l of liens) {
        if (!slugDe.has(l.idProduct)) continue;
        const s = slugDe.get(l.idProduct) || l.slugSet;
        fiche.set(l.idProduct, s);
        preuveDe.set(l.idProduct, l.preuve);
        const si = setsImg.get(l.carteId);
        if (si && (si.has(l.slugSet) || si.has(s))) visuel.add(l.idProduct);
    }
    const parSet = new Map();
    for (const [p, s] of fiche) if (!visuel.has(p)) { const k = s || '(sans slugSet)'; parSet.set(k, (parSet.get(k) || 0) + 1); }
    const total = [...parSet.values()].reduce((a, b) => a + b, 0);

    const cause = s => {
        if (/^WCD/.test(s)) return ['WCD : le visuel d\'une réimpression de championnat n\'est pas celui du tirage d\'origine (§19)', 'non'];
        const d = setDoc.get(s);
        const code = d?.code;
        const u = code ? file.get(code) : null;
        if (u && (u.etat === 'attente' || u.etat === 'en-cours')) return ['EN FILE — le worker va le traiter', 'en file'];
        // 🔴 LE TIRAGE, PAS `sets.region` — et ma première version lisait `sets.region`. collecteur-texte.js écrit
        // `region: TIRAGE === 'jp' ? 'jp' : 'intl'` : un set CHINOIS, indonésien ou thaï y est « intl ». Classés par ce
        // champ, 9 908 produits sortaient « jamais mis en file, à instruire » — Brilliant-Fantasy, Blade-Awakening,
        // Stellar-Crystal… — c'est-à-dire le plancher chinois du §42 rebaptisé chantier. Le vrai tirage est sur la
        // LIGNE de table, celle que la collecte a suivie : on lit la même chose que la production.
        const L = code ? ligne(code) : null;
        const region = L?.bulba?.tirage || d?.region || '?';
        const m = med.get(s);
        if (m != null && m < LARGEUR_MIN) return [`seuil : médiane ${m} px < ${LARGEUR_MIN} (§23 — on ne bouge pas un seuil pour ses refus)`, 'non'];
        if (/^zh/.test(region)) return [`plancher CHINOIS (${region}) : trois sources épuisées (§42)`, 'non'];
        const S = code ? sourceDe(code) : null;
        if (!S && ['jp', 'id', 'th', 'idth', 'ko'].includes(region)) return [`plancher ${region.toUpperCase()} : la page de CARTE ne porte que le fichier occidental (§44, --plan)`, 'non'];
        if (!d) return ['aucun document `sets` (set sans ligne collectée)', 'à instruire'];
        if (!u) return [`${S ? 'artofpkm' : 'bulbapedia'} · jamais mis en file`, 'à instruire'];
        return [`${S ? 'artofpkm' : 'bulbapedia'} · unité ${u.etat}/${u.resultat ?? '—'} — source passée, fichier absent ou non joint`, 'à instruire'];
    };
    const parCause = new Map();
    for (const [s, n] of parSet) {
        const [c, statut] = cause(s);
        const k = `${statut} | ${c}`;
        if (!parCause.has(k)) parCause.set(k, { n: 0, sets: [] });
        const g = parCause.get(k); g.n += n; g.sets.push([s, n]);
    }
    console.log(`\n════ ${total} produits ont une FICHE et pas de VISUEL · ${parSet.size} sets ════`);
    for (const [k, g] of [...parCause].sort((a, b) => b[1].n - a[1].n)) {
        console.log(`\n   ${String(g.n).padStart(6)} · ${k}  (${g.sets.length} sets)`);
        console.log(`            ${g.sets.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${s} ${n}`).join(' · ')}${g.sets.length > 8 ? ' …' : ''}`);
        // `--codes` : la liste COMPLÈTE des codes d'une cause « à instruire », à passer à l'instrument qui tranche
        // (`collecteur-images-bulba.js --plan --sets=…`) — §44 : on lance l'instrument AVANT d'écrire « atteignable ».
        if (process.argv.includes('--codes') && k.startsWith('à instruire'))
            console.log(`            codes : ${g.sets.map(([s]) => setDoc.get(s)?.code).filter(Boolean).join(',')}`);
    }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
