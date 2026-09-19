// ============================================================
// PRÉPARER LES IMAGES DES LIGNES AUTOMATIQUES (artofpkm) — plan de collecte massive, lot C
// ============================================================
//   node collecte-cartes/preparer-images-auto.js --lister              1 requête : /cards → artofpkm-sets.json
//   node collecte-cartes/preparer-images-auto.js --correspondre        0 requête : lignes auto → sources-sets-auto.json
//   node collecte-cartes/preparer-images-auto.js --mesurer=s4a,sv4a    liste + 3 originaux par set, écrits dans l'état
//
// POURQUOI. Le worker trouve la source d'un set dans sources-sets.js, écrite à la main pour 28 sets : une ligne
// automatique y était absente, et une entrée de file finissait en `refuse-source` — hors de la file POUR TOUJOURS
// (CLAUDE.md §23). La correspondance est GÉNÉRÉE ici, par égalité de nom normalisé ; ambiguë ou absente, elle est
// LISTÉE, jamais devinée. Elle part au worker avec son commit : un seul déploiement couvre toutes les lignes.
// --mesurer écrit `entrees`, `pagesListe` et `mesures` exactement comme collecteur-images.js:177-189 : le worker
// les REPREND (« reprises de l'état ») et ne refait aucune de ces requêtes. Un set dont un original sur 3 est sous
// LARGEUR_MIN est signalé : le worker le refuserait, autant le savoir avant de l'enfiler.
// Débit : artofpkm.js (1 requête / 5 s, sérialisée), sous le verrou GLOBAL artofpkm/__collecteur__ (§17).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./garde');
const { modeles } = require('./schemas');
const { fabriquerVerrou } = require('./verrou-source');
const src = require('./artofpkm');
const { TABLE_AUTO } = require('./table-sets');
const { ARTOFPKM } = require('./sources-sets');
const { LARGEUR_MIN } = require('./seuils-images');

const FICHIER_SETS = path.join(__dirname, 'artofpkm-sets.json');
const FICHIER_AUTO = path.join(__dirname, 'sources-sets-auto.json');
const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}`)); return a ? (a.split('=')[1] ?? true) : null; };
const normaliser = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9★]/g, '');

async function sousVerrouGlobal(M, travail) {
    let perdu = false;
    const v = fabriquerVerrou({ Modele: M.EtatImages, id: 'artofpkm/__collecteur__', dureeMs: 3 * 60 * 1000, surInsertion: { phase: 'collecteur' }, surPerte: () => { perdu = true; }, nom: 'verrou global artofpkm' });
    const tenu = await v.prendre();
    if (tenu) { console.error(`❌ verrou global artofpkm tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s) : rien n'est fait.`); return false; }
    try { return await travail(() => perdu); } finally { await v.rendre(); }
}

