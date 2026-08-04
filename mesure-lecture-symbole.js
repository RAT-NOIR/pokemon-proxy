// AD1 — L'IA SAIT-ELLE LIRE LE SYMBOLE DU SET ?
// Tout le plan « le symbole résout la classe » suppose qu'elle reconnaisse un dessin de
// trois millimètres sur une photo d'annonce. On ne l'a jamais vérifié. Le champ est
// journalisé sans effet depuis le début EXPRÈS, pour permettre cette mesure.
//
// ⚠️ UNE CLASSE LUE FAUX EST PIRE QU'UNE CLASSE ABSENTE : elle écarterait la bonne carte
// avec assurance. C'est le seul chiffre qui décide si ce chantier existe.
//
// LECTURE SEULE. MESURE SEULEMENT.
require('dotenv').config();
const mongoose = require('mongoose');
const S = require('./scoring');
const { SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');
const { numeroter, identiteDe, rattacherVerites } = require('./banc-seaux');
const SAISIES = require('./banc-verites.json').verites;

// L'ÉNUMÉRATION FERMÉE, recopiée du prompt (index.js). Toute valeur hors de cette liste
// est une invention du modèle : le prompt lui interdit explicitement d'en produire.
const ENUM = new Set(['logo-tcg', 'R', 'fossile', 'feuilles', 'pokeball', 'gym', 'palmier',
    'etoile', 'ruines', 'couronne', 'eclair', 'vs', 'e1', 'e2', 'e3', 'e4', 'e5', 'mcdo',
    'empreintes', 'croix', 'cercle-chiffre', 'promo-etoile', 'aucun', 'illisible']);

const symboleDuCode = new Map();
for (const s of SETS_VINTAGE_JAPONAIS) {
    symboleDuCode.set(S.normaliserCodeSet(s.code), { symbole: s.symbole, fiable: s.symboleFiable, nom: s.nom });
}

(async () => {
    // Connexion explicite : ce script ne charge pas index.js (qui connecte au passage),
    // il n'a besoin que du journal et du catalogue.
    const conn = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test' }).asPromise();
    const db = conn.db;
    console.log(`base : ${db.databaseName} (LECTURE SEULE)\n`);

    const docs = (await db.collection('journal_scans').find({}).sort({ le: 1 }).toArray())
        .map(d => ({ ...d, le: new Date(d.le) }));
    const { lignes } = numeroter(docs);
    const rat = rattacherVerites(lignes, SAISIES);
    const lot = lignes.filter(l => l.seau === 'lot');

    const nums = await db.collection('numeros_cartes').find({}, { projection: { idProduct: 1, idExpansion: 1 } }).toArray();
    const expDe = new Map(nums.map(n => [n.idProduct, n.idExpansion]));
    const cs = await db.collection('codes_set').find({}, { projection: { idExpansion: 1, codeSet: 1 } }).toArray();
    const codeDe = new Map(cs.map(x => [Number(x.idExpansion), x.codeSet]));
    const codeDuProduit = id => codeDe.get(Number(expDe.get(id))) ?? null;

    // ---- 1. REMPLISSAGE ----
    console.log('══ 1. LE CHAMP EST-IL REMPLI ? ══');
    const vide = [], illisible = [], rempli = [];
    for (const l of lot) {
        const v = l.d.symboleSet;
        if (v == null || String(v).trim() === '') vide.push(l);
        else if (String(v).trim().toLowerCase() === 'illisible') illisible.push(l);
        else rempli.push(l);
    }
    console.log(`   ${lot.length} lignes du lot`);
    console.log(`   rempli d'une valeur ... ${String(rempli.length).padStart(2)}  ${(100 * rempli.length / lot.length).toFixed(0)} %`);
    console.log(`   « illisible » ......... ${String(illisible.length).padStart(2)}  ${(100 * illisible.length / lot.length).toFixed(0)} %   (aveu honnête, pas un échec)`);
    console.log(`   absent / vide ......... ${String(vide.length).padStart(2)}  ${(100 * vide.length / lot.length).toFixed(0)} %`);

    // ---- 2. DANS L'ÉNUMÉRATION ? ----
    console.log('\n══ 2. LES VALEURS RENDUES SONT-ELLES DANS L\'ÉNUMÉRATION FERMÉE ? ══');
    const hors = [], dedans = [];
    const compte = new Map();
    for (const l of [...rempli, ...illisible]) {
        const v = String(l.d.symboleSet).trim();
        compte.set(v, (compte.get(v) || 0) + 1);
        (ENUM.has(v) ? dedans : hors).push({ l, v });
    }
    console.log(`   dans l'énumération .... ${String(dedans.length).padStart(2)}`);
    console.log(`   HORS énumération ...... ${String(hors.length).padStart(2)}${hors.length ? '   ← inventions du modèle' : ''}`);
    for (const h of hors) console.log(`      ${h.l.cle} "${h.l.d.nom}" -> « ${h.v} »`);
    console.log(`   valeurs rendues : ${[...compte.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}×${n}`).join('  ')}`);

    // ---- 3. LE CHIFFRE QUI COMPTE ----
    console.log('\n══ 3. LA CLASSE LUE EST-ELLE CELLE DU SET DE LA VÉRITÉ ? ══');
    console.log('   (seules les lignes dont la vérité appartient à un set de la TABLE CLOSE');
    console.log('    sont comparables : ailleurs, aucun symbole n\'est déclaré.)\n');
    let juste = 0, faux = 0, avoue = 0, nonComparable = 0;
    const detailFaux = [];
    const parLigne = new Map();
    for (const l of lot) {
        const v = rat.parIdentite.get(identiteDe(l.d));
        const attendu = v && v.idProduct !== 'inconnu' ? v.idProduct : null;
        if (attendu == null) { nonComparable++; parLigne.set(l.cle, 'sans vérité'); continue; }
        const code = S.normaliserCodeSet(codeDuProduit(attendu));
        const ref = symboleDuCode.get(code);
        if (!ref) { nonComparable++; parLigne.set(l.cle, `set « ${codeDuProduit(attendu) ?? '?'} » hors table close`); continue; }
        const lu = l.d.symboleSet == null ? null : String(l.d.symboleSet).trim();
        if (lu == null || lu === '' || lu === 'illisible') {
            avoue++; parLigne.set(l.cle, `avoué (${lu ?? 'absent'}) — attendu « ${ref.symbole} »`);
            console.log(`   ⚪ ${l.cle} "${l.d.nom}" : ${lu ?? 'absent'}  (le set ${code} porte « ${ref.symbole} »)`);
            continue;
        }
        if (lu === ref.symbole) {
            juste++; parLigne.set(l.cle, `JUSTE « ${lu} »`);
            console.log(`   ✅ ${l.cle} "${l.d.nom}" : « ${lu} » = symbole de ${code}${ref.fiable === false ? '  (symbole marqué NON fiable)' : ''}`);
        } else {
            faux++; parLigne.set(l.cle, `FAUX : lu « ${lu} », attendu « ${ref.symbole} »`);
            detailFaux.push({ l, lu, attendu: ref.symbole, code });
            console.log(`   ❌ ${l.cle} "${l.d.nom}" : lu « ${lu} », le set ${code} porte « ${ref.symbole} »`);
        }
    }
    const comparables = juste + faux + avoue;
    console.log(`\n   ${comparables} ligne(s) comparables · ${nonComparable} non comparables`);
    if (comparables) {
        console.log(`   JUSTE ..... ${String(juste).padStart(2)}  ${(100 * juste / comparables).toFixed(0)} %`);
        console.log(`   FAUX ...... ${String(faux).padStart(2)}  ${(100 * faux / comparables).toFixed(0)} %   ← une classe fausse écarte la bonne carte AVEC ASSURANCE`);
        console.log(`   avoué ..... ${String(avoue).padStart(2)}  ${(100 * avoue / comparables).toFixed(0)} %   (illisible/absent : inoffensif)`);
    }

    // ---- 4. LES 6 LIGNES QUE LE SYMBOLE EST CENSÉ SAUVER ----
    const SAUVABLES = ['L004', 'L005', 'L006', 'L009', 'L010', 'L012'];
    console.log('\n══ 4. LES 6 LIGNES QUE LE SYMBOLE EST CENSÉ SAUVER ══');
    for (const cle of SAUVABLES) {
        const l = lot.find(x => x.cle === cle);
        if (!l) { console.log(`   ${cle} introuvable`); continue; }
        console.log(`   ${cle} ${String(l.d.nom).padEnd(12)} lu « ${String(l.d.symboleSet ?? '(absent)').padEnd(14)} »  ->  ${parLigne.get(cle)}`);
    }
    process.exit(0);
})();
