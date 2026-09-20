// ============================================================
// LE NOM FRANÇAIS DES SETS — `sets.nomFr`, depuis TCGdex, avec sa source et sa preuve
// ============================================================
//   node collecter-noms-fr-sets.js            (mesure seule, c'est le défaut)
//   node collecter-noms-fr-sets.js --ecrire
//   node collecter-noms-fr-sets.js --refus    (les sets sans nom français, et POURQUOI)
//
// 🔴 POURQUOI TCGDEX ET PAS BULBAPEDIA, alors que Bulbapedia a la donnée et coûte ZÉRO requête.
// L'archive porte bien le nom français, dans `{{Langtable|fr=}}` — 251 pages de sets, mesuré. Mais
// `rapatrier-noms-fr.js` porte depuis le premier jour la règle qui tranche : « LA SOURCE EST
// CARDMARKET, PAS BULBAPEDIA. Les traductions de Bulbapedia sont sous licence NON COMMERCIALE et
// n'ont rien à faire ici. » Elle vaut pour le nom d'un set comme pour celui d'une carte.
// ⚠️ Et Cardmarket ne peut pas servir ici : les 12 collections de la production ont été ÉNUMÉRÉES
// champ par champ le 2026-09-20 — `numeros_cartes.nomFr` est le nom de la CARTE, `slugSet` est en
// anglais, `codes_set` ne porte que code/région. AUCUN nom français d'expansion en base.
// TCGdex est la troisième voie : licence ouverte, déjà utilisée par le dépôt (`prefill-tcgdex.js`),
// et elle couvre PLUS que Bulbapedia (124 contre 116 sur la même clé).
//
// 🔑 LA RÈGLE DE RÉGION EST STRUCTURELLE, PAS PRUDENTIELLE (§26, cinquième occurrence du motif).
// Un set JAPONAIS n'a jamais eu de sortie française : il n'a donc pas de nom français, et tout `fr`
// lu sur sa page est celui du JUMEAU occidental. Mesuré sur l'archive : « Expansion Pack » → « Set
// de Base », « Rocket Gang » → « Team Rocket », « Cry from the Mysterious » → « Éveil des Légendes ».
// 127 des 251 pages portant un `fr` sont des sets japonais. On ne traite QUE `region === 'intl'`.
//
// 🔑 LA CLÉ EST L'ÉGALITÉ DU NOM, JAMAIS UNE INCLUSION (§31), ET ELLE SE LIT EN DEUX PASSES.
//   passe 1 — `nomAffichage` : le nom qu'on a déjà établi comme UNIQUE par set (§26). Une clé bâtie
//             dessus hérite de sa discriminance.
//   passe 2 — repli sur `nomEn`, SEULEMENT pour un nom que la passe 1 n'a pas déjà pris.
// ⚠️ LA PASSE 2 A ÉTÉ ÉCRITE D'ABORD EN ANNULATION MUTUELLE, ET C'ÉTAIT LE §33. Les extras Cardmarket
// « Additionals » (xPBL, xJTG…) n'ont pas de `nomAffichage` ; en repliant sur `nomEn` ils réclamaient
// le nom de leur primaire, et le contrôle de discriminance ABATTAIT LES DEUX — 8 sets justes perdus
// pour 6 gagnés. Un extra qui ne peut rien afficher ne doit pas réserver le nom du set qui le peut.
// La priorité remplace l'annihilation : 124 retenus, 0 collision.
//
// ⚠️ DEUX SOURCES CONFRONTÉES AVANT DE CROIRE CELLE-CI (§16). Sur les 109 sets que TCGdex ET
// Bulbapedia couvrent tous les deux : 106 d'accord (97,2 %), 3 en désaccord — EX, GE, TM. Ces trois
// ne reçoivent RIEN : c'est la règle 2 de `rapatrier-noms-fr.js` (« si les sources divergent, on
// écrit null, jamais l'une des deux »), et une divergence est le seul signe qu'on a que quelque
// chose ne va pas — on la compte, on ne la lisse pas.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const https = require('https');

const getJSON = url => new Promise((ok, ko) => https.get(url, { headers: { 'User-Agent': 'rat-market-catalogue/1.0' } }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { ok(JSON.parse(d)); } catch (e) { ko(e); } });
}).on('error', ko));

// accents, casse, ponctuation et `&`/`+` normalisés — la même clé que le reste du chantier
const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[&+]/g, ' ').replace(/[^a-z0-9]/g, '');

