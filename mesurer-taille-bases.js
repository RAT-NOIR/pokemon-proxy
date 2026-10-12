// ============================================================================
// LA TAILLE DES BASES, ET SA CROISSANCE — lecture seule (question du testeur, 2026-10-06 : « le palier gratuit plafonne à 512 Mo »)
// ============================================================================
//   node mesurer-taille-bases.js            mesure les deux grappes (MONGODB_URI : test + test_scratch ; MONGODB_CARTES_URI : cartes)
//   node mesurer-taille-bases.js --toutes   imprime TOUTES les collections (par défaut : les 12 plus lourdes, et le nombre des autres)
//   node mesurer-taille-bases.js --lecture  passe par les utilisateurs de LECTURE (MONGODB_LECTURE_URI, MONGODB_CARTES_LECTURE_URI) :
//                                           la lecture seule est alors garantie par Atlas, pas par ce script (demande du testeur, 2026-10-11)
// Pour chaque base : dbStats (données, stockage, index) et chaque collection (documents, données, stockage, index), triée par poids.
// Une collection dont collStats échoue est IMPRIMÉE avec sa cause et comptée à part, jamais retirée en silence du compte.
// Un argument inconnu est refusé avant toute connexion.
// LE PALIER GRATUIT (Atlas M0) se compte par GRAPPE, données + index : les deux bases d'une même grappe partagent les 512 Mo.
// LA CROISSANCE ne se lit pas dans une mesure seule : chaque passage AJOUTE une ligne datée à mesures/taille-bases.jsonl, et le passage
// suivant imprime l'écart par jour depuis la précédente. Rien d'autre n'est écrit, nulle part.
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');

const ARGS_PERMIS = new Set(['--toutes', '--lecture']);
const args = process.argv.slice(2);
const inconnus = args.filter(a => !ARGS_PERMIS.has(a));
if (inconnus.length) { console.error(`🔴 argument(s) inconnu(s) : ${inconnus.join(' ')} — permis : ${[...ARGS_PERMIS].join(' ')}`); process.exit(1); }
const TOUTES = args.includes('--toutes');
const LECTURE = args.includes('--lecture');

const GRAPPES = LECTURE ? [
    { variable: 'MONGODB_LECTURE_URI', bases: ['test', 'test_scratch'], cle: 'MONGODB_URI' },
    { variable: 'MONGODB_CARTES_LECTURE_URI', bases: ['cartes'], cle: 'MONGODB_CARTES_URI' }
] : [
    { variable: 'MONGODB_URI', bases: ['test', 'test_scratch'], cle: 'MONGODB_URI' },
    { variable: 'MONGODB_CARTES_URI', bases: ['cartes'], cle: 'MONGODB_CARTES_URI' }
];
const mo = o => (o / 1e6).toFixed(1);
const PALIER = 512e6;

(async () => {
    const releve = { le: new Date().toISOString(), grappes: {} };
    console.log(LECTURE ? 'Utilisateurs de LECTURE (MONGODB_LECTURE_URI, MONGODB_CARTES_LECTURE_URI)' : 'Utilisateurs d\'écriture (MONGODB_URI, MONGODB_CARTES_URI) — lecture seule par ce script ; --lecture pour la garantie d\'Atlas');
    for (const { variable, bases, cle } of GRAPPES) {
        if (!process.env[variable]) { console.error(`🔴 ${variable} absente de .env`); process.exit(1); }
        const c = await mongoose.createConnection(process.env[variable]).asPromise();
        let total = 0;
        releve.grappes[cle] = {};                                                   // même clé quel que soit l'utilisateur : la croissance se compare par GRAPPE
        for (const nom of bases) {
            const db = c.useDb(nom, { useCache: false }).db;
            const s = await db.command({ dbStats: 1 });
            const cols = [], refus = [];
            const noms = (await db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name);
            for (const name of noms) {
                try {
                    const st = await db.command({ collStats: name });
                    cols.push({ nom: name, n: st.count, donnees: st.size, stockage: st.storageSize, index: st.totalIndexSize });
                } catch (e) { refus.push({ nom: name, cause: e.codeName || e.message }); }
            }
            cols.sort((a, b) => (b.stockage + b.index) - (a.stockage + a.index));
            const poids = s.dataSize + s.indexSize;
            total += poids;
            releve.grappes[cle][nom] = { donnees: s.dataSize, stockage: s.storageSize, index: s.indexSize, collections: noms.length, mesurees: cols.length, detail: cols };
            console.log(`\n${variable} · base « ${nom} » : données ${mo(s.dataSize)} Mo · stockage ${mo(s.storageSize)} Mo · index ${mo(s.indexSize)} Mo · ${noms.length} collections (${cols.length} mesurées)`);
            const montrees = TOUTES ? cols : cols.slice(0, 12);
            for (const x of montrees)
                console.log(`   ${x.nom.padEnd(28)} ${String(x.n).padStart(8)} docs · données ${mo(x.donnees).padStart(7)} Mo · stockage ${mo(x.stockage).padStart(7)} · index ${mo(x.index).padStart(6)}`);
            if (cols.length > montrees.length) console.log(`   … et ${cols.length - montrees.length} collection(s) plus légère(s) : --toutes pour les voir`);
            for (const r of refus) console.log(`   🔴 ${r.nom.padEnd(28)} collStats refusé : ${r.cause}`);
        }
        releve.grappes[cle].totalDonneesIndex = total;
        console.log(`→ grappe ${cle} : données + index ${mo(total)} Mo sur ${mo(PALIER)} (${(100 * total / PALIER).toFixed(1)} % du palier gratuit)`);
        await c.close();
    }
    fs.mkdirSync('mesures', { recursive: true });
    const f = 'mesures/taille-bases.jsonl';
    const avant = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    const prec = avant[avant.length - 1];
    if (prec) {
        const jours = (Date.parse(releve.le) - Date.parse(prec.le)) / 864e5;
        for (const v of Object.keys(releve.grappes)) {
            const d = releve.grappes[v].totalDonneesIndex - (prec.grappes[v]?.totalDonneesIndex ?? NaN);
            console.log(`CROISSANCE ${v} depuis ${prec.le} (${jours.toFixed(1)} j) : ${mo(d)} Mo, soit ${mo(d / Math.max(jours, 1e-9))} Mo/jour`);
        }
    } else console.log('\n(première mesure enregistrée : la croissance se lira au passage suivant)');
    fs.appendFileSync(f, JSON.stringify(releve) + '\n');
})().catch(e => { console.error(e); process.exit(1); });
