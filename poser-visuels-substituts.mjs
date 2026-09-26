// ============================================================
// LE VISUEL DE SUBSTITUTION D'UNE RÉIMPRESSION — le scan de la carte d'ORIGINE, dans un champ à part, avec sa mention
// ============================================================
//   node poser-visuels-substituts.mjs                                  (mesure + 20 tirés au sort par famille, n'écrit rien)
//   node poser-visuels-substituts.mjs --attendu=<N> --ecrire           (par lot-additif.js)
//
// 🔑 LA DÉCISION DU TESTEUR (2026-09-26) : une réimpression tamponnée (Prize Pack, WCD, Battle Academy) n'a pas de visuel de SON
// tirage (§19 : une image appartient à un tirage) — aucune source ne l'a (TCGdex, pages de carte, 25/09). Le site peut montrer le
// scan de la carte d'origine, AVEC une mention qui dit ce qui diffère. Mais le catalogue sert aussi l'API de RECONNAISSANCE :
//   · le substitut vit dans `cartes_produits.visuelSubstitut`, JAMAIS dans `cartes.images` ni dans aucun champ d'image de la
//     réimpression : aucun lecteur existant ne le voit sans l'avoir demandé par son nom ;
//   · l'index de reconnaissance ne l'utilise jamais comme identité de la réimpression (CONTRAT-SITE.md le dit au lecteur) ;
//   · la table maîtresse ne le compte pas comme visuel : une colonne à part.
// Mentions, mot pour mot : « sans le tampon Prize Pack », « l'impression WCD a une bordure dorée, une signature et un dos
// différent », « sans la marque Battle Academy ».
//
// LES RÈGLES, ÉCRITES AVANT LA MESURE :
// • Le tirage d'origine vient de la LIGNE de jointure, jamais d'une nouvelle devinette : `origine.code/numero` (Prize Packs),
//   « tirage d'origine CODE n°N » de `detail` (WCD à code), le numéro d'origine + l'UNIQUE impression intl de la carte à ce numéro
//   (WCD sans code, `wcd+nom+numero` — c'est la clé qui a posé la fiche), `origine.set/numero` (Battle Academy, nom d'expansion
//   Bulbapedia). Le code → nos sets par `codes_set` (idExpansion) ; le nom d'expansion → nos sets intl qui le déclarent.
// • L'image : UNE entrée de `cartes.images` de la carte, dans un set d'origine, au numéro d'origine (`cleNumero`), que la règle du
//   SITE admet pour un set intl (`visuelAdmisPourLaRegion`, importée telle quelle) — un scan japonais n'est pas un substitut.
//   Deux fichiers différents : rien. Une entrée sans numéro : seulement si c'est la seule de la carte dans ce set.
// • ADDITIF : un `visuelSubstitut` déjà posé n'est jamais réécrit.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const R = 'C:/Users/Yung/Desktop/pokemon-proxy', S = 'C:/Users/Yung/Desktop/rat-market-site';
const require = createRequire(`${R}/package.json`);
process.chdir(R);
require('dotenv').config({ path: `${R}/.env` });
const { visuelAdmisPourLaRegion } = await import(pathToFileURL(`${S}/lib/langueDuVisuel.ts`).href);
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { cleNumero } = require('./collecte-cartes/jointure');

const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ecrire = process.argv.includes('--ecrire'), ATTENDU = arg('attendu') != null ? Number(arg('attendu')) : null;
export const FAMILLES = {
    pps: { preuves: ['pps+origine+numero'], mention: 'Visuel de la carte d\'origine, sans le tampon Prize Pack' },
    wcd: { preuves: ['wcd+origine+numero', 'wcd+nom+numero'], mention: 'Visuel de la carte d\'origine : l\'impression WCD a une bordure dorée, une signature et un dos différent' },
    ba: { preuves: ['deck+section+position', 'deck+section+nom'], mention: 'Visuel de la carte d\'origine, sans la marque Battle Academy' }
};
const familleDe = preuve => Object.keys(FAMILLES).find(f => FAMILLES[f].preuves.includes(preuve)) ?? null;

