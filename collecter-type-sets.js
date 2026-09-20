// ============================================================
// LE TYPE D'UN SET — `sets.type` = extension | deck | promo, depuis l'infobox, avec sa preuve
// ============================================================
//   node collecter-type-sets.js            (mesure seule, c'est le défaut)
//   node collecter-type-sets.js --ecrire
//
// La demande du site : distinguer extension / deck / coffret, parce qu'il en est réduit à deviner au
// nom — 36 decks reconnus sur 47 ambigus. L'information existe bien à la source, et elle coûte
// ZÉRO requête : elle est déjà dans les wikitexts archivés.
//
// 🔴 MAIS ELLE N'EST PAS OÙ ON LA CHERCHE, ET LE PREMIER INSTRUMENT S'EST TROMPÉ.
// Il n'existe AUCUN paramètre `type` sur une page de set : énuméré, 0 sur 463. Ce qui porte
// l'information, c'est le NOM DU GABARIT — trois seulement, et leur répartition est nette :
// TCGExpansionInfobox 309 · TCGPromoInfobox 104 · DeckInfobox 49, et pas une page n'en porte deux.
//
// 🔴 ET « TCGPromoInfobox » NE VEUT PAS DIRE « PROMO ». C'est le piège, et il coûtait 104 sets mal
// étiquetés. VMAX Climax (285 cartes), Tag All Stars (226), MEGA Dream ex (250) le portent : ce sont
// des extensions. Le gabarit distingue en réalité le nombre de SORTIES RÉGIONALES —
// `TCGExpansionInfobox` a `encards` ET `jacards` (deux régions), `TCGPromoInfobox` a `cards` seul.
// ⚠️ Un compte élevé sur une invariante qu'on vient d'écrire ressemble à une découverte (§32 bis) :
// 92 « désaccords » avec la devinette du site avaient l'air de prouver que l'infobox avait raison.
// Ce qui l'a arrêté est d'avoir OUVERT TROIS LIGNES (§22) — la page de VMAX Climax, pas son compteur.
//
// 🔑 LE DISCRIMINANT MESURÉ EST `period` CONTRE `date`, et il se lit sur les 104 pages :
//   · `period` (une FENÊTRE de distribution) → Black Star Promos, POP Series, « … Promotional cards »,
//     McDonald's. Ce sont des promos.
//   · `date` (une sortie unique) → High Class Pack, 強化拡張パック, コンセプトパック, 强化包. Ce sont des extensions.
// ⚠️ CE N'EST PAS PARFAIT ET LE RÉSIDU EST NOMMÉ, pas lissé : `s8a-P` s'appelle « Promo Card Pack »
// et porte `date` — il sera dit « extension ». `MCRP` (pack aléatoire de cinéma) aussi. Deux lignes
// sur 104, écrites ici pour qu'on les retrouve plutôt que découvertes dans six mois (§23).
//
// 🕳️ « COFFRET » N'EXISTE PAS À LA SOURCE, et c'est un refus, pas un oubli. Bulbapedia n'a que trois
// gabarits ; un coffret y est décrit par DeckInfobox comme un deck (`25th Anniversary Golden Box`,
// `Extra Regulation Box`, `Zacian Zamazenta BOX`). Le champ rend donc TROIS valeurs, pas celles
// demandées : inventer un quatrième type depuis le nom serait exactement la devinette qu'on remplace.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const { gabarits, plat } = require('./collecte-cartes/wikitext');