// Les trois sets sur lesquels TCGdex et Bulbapedia se contredisent. Ils ne reçoivent pas de nom.
// ⚠️ Cette liste est une CONSTATATION datée du 2026-09-20, pas un réglage : elle se REMESURE (le
// script `m-fr-croise.js` du bac à sable la reproduit), elle ne se recopie pas.
const DIVERGENTS = {
    EX: 'TCGdex « Expedition » · Bulbapedia « Expedition Édition de Base »',
    GE: 'TCGdex « Duels au Sommets » · Bulbapedia « Duels au Sommet »',
    TM: 'TCGdex « Triomphant » · Bulbapedia « Triomphe »'
};

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const montrerRefus = process.argv.includes('--refus');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });

    const sets = await cx.db.collection('sets').find({}, {
        projection: { code: 1, region: 1, nomAffichage: 1, nomEn: 1, nomFr: 1 }
    }).toArray();
    const intl = sets.filter(s => s.region === 'intl');
    console.log(`\n════ DÉNOMINATEUR : ${sets.length} sets · ${intl.length} occidentaux · ${sets.length - intl.length} non occidentaux (exclus : pas de sortie française) ════`);

    const [fr, en] = [await getJSON('https://api.tcgdex.net/v2/fr/sets'), await getJSON('https://api.tcgdex.net/v2/en/sets')];
    // ⚠️ un nom anglais qui désigne DEUX sets TCGdex ne désigne rien : il sort de la clé.
    const vus = new Map(), ambigusSource = new Set();
    for (const t of en) { const k = cle(t.name); if (vus.has(k)) ambigusSource.add(k); else vus.set(k, t.id); }
    for (const k of ambigusSource) vus.delete(k);
    const frParId = new Map(fr.map(t => [t.id, t.name]));
    console.log(`   TCGdex : ${en.length} sets en anglais · ${fr.length} en français · ${ambigusSource.size} noms anglais ambigus écartés de la clé`);

    // ---- PASSE 1 : `nomAffichage`, le nom unique par construction -------------
    const retenus = [], refuses = [];
    const nomsPris = new Set();          // les noms ANGLAIS déjà réclamés par un set
    const idsPris = new Map();           // id TCGdex → code de set, pour interdire deux sets sur un id
    const essayer = (s, propose, passe) => {
        const id = vus.get(cle(propose));
        if (!id) return { ok: false, motif: `aucun set TCGdex ne porte exactement « ${propose} »` };
        const nomFr = frParId.get(id);
        if (!nomFr) return { ok: false, motif: `TCGdex a le set [${id}] mais pas de nom français` };
        if (DIVERGENTS[s.code]) return { ok: false, motif: `les deux sources divergent — ${DIVERGENTS[s.code]}` };
        if (idsPris.has(id)) return { ok: false, motif: `l'id TCGdex [${id}] est déjà pris par ${idsPris.get(id)} — deux de nos sets pour une seule sortie française` };
        return { ok: true, id, nomFr, passe, propose };
    };
    for (const s of intl) {
        if (!s.nomAffichage) continue;
        const r = essayer(s, s.nomAffichage, 'nomAffichage');
        if (r.ok) { retenus.push({ s, ...r }); nomsPris.add(cle(s.nomAffichage)); idsPris.set(r.id, s.code); }
        else refuses.push({ s, motif: r.motif });
    }
    // ---- PASSE 2 : repli sur `nomEn`, jamais sur un nom déjà pris ------------
    for (const s of intl) {
        if (s.nomAffichage || !s.nomEn) continue;
        if (nomsPris.has(cle(s.nomEn))) { refuses.push({ s, motif: `« ${s.nomEn} » est déjà le nom d'affichage d'un autre de nos sets — cet extra Cardmarket ne le réserve pas` }); continue; }
        const r = essayer(s, s.nomEn, 'nomEn (repli)');
        if (r.ok) { retenus.push({ s, ...r }); nomsPris.add(cle(s.nomEn)); idsPris.set(r.id, s.code); }
        else refuses.push({ s, motif: r.motif });
    }
    // ---- PASSE 3 : le préfixe « EX » de l'ère EX ----------------------------
    // Cardmarket et nous écrivons « EX Unseen Forces », TCGdex écrit « Unseen Forces » — et rend
    // pourtant « EX Forces Cachées » en français, préfixe compris. Ce n'est donc pas une inclusion
    // déguisée (§31) mais UNE CONVENTION DE CATALOGUE : le préfixe désigne la série, pas le set.
    // ⚠️ La garde reste entière — nom non déjà pris, id non déjà pris, et les deux contrôles de
    // discriminance imprimés plus bas doivent rester à zéro. Les 15 paires sont imprimées pour
    // être RELUES (§31 : une clé se relit ligne à ligne, elle fabrique des faits qui ont l'air justes).
    const PREFIXE_EX = /^EX\s+/i;
    const passe3 = [];
    for (const s of intl) {
        if (!s.nomAffichage || !PREFIXE_EX.test(s.nomAffichage)) continue;
        if (retenus.find(r => r.s.code === s.code)) continue;
        const nu = s.nomAffichage.replace(PREFIXE_EX, '');
        if (nomsPris.has(cle(nu))) continue;
        const r = essayer(s, nu, 'nomAffichage sans le préfixe « EX »');
        if (r.ok) {
            retenus.push({ s, ...r }); nomsPris.add(cle(nu)); idsPris.set(r.id, s.code);
            passe3.push(`${String(s.code).padEnd(6)} « ${String(s.nomAffichage).padEnd(26)} » =[${String(r.id).padEnd(7)}]= « ${nu} » → « ${r.nomFr} »`);
            const i = refuses.findIndex(x => x.s.code === s.code); if (i >= 0) refuses.splice(i, 1);
        }
    }
    if (passe3.length) { console.log(`\n   ── passe 3, le préfixe « EX » retiré : ${passe3.length} paires, À RELIRE`); for (const p of passe3) console.log(`      ${p}`); }

    for (const s of intl) if (!s.nomAffichage && !s.nomEn) refuses.push({ s, motif: 'ni nomAffichage ni nomEn : rien à apparier' });

    // ---- LES CONTRÔLES, imprimés à chaque exécution --------------------------
    const parNomFr = new Map();
    for (const r of retenus) { const k = cle(r.nomFr); if (!parNomFr.has(k)) parNomFr.set(k, []); parNomFr.get(k).push(r.s.code); }
    const collisions = [...parNomFr.entries()].filter(([, l]) => l.length > 1);
    console.log(`\n   ✅ RETENUS : ${retenus.length} / ${intl.length} sets occidentaux`);
    console.log(`      par nomAffichage : ${retenus.filter(r => r.passe === 'nomAffichage').length} · par le repli sur nomEn : ${retenus.filter(r => r.passe !== 'nomAffichage').length}`);
    console.log(`      dont le nom français DIFFÈRE de l'anglais : ${retenus.filter(r => cle(r.nomFr) !== cle(r.propose)).length}`);
    console.log(`   ⚖️ un nom français par set (§26) : ${collisions.length} collision(s) ${collisions.length ? '🔴' : '✅'}`);
    for (const [, l] of collisions) console.log(`      🔴 ${l.join(' == ')}`);
    console.log(`   ⚖️ un set TCGdex par set (§34, compté sur une LISTE) : ${retenus.length - new Set(retenus.map(r => r.id)).size} doublon(s) ${retenus.length === new Set(retenus.map(r => r.id)).size ? '✅' : '🔴'}`);
    console.log(`   ⛔ REFUSÉS : ${refuses.length}, chacun avec sa cause`);

    if (montrerRefus) {
        const parCause = {};
        for (const r of refuses) {
            const c = r.motif.replace(/« [^»]* »/g, '« … »').replace(/\[[^\]]*\]/g, '[…]');
            (parCause[c] = parCause[c] || []).push(r.s.code);
        }
        console.log(`\n════ LES REFUS, PAR CAUSE ════`);
        for (const [c, l] of Object.entries(parCause).sort((a, b) => b[1].length - a[1].length))
            console.log(`   ${String(l.length).padStart(3)} — ${c}\n        ${l.join(', ')}`);
    }

    console.log(`\n════ TRENTE NOMS RETENUS ════`);
    for (const r of retenus.filter(x => cle(x.nomFr) !== cle(x.propose)).slice(0, 30))
        console.log(`   ${String(r.s.code).padEnd(8)} « ${String(r.propose).slice(0, 30).padEnd(30)} » → « ${r.nomFr} »   [${r.id}]`);

    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --ecrire)`); await fermer(); return; }

    let n = 0;
    for (const r of retenus) {
        await cx.db.collection('sets').updateOne({ _id: r.s._id }, {
            $set: {
                nomFr: r.nomFr,
                nomFrSource: 'tcgdex',
                // la PREUVE : de quel set TCGdex, par quel nom, et par quelle passe — relisible dans six mois
                nomFrPreuve: `TCGdex [${r.id}] apparié par ÉGALITÉ de ${r.passe} « ${r.propose} » ; set occidental, donc sortie française réelle`,
                nomFrLe: new Date()
            }
        });
        n++;
    }
    const relu = await cx.db.collection('sets').countDocuments({ nomFr: { $nin: [null, ''] } });
    console.log(`\n   ✅ ÉCRITS : ${n} · relu en base : ${relu} sets portent un nomFr`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
