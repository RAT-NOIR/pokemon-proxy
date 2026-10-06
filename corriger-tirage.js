// ============================================================
// CORRIGER LE TIRAGE D'UN SET — la base suit la LIGNE de table corrigée (`tirageCorrige`), rien d'autre
// ============================================================
//   node corriger-tirage.js                                    (simulation : comptes par set, écrit l'annonce des baisses)
//   node lot-additif.js --quoi="…" --collections=sets --annonce=<annonce> -- node corriger-tirage.js --ecrire
//
// 🔴 LE CAS (testeur, 2026-09-26) : SV4s…SV10s portaient `tirage: zh-hant` depuis leur création le 15/09, sans preuve écrite, et
// leurs logos disaient « Indonesian (Thai) ». « Établis d'abord le vrai tirage de chaque ligne (page source) ; s'il est indonésien
// ou thaï, corrige le tirage de la ligne et garde les logos. » La page source l'a dit, zéro requête : le champ `release` de chaque
// page « (ATCG) » ne nomme QUE « Indonesian » (SV4s, SV5s, SV6s) ou « Indonesian » et « Thai » (SV7s → SV10s) — la forme exacte de
// SV11s, MA1 et MA4, déjà en `idth`. La preuve vit sur la ligne (`tirageCorrige`), écrite dans le même commit que la ligne.
// 🔑 LE TIRAGE EST UNE CLÉ, PAS UNE ÉTIQUETTE : le site apparie `imp.tirage === (set.tirage ?? set.region)`. Corriger le set
// seul décrocherait les 400 fiches numérotées ; les impressions que la Setlist a posées (`source: 'setlist'`,
// poser-impressions-setlist.js) et les lignes de jointure (`cartes_produits.tirage`) suivent donc dans le même lot.
// Ce qui est touché, et rien d'autre (tout le reste refuse) :
//   · le set dont la ligne porte `tirageCorrige`, s'il porte encore le tirage `de` ;
//   · les impressions POSÉES APRÈS LE PARSEUR (`source` dans SOURCES_POSEES_APRES : 'setlist', et depuis le 2026-10-06
//     'numero-cardmarket'), au tirage `de`, au nom d'expansion de la ligne — une impression lue sur une PAGE DE CARTE (sans
//     `source`) n'est jamais réécrite : elle dit ce que la page dit ;
//   · les lignes de jointure de l'expansion Cardmarket de la ligne, au tirage `de`.
// C'est une MODIFICATION (feu vert du testeur, 2026-09-26) : la garde de lot voit baisser `impressions imp:<de>|<expansion>` —
// l'annonce écrite par la simulation, par la même fonction que la garde (compterEtat), la rend exacte, ni plus ni moins.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
// la liste des sources posées vit dans impressions-posees.js : une copie ici divergerait au prochain ajout (§21 bis)
const { SOURCES_POSEES_APRES } = require('./collecte-cartes/impressions-posees');
const POSEE = { $in: SOURCES_POSEES_APRES };
const posee = i => SOURCES_POSEES_APRES.includes(i.source);

const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');
const TIRAGES = new Set(['jp', 'intl', 'zh-hans', 'zh-hant', 'id', 'th', 'idth']);