(async () => {
    if (arg('correspondre')) {
        const sets = JSON.parse(fs.readFileSync(FICHIER_SETS, 'utf8'));
        const parNom = new Map();
        for (const s of sets) { const k = normaliser(s.nom); parNom.set(k, [...(parNom.get(k) || []), s]); }
        const sortie = {}, absentes = [], ambigues = [];
        // Les « Additionals » Cardmarket (xsv2a, xm2a, xsv11B…) sont des VARIANTES des cartes du set de base (motifs Poké Ball,
        // Master Ball) : leur nom apparie le set artofpkm de base, dont les images appartiennent à un autre tirage (§19). Exclues,
        // et comptées (2026-09-15).
        const additionals = TABLE_AUTO.filter(l => /-Additionals$/.test(l.slugSet || ''));
        const candidates = TABLE_AUTO.filter(l => l.bulba?.tirage !== 'intl' && !ARTOFPKM[l.code] && !additionals.includes(l));
        console.log(`Additionals exclues (variantes du set de base) : ${additionals.length} ${JSON.stringify(additionals.map(l => l.code))}`);
        // 🔑 L'ÉGALITÉ EXACTE D'UN LIBELLÉ RATE LES RÉORDONNANCEMENTS (2026-09-19). artofpkm écrit « High Class Deck,
        // Inteleon VMAX » là où Cardmarket écrit « Inteleon VMAX High Class Deck », et « Starter Set VSTAR, Lucario » là
        // où Cardmarket ajoute l'ère (« Sword Shield Starter Set Lucario VSTAR »). Même famille que les crochets d'Unown,
        // le ☆ et le préfixe SWSH : un ordre ou un mot de plus, et la clé se TAIT — elle ne se trompe pas, elle ne rend rien,
        // ce qui est pire (§30 : une recherche qui ne trouve pas ressemble à une donnée qui n'existe pas).
        // La seconde clé compare les MOTS (accents, ponctuation et pluriels retirés) et accepte l'INCLUSION d'un libellé
        // dans l'autre. Elle n'écrit QUE si un seul set artofpkm correspond : l'unicité est ce qui remplace l'exactitude.
        const mots = s => new Set(String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/[^a-z0-9★]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(m => m.replace(/s$/, '')));
        // ⚠️ L'INCLUSION A ÉTÉ ESSAYÉE PUIS REFUSÉE, LE 2026-09-19, AVANT TOUT USAGE. « M-P Promotional cards » CONTIENT
        // « P Promotional Cards » : la clé rendait le set artofpkm des promos « P » pour les promos M-P, L-P, et même pour
        // les promos chinoises, thaïes et indonésiennes — 9 sources FAUSSES, dont 5 sur des sets qu'artofpkm ne porte pas
        // du tout. Un libellé plus court n'est pas le même set. Seule l'ÉGALITÉ des mots (l'ordre en moins) est retenue.
        const memeMots = (a, b) => a.size === b.size && a.size >= 2 && [...a].every(m => b.has(m));
        const parMots = sets.map(s => ({ s, m: mots(s.nom) }));
        let parReordre = 0;
        for (const l of candidates) {
            const cles = [...new Set([l.nom, l.bulba?.expansion, l.auto?.nomBulbapedia].flat().filter(Boolean).map(normaliser))];
            const trouves = [...new Map(cles.flatMap(k => parNom.get(k) || []).map(s => [s.id, s])).values()];
            if (trouves.length === 1) { sortie[l.code] = { ids: [trouves[0].id], noms: [trouves[0].nom], cle: 'nom-normalise' }; continue; }
            if (trouves.length) { ambigues.push(`${l.code} « ${l.nom} » → ${trouves.map(s => `${s.id} « ${s.nom} »`).join(' | ')}`); continue; }
            const nos = [l.nom, l.bulba?.expansion, l.auto?.nomBulbapedia].flat().filter(Boolean).map(mots).filter(m => m.size >= 2);
            const proches = parMots.filter(({ m }) => nos.some(n => memeMots(m, n)));
            const uniques = [...new Map(proches.map(({ s }) => [s.id, s])).values()];
            if (uniques.length === 1) { sortie[l.code] = { ids: [uniques[0].id], noms: [uniques[0].nom], cle: 'mots-reordonnes' }; parReordre++; continue; }
            if (uniques.length) ambigues.push(`${l.code} « ${l.nom} » → (mots) ${uniques.map(s => `${s.id} « ${s.nom} »`).join(' | ')}`);
            else absentes.push(`${l.code} « ${l.nom} »`);
        }
        console.log(`dont par MOTS RÉORDONNÉS (nouvelle clé) : ${parReordre}`);
        for (const [code, v] of Object.entries(sortie)) if (v.cle === 'mots-reordonnes') console.log(`   RÉORDONNÉ ${code.padEnd(9)} « ${(TABLE_AUTO.find(l => l.code === code) || {}).nom} »  →  ${v.ids[0]} « ${v.noms[0]} »`);
        fs.writeFileSync(FICHIER_AUTO, JSON.stringify(sortie, null, 1));
        console.log(`DÉNOMINATEUR : ${sets.length} sets artofpkm · ${candidates.length} lignes auto non occidentales hors table à la main`);
        console.log(`uniques ${Object.keys(sortie).length} · ambiguës ${ambigues.length} · absentes ${absentes.length} → ${path.basename(FICHIER_AUTO)}`);
        for (const x of ambigues) console.log(`   AMBIGUË  ${x}`);
        const codes = (arg('codes') && String(arg('codes')).split(',')) || [];
        for (const c of codes) console.log(`   ${c.padEnd(8)} ${sortie[c] ? `→ ${sortie[c].ids[0]} « ${sortie[c].noms[0]} »` : '❌ sans correspondance'}`);
        if (arg('absentes')) for (const x of absentes) console.log(`   ABSENTE  ${x}`);
        return;
    }
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx);
    try {
        if (arg('lister')) {
            await sousVerrouGlobal(M, async () => {
                const r = await require('axios').get(`${src.BASE}cards`, { headers: { 'User-Agent': src.UA }, timeout: 60000 });
                const sets = [...String(r.data).matchAll(/<a[^>]*href="\/sets\/(\d+)"[^>]*>[\s\S]*?<h4[^>]*>([\s\S]*?)<\/h4>/g)]
                    .map(m => ({ id: Number(m[1]), nom: m[2].replace(/<[^>]+>/g, '').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim() }));
                const uniques = [...new Map(sets.map(s => [s.id, s])).values()];
                fs.writeFileSync(FICHIER_SETS, JSON.stringify(uniques, null, 1));
                console.log(`/cards : HTTP ${r.status} · ${String(r.data).length} octets · tuiles lues ${sets.length} · sets distincts ${uniques.length} (attendu 419) → ${path.basename(FICHIER_SETS)}`);
            });
            return;
        }
        const codes = String(arg('mesurer') || '').split(',').filter(Boolean);
        if (!codes.length) { console.error('❌ --lister, --correspondre ou --mesurer=CODES'); process.exitCode = 1; return; }
        const auto = JSON.parse(fs.readFileSync(FICHIER_AUTO, 'utf8'));
        await sousVerrouGlobal(M, async perdu => {
            const bilan = [];
            for (const code of codes) {
                if (perdu()) { console.error('⛔ verrou global perdu : arrêt.'); break; }
                const L = TABLE_AUTO.find(l => l.code === code), S = ARTOFPKM[code] || auto[code];   // même ordre que sourceDe
                if (!L || !S) { bilan.push(`${code} ❌ ${!L ? 'ligne absente' : 'sans source'}`); continue; }
                const idEtat = `artofpkm/${L.slugSet}`;
                const etat = await M.EtatImages.findById(idEtat).lean();
                if (etat?.verrou?.depuis) { bilan.push(`${code} ❌ verrou de set présent, non touché`); continue; }
                const w = [];
                for (const id of S.ids) {
                    const entrees = etat?.entrees?.[id]?.length ? etat.entrees[id] : await src.listerSet(id);
                    const mesures = etat?.mesures?.[id]?.length ? etat.mesures[id] : [];
                    if (!mesures.length) for (const e of entrees.slice(0, 3)) mesures.push({ url: e.original, ...(await src.enTeteImage(e.original)) });
                    await M.EtatImages.updateOne({ _id: idEtat }, { $set: { [`entrees.${id}`]: entrees, [`pagesListe.${id}`]: entrees.pages || etat?.pagesListe?.[id] || null, [`mesures.${id}`]: mesures, phase: 'mesure', derniereRequete: new Date() }, $setOnInsert: { debute: new Date() } }, { upsert: true });
                    w.push(...mesures.map(x => x.w));
                    const nbCartes = await M.Carte.countDocuments({ sets: L.slugSet });
                    bilan.push(`${code.padEnd(7)} ${String(id).padStart(4)} « ${S.noms[0]} » · entrées ${entrees.length} pour ${nbCartes} cartes · largeurs ${mesures.map(x => `${x.w}×${x.h}`).join(' ')} ${mesures.some(x => !x.w || x.w < LARGEUR_MIN) ? `❌ SOUS ${LARGEUR_MIN} : le worker refusera` : '✅'}`);
                }
            }
            console.log(`\nBILAN (${codes.length} sets demandés, ${src.compteRequetes()} requêtes artofpkm) :`);
            for (const b of bilan) console.log(`   ${b}`);
        });
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exit(1); });