const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
const preuves = Object.values(FAMILLES).flatMap(f => f.preuves);
const lignes = await lireMongo(cx.db.collection('cartes_produits'), { preuve: { $in: preuves } }, { nom: 'lignes de réimpression', projection: { carteId: 1, idProduct: 1, slug: 1, slugSet: 1, preuve: 1, origine: 1, detail: 1, visuelSubstitut: 1 } });
const cartes = new Map((await lireMongo(cx.db.collection('cartes'), { _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { nom: 'cartes des réimpressions', projection: { nomEn: 1, impressions: 1, images: 1 } })).map(c => [c._id, c]));
const setsIntl = await lireMongo(cx.db.collection('sets'), {}, { nom: 'sets', projection: { idExpansion: 1, region: 1, tirage: 1, 'bulba.expansion': 1 } });
const slugsDeExp = new Map(), slugsDuNom = new Map();
for (const s of setsIntl) {
    if ((s.tirage ?? s.region) !== 'intl') continue;
    for (const e of [].concat(s.idExpansion ?? [])) (slugsDeExp.get(e) || slugsDeExp.set(e, new Set()).get(e)).add(s._id);
    for (const n of [].concat(s.bulba?.expansion ?? [])) (slugsDuNom.get(n) || slugsDuNom.set(n, new Set()).get(n)).add(s._id);
}
const expsDuCode = new Map();
for (const c of await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set', projection: { codeSet: 1, idExpansion: 1 } })) (expsDuCode.get(String(c.codeSet)) || expsDuCode.set(String(c.codeSet), new Set()).get(String(c.codeSet))).add(c.idExpansion);
const slugsDuCode = code => new Set([...(expsDuCode.get(String(code)) || [])].flatMap(e => [...(slugsDeExp.get(e) || [])]));
console.log(`DÉNOMINATEUR : ${lignes.length} lignes de réimpression (${Object.entries(FAMILLES).map(([f, F]) => `${f} ${lignes.filter(l => F.preuves.includes(l.preuve)).length}`).join(' · ')}) · ${cartes.size} cartes · déjà pourvues ${lignes.filter(l => l.visuelSubstitut).length}`);

/** Le tirage d'origine d'une ligne : { slugs:Set, numero, de } ou { raison }. */
function origineDe(l, carte) {
    if (l.preuve === 'pps+origine+numero') {
        if (!l.origine?.code || !l.origine?.numero) return { raison: 'ligne sans origine' };
        return { slugs: slugsDuCode(l.origine.code), numero: l.origine.numero, de: `${l.origine.code} n°${l.origine.numero}` };
    }
    if (l.preuve === 'wcd+origine+numero') {
        const m = /tirage d'origine (\S+) n°(\S+)/.exec(l.detail || '');
        if (!m) return { raison: 'detail sans tirage d\'origine' };
        return { slugs: slugsDuCode(m[1]), numero: m[2], de: `${m[1]} n°${m[2]}` };
    }
    if (l.preuve === 'wcd+nom+numero') {
        const n = /numéro d'origine (\S+)/.exec(l.detail || '')?.[1];
        if (!n) return { raison: 'detail sans numéro d\'origine' };
        const imps = (carte?.impressions || []).filter(i => i.tirage === 'intl' && cleNumero(i.numero) === cleNumero(n));
        const exps = [...new Set(imps.map(i => i.expansion))];
        if (exps.length !== 1) return { raison: `${exps.length} expansions intl au numéro ${n}` };
        return { slugs: slugsDuNom.get(exps[0]) || new Set(), numero: n, de: `${exps[0]} n°${n}` };
    }
    if (l.origine?.set && l.origine?.numero) return { slugs: slugsDuNom.get(l.origine.set) || new Set(), numero: l.origine.numero, de: `${l.origine.set} n°${l.origine.numero}` };
    return { raison: 'ligne sans origine' };
}

const aPoser = [], raisons = {};
const compte = {}; for (const f of Object.keys(FAMILLES)) compte[f] = { n: 0, pourvues: 0, image: 0 };
const noter = (f, r) => { const k = `${f} · ${r}`; raisons[k] = (raisons[k] || 0) + 1; };
for (const l of lignes) {
    const f = familleDe(l.preuve); compte[f].n++;
    if (l.visuelSubstitut) { compte[f].pourvues++; continue; }
    const carte = cartes.get(l.carteId);
    const o = origineDe(l, carte);
    if (o.raison) { noter(f, o.raison); continue; }
    if (!o.slugs.size) { noter(f, 'set d\'origine absent de nos sets intl'); continue; }
    const ims = (carte?.images || []).filter(i => o.slugs.has(i.set) && visuelAdmisPourLaRegion(i, 'intl'));
    const auNumero = ims.filter(i => i.numero != null && cleNumero(i.numero) === cleNumero(o.numero));
    const parSet = new Map(); for (const i of ims) (parSet.get(i.set) || parSet.set(i.set, []).get(i.set)).push(i);
    const sansNumero = ims.filter(i => i.numero == null && parSet.get(i.set).length === 1);
    const choix = [...new Map([...auNumero, ...sansNumero].map(i => [i.cleR2, i])).values()];
    if (!choix.length) { noter(f, (carte?.images || []).some(i => o.slugs.has(i.set)) ? 'image du set d\'origine refusée ou à un autre numéro' : 'aucune image du set d\'origine'); continue; }
    if (choix.length > 1) { noter(f, 'plusieurs fichiers au numéro d\'origine'); continue; }
    const i = choix[0]; compte[f].image++;
    aPoser.push({ l, f, v: { cleR2: i.cleR2, source: i.source ?? null, set: i.set, numero: i.numero ?? null, langue: i.langue ?? null, w: i.w ?? null, h: i.h ?? null, mention: FAMILLES[f].mention, preuve: `tirage d'origine ${o.de} → image de la carte ${l.carteId} dans ${i.set}${i.numero != null ? ` n°${i.numero}` : ' (seule image de la carte dans ce set)'}` } });
}
for (const [f, c] of Object.entries(compte)) console.log(`   ${f} : ${c.n} lignes · déjà pourvues ${c.pourvues} · substitut trouvé ${c.image} (${(100 * c.image / Math.max(1, c.n - c.pourvues)).toFixed(1)} %)`);
console.log('   sans substitut, par raison :', JSON.stringify(raisons));
let g = 20260926; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
for (const f of Object.keys(FAMILLES)) {
    console.log(`\n20 TIRÉS AU SORT — ${f} :`);
    for (const x of aPoser.filter(y => y.f === f).sort(() => hasard() - 0.5).slice(0, 20)) console.log(`   ${x.l.slug} (${x.l.slugSet}) → carte ${x.l.carteId} « ${cartes.get(x.l.carteId)?.nomEn} » · ${x.v.cleR2} · ${x.v.preuve}`);
}
if (!ecrire) { console.log(`\n   (mesure seule : ${aPoser.length} substituts à poser — relancer avec --attendu=${aPoser.length} --ecrire, par lot-additif.js)`); await fermer(); process.exit(0); }
if (ATTENDU !== aPoser.length) { console.error(`❌ ARRÊT : ${aPoser.length} substituts contre ${ATTENDU} attendus — la base ou la règle a bougé depuis la mesure regardée`); await fermer(); process.exit(1); }
const L = cx.db.collection('cartes_produits'), le = new Date();
let n = 0;
for (const x of aPoser) n += (await L.updateOne({ _id: x.l._id, visuelSubstitut: { $exists: false } }, { $set: { visuelSubstitut: { ...x.v, le } } })).modifiedCount;
const relus = await L.countDocuments({ visuelSubstitut: { $exists: true } });
console.log(`\n   ✅ ${n} substituts posés (attendu ${aPoser.length}) · relu : ${relus} lignes portent visuelSubstitut`);
await fermer();