const norm = n => String(n || '').toLowerCase().replace(/\s+/g, '');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);

    const sets = await cx.db.collection('sets').find({}, {
        projection: { code: 1, region: 1, nomAffichage: 1, nomEn: 1, bulba: 1 }
    }).toArray();
    console.log(`\n════ DÉNOMINATEUR : ${sets.length} sets · ${sets.filter(s => s.bulba?.cleR2).length} avec un wikitext archivé ════`);

    const retenus = [], sans = [];
    for (const s of sets) {
        if (!s.bulba?.cleR2) { sans.push({ s, motif: 'aucune page Bulbapedia archivée' }); continue; }
        let txt; try { txt = await r2.lireTexte(process.env.R2_BUCKET_BRUT, s.bulba.cleR2); }
        catch { sans.push({ s, motif: 'page illisible sur R2' }); continue; }
        const gs = gabarits(txt);
        const exp = gs.find(g => norm(g.nom) === 'tcgexpansioninfobox');
        const promo = gs.find(g => norm(g.nom) === 'tcgpromoinfobox');
        const deck = gs.find(g => norm(g.nom) === 'deckinfobox');
        if (deck) retenus.push({ s, type: 'deck', preuve: 'la page porte DeckInfobox' });
        else if (exp) retenus.push({ s, type: 'extension', preuve: 'la page porte TCGExpansionInfobox (sortie japonaise ET occidentale)' });
        else if (promo) {
            const p = promo.params || {};
            if (p.period) retenus.push({ s, type: 'promo', preuve: `TCGPromoInfobox avec period = « ${String(plat(p.period)).slice(0, 40)} » : une FENÊTRE de distribution, pas une sortie` });
            else retenus.push({ s, type: 'extension', preuve: `TCGPromoInfobox avec date = « ${String(plat(p.date)).slice(0, 40)} » : une sortie unique, mono-région` });
        }
        else sans.push({ s, motif: 'aucune des trois infoboxes de set' });
    }

    const parType = {};
    for (const r of retenus) parType[r.type] = (parType[r.type] || 0) + 1;
    console.log(`\n   ✅ TYPÉS : ${retenus.length} / ${sets.length} = ${(100 * retenus.length / sets.length).toFixed(1)} %`);
    for (const [t, n] of Object.entries(parType).sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(4)}  ${t}`);
    console.log(`   ⛔ NON TYPÉS : ${sans.length}`);
    const parMotif = {};
    for (const x of sans) (parMotif[x.motif] = parMotif[x.motif] || []).push(x.s.code);
    for (const [m, l] of Object.entries(parMotif).sort((a, b) => b[1].length - a[1].length))
        console.log(`      ${String(l.length).padStart(4)}  ${m}\n            ${l.slice(0, 18).join(', ')}${l.length > 18 ? ' …' : ''}`);

    // ⚖️ le contrôle qui compte : ce que le TYPE change par rapport à la devinette au nom
    const AU_NOM = /\b(deck|kit|starter|battle academy)\b/i;
    const devine = retenus.filter(r => AU_NOM.test(r.s.nomAffichage || r.s.nomEn || ''));
    const vraisDecks = retenus.filter(r => r.type === 'deck');
    const devineJustes = devine.filter(r => r.type === 'deck');
    console.log(`\n   ⚖️ CONTRE LA DEVINETTE AU NOM (ce que fait le site aujourd'hui) :`);
    console.log(`      le nom dit « deck » sur ${devine.length} sets, dont ${devineJustes.length} en sont vraiment — ${devine.length - devineJustes.length} FAUX POSITIFS`);
    console.log(`      decks réels : ${vraisDecks.length}, dont ${vraisDecks.length - devineJustes.length} que le nom NE VOIT PAS`);
    for (const r of vraisDecks.filter(x => !AU_NOM.test(x.s.nomAffichage || x.s.nomEn || '')).slice(0, 14))
        console.log(`         invisible au nom : ${String(r.s.code).padEnd(8)} « ${r.s.nomAffichage || r.s.nomEn} »`);

    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --ecrire)`); await fermer(); return; }
    let n = 0;
    for (const r of retenus) {
        await cx.db.collection('sets').updateOne({ _id: r.s._id }, {
            $set: { type: r.type, typeSource: 'bulbapedia:infobox', typePreuve: r.preuve, typeLe: new Date() }
        });
        n++;
    }
    const relu = await cx.db.collection('sets').countDocuments({ type: { $nin: [null, ''] } });
    console.log(`\n   ✅ ÉCRITS : ${n} · relu en base : ${relu} sets portent un type`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