(async () => {
    const lignes = [...new Map([...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE].filter(l => l.tirageCorrige).map(l => [l.slugSet, l])).values()];
    for (const l of lignes) {
        if (!TIRAGES.has(l.bulba?.tirage) || !TIRAGES.has(l.tirageCorrige.de) || l.bulba.tirage === l.tirageCorrige.de || !l.tirageCorrige.preuve) throw new Error(`ligne ${l.code} : tirageCorrige incohérent (${l.tirageCorrige.de} → ${l.bulba?.tirage}, preuve ${l.tirageCorrige.preuve ? 'oui' : 'NON'})`);
        if ([].concat(l.bulba.expansion).length !== 1) throw new Error(`ligne ${l.code} : plusieurs noms d'expansion — on ne devine pas lequel suit`);
    }
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('cartes'), CP = cx.db.collection('cartes_produits'), S = cx.db.collection('sets');
    console.log(`\n════ DÉNOMINATEUR : ${lignes.length} lignes de table portent tirageCorrige ════`);
    const plan = [];
    for (const l of lignes) {
        const de = l.tirageCorrige.de, vers = l.bulba.tirage, nom = [].concat(l.bulba.expansion)[0];
        const s = await S.findOne({ _id: l.slugSet }, { projection: { tirage: 1, region: 1 } });
        const imps = await C.find({ impressions: { $elemMatch: { tirage: de, expansion: nom, source: POSEE } } }, { projection: { impressions: 1, sets: 1 } }).toArray();
        const nImp = imps.reduce((n, c) => n + c.impressions.filter(i => i && i.tirage === de && i.expansion === nom && posee(i)).length, 0);
        const lirePage = await C.countDocuments({ impressions: { $elemMatch: { tirage: de, expansion: nom, source: { $exists: false } } } });
        const nCp = await CP.countDocuments({ idExpansion: l.exp, tirage: de });
        const etat = !s ? 'set ABSENT' : s.tirage === vers ? 'déjà corrigé' : s.tirage !== de ? `set au tirage ${s.tirage} (ni ${de} ni ${vers}) : REFUSÉ` : s.region !== 'intl' ? `région ${s.region} : REFUSÉ` : 'à corriger';
        console.log(`   ${l.code.padEnd(6)} ${l.slugSet.padEnd(24)} ${de} → ${vers} · set : ${etat} · impressions Setlist ${nImp} (${imps.length} cartes) · impressions de page ${lirePage} (non touchées) · lignes de jointure ${nCp}`);
        if (etat === 'à corriger' || (etat === 'déjà corrigé' && (nImp || nCp))) plan.push({ l, de, vers, nom, nImp, nCp, cartes: imps, set: etat === 'à corriger' });
    }
    // L'annonce, par la fonction de la garde : l'état des cartes touchées avant, et tel qu'il sera après.
    const avant = compterEtat({ cartes: plan.flatMap(p => p.cartes) });
    const apres = compterEtat({ cartes: plan.flatMap(p => p.cartes.map(c => ({ ...c, impressions: c.impressions.map(i => i && i.tirage === p.de && i.expansion === p.nom && posee(i) ? { ...i, tirage: p.vers } : i) }))) });
    const { baisses } = comparer(avant, apres);
    const annonce = Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
    const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', `annonce-corriger-tirage-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(annonce, null, 1));
    console.log(`\n   à écrire : ${plan.filter(p => p.set).length} sets · ${plan.reduce((n, p) => n + p.nImp, 0)} impressions · ${plan.reduce((n, p) => n + p.nCp, 0)} lignes de jointure`);
    console.log(`   annonce des baisses (${baisses.length} groupes) → ${fichier}\n   ${baisses.map(b => `${b.cle} −${b.baisse}`).join('\n   ')}`);
    if (!ecrire) { console.log('\n   (simulation — relancer par lot-additif.js --annonce=<ce fichier> … -- node corriger-tirage.js --ecrire)'); await fermer(); return; }

    const le = new Date();
    let nS = 0, nI = 0, nL = 0;
    for (const p of plan) {
        if (p.set) nS += (await S.updateOne({ _id: p.l.slugSet, tirage: p.de }, { $set: { tirage: p.vers, tirageCorrige: { de: p.de, le, preuve: p.l.tirageCorrige.preuve } } })).modifiedCount;
        nI += (await C.updateMany({ impressions: { $elemMatch: { tirage: p.de, expansion: p.nom, source: POSEE } } }, { $set: { 'impressions.$[i].tirage': p.vers } }, { arrayFilters: [{ 'i.tirage': p.de, 'i.expansion': p.nom, 'i.source': POSEE }] })).modifiedCount;
        nL += (await CP.updateMany({ idExpansion: p.l.exp, tirage: p.de }, { $set: { tirage: p.vers } })).modifiedCount;
    }
    // Relu : plus rien au tirage `de` sur ces expansions, et le tirage `vers` au compte.
    let reste = 0;
    for (const p of plan) reste += await C.countDocuments({ impressions: { $elemMatch: { tirage: p.de, expansion: p.nom, source: POSEE } } }) + await CP.countDocuments({ idExpansion: p.l.exp, tirage: p.de }) + await S.countDocuments({ _id: p.l.slugSet, tirage: p.de });
    console.log(`\n   ✅ sets ${nS} · cartes modifiées ${nI} · lignes de jointure ${nL} · relu : ${reste} document(s) encore à l'ancien tirage`);
    if (reste) { console.error('❌ la relecture trouve encore l\'ancien tirage'); await fermer(); process.exit(1); }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
