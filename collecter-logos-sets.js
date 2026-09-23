// ============================================================
// LES LOGOS DE SETS — `sets.logo = { cleR2, w, h }`, et la LANGUE décide qui en reçoit un
// ============================================================
//   node collecter-logos-sets.js            (décide et imprime, rien d'écrit — le défaut)
//   node collecter-logos-sets.js --ecrire   (prend le verrou global, télécharge, écrit)
//
// 🔴 LE PIÈGE, MESURÉ À L'ÉCHELLE : sur 192 sets japonais qui portent un logo, **125 pointent un
// fichier suffixé « EN »** — le logo du JUMEAU INTERNATIONAL. « Rocket Gang » reçoit « Team Rocket
// Logo.png », « Gold Silver to a New World » reçoit « Neo Genesis Logo EN.png ». C'est exactement le
// piège de `nomEn` (§26) transposé aux images, et sans la règle de langue **un set japonais sur deux
// aurait affiché le logo d'un autre produit**.
//
// LA SOURCE EST LE PARAMÈTRE D'INFOBOX (`setlogo`, à défaut `logo`), jamais un fichier cité ailleurs
// sur la page : une page de set mentionne des dizaines d'images (boosters, decks, cartes vedettes), et
// en prendre une au hasard afficherait un booster comme logo. Le cas est réel : DP4d et DP4m pointent
// tous deux « DP4 Boosters.png » — ce n'est pas un logo, et ces deux-là ne reçoivent rien.
//
// LA RÈGLE DE LANGUE, par ordre de force, et chaque set écrit LA PREUVE qui l'a fait passer :
//   1. set OCCIDENTAL : le logo lui revient (Bulbapedia est un wiki anglophone ; 0 fichier suffixé
//      « JP » sur les 165 sets occidentaux à logo — vérifié, pas supposé) ;
//   2. set JAPONAIS, fichier suffixé « JP » : décisif ;
//   3. set JAPONAIS, fichier commençant par le CODE du set (« S10a Dark Phantasma Logo.png ») :
//      décisif aussi — un code japonais ne désigne aucun set occidental ;
//   4. set JAPONAIS, fichier portant le nom japonais du set (« Pokémon Card VS Logo.png ») ;
//   5. tout le reste — suffixe « EN », nom du jumeau, ou rien de reconnaissable — N'EST PAS ÉCRIT,
//      et le motif est imprimé. Un logo faux ne se signale jamais tout seul.
require('dotenv').config();
const crypto = require('crypto');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const r2 = require('./collecte-cartes/r2');
const bulba = require('./collecte-cartes/bulba');
const { gabarits } = require('./collecte-cartes/wikitext');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');

const { deciderLangue, cle, refusDuCouple, logoGenerique } = require('./collecte-cartes/langue-logo');   // la règle, une seule fois (2026-09-23)
// 🔴 L'INTERVALLE D'ATTENTE DOIT ÊTRE PLUS COURT QUE LA FENÊTRE QU'IL ATTEND — mesuré le 2026-09-20.
// Ce script a attendu le verrou global pendant des dizaines de cycles sans jamais l'obtenir, et j'ai
// d'abord lu ça comme « le worker le tient en continu ». Le champ `depuis` dit le contraire : le worker
// le REND après chaque set et le REPREND dans la seconde (`depuis` 0,9 min, un set dure ~2 min). La
// fenêtre de libération dure quelques secondes ; un sondage toutes les 30 s ne peut pas la voir.
// ⚠️ Ce n'est pas une attente, c'est une FAMINE, et elle ne se distingue d'une attente normale que par
// le nombre d'essais — donc il s'imprime. Le sondage est une lecture Mongo, pas une requête chez le
// tiers : le raccourcir ne touche à aucune promesse.
const VERROU_MS = 3 * 60 * 1000, ATTENTE_MS = 2 * 1000;

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    const M = modeles(cx);
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);

    const tous = await cx.db.collection('sets').find({}, { projection: { code: 1, region: 1, nomAffichage: 1, nomEn: 1, nomJaTraduit: 1, bulba: 1, logo: 1 } }).toArray();
    // 🔴 UN LOGO D'UNE AUTRE SOURCE N'EST PAS À CET OUTIL (2026-09-23). Il juge le paramètre `setlogo` et RETIRE le logo
    // de tout set qu'il refuse — donc il effaçait, en silence et avec un « ✍️ refus écrits » parfaitement normal, les
    // logos posés par collecter-logos-demande.js, précisément sur des sets dont il refuse le `setlogo`. Une ligne qu'un
    // outil ne sait pas refabriquer porte sa marque (`logo.source`) et cet outil ne la touche pas.
    const sets = tous.filter(s => !s.logo?.source || s.logo.source === 'bulbapedia:setlogo');
    if (tous.length > sets.length) console.log(`   (${tous.length - sets.length} sets portent un logo d'une autre source : ni jugés ni touchés ici)`);
    const avecArchive = sets.filter(s => s.bulba?.cleR2);
    console.log(`\n════ DÉNOMINATEUR : ${sets.length} sets · ${avecArchive.length} ont leur page archivée (${sets.length - avecArchive.length} sans : rien à lire) ════`);

    const retenus = [], refuses = [];
    for (const s of avecArchive) {
        let txt; try { txt = await r2.lireTexte(process.env.R2_BUCKET_BRUT, s.bulba.cleR2); } catch { refuses.push({ s, motif: 'page illisible sur R2' }); continue; }
        const box = gabarits(txt).find(g => /infobox/i.test(g.nom));
        const logo = String(box?.params?.setlogo ?? box?.params?.logo ?? '').trim().replace(/-->\s*$/, '');
        if (!logo) { refuses.push({ s, motif: 'aucun `setlogo` dans l\'infobox' }); continue; }
        const couple = refusDuCouple(logo);                           // lu à l'œil : passe avant la langue (§21 bis)
        if (couple) { refuses.push({ s, logo, motif: couple }); continue; }
        const d = deciderLangue(s, logo);
        (d.ok ? retenus : refuses).push({ s, logo, ...d });
    }
    const parMotif = {};
    for (const r of refuses) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    const parPreuve = {};
    for (const r of retenus) parPreuve[r.preuve.replace(/«[^»]*»/g, '…')] = (parPreuve[r.preuve.replace(/«[^»]*»/g, '…')] || 0) + 1;
    console.log(`   ✅ RETENUS : ${retenus.length}  (occidentaux ${retenus.filter(r => r.s.region === 'intl').length} · japonais ${retenus.filter(r => r.s.region !== 'intl').length})`);
    for (const [k, v] of Object.entries(parPreuve).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(4)} — ${k}`);
    console.log(`   🔴 REFUSÉS : ${refuses.length}`);
    for (const [k, v] of Object.entries(parMotif).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(4)} — ${k}`);
    console.log(`   dix refusés, tels quels :`);
    for (const r of refuses.filter(x => x.logo).slice(0, 10)) console.log(`      ${String(r.s.code).padEnd(9)} « ${String(r.s.nomAffichage).slice(0, 28).padEnd(28)} » → « ${r.logo} » : ${r.motif}`);

    // 🔑 PLUSIEURS SETS PARTAGENT UN LOGO, ET C'EST NORMAL : une page couvre parfois deux variantes
    // (les deux moitiés d'un demi-set, un set et ses Additionals). Le même fichier sert à chacun — on
    // ne dédoublonne donc PAS les sets, seulement les TÉLÉCHARGEMENTS.
    const fichiers = [...new Set(retenus.map(r => r.logo))];
    console.log(`\n   ${retenus.length} sets pour ${fichiers.length} fichiers distincts (un logo peut servir à plusieurs sets : demi-sets, Additionals)`);
    if (!ecrire) { console.log(`\n   (décision seule — relancer avec --ecrire pour télécharger et écrire)`); await fermer(); return; }

    // ════════════════════════════════════════════════════════════════════════════
    // 🔴 LES REFUS S'ÉCRIVENT, ET ILS S'ÉCRIVENT AVANT LES SUCCÈS — 2026-09-21
    // ════════════════════════════════════════════════════════════════════════════
    // Cet outil décidait, imprimait sa raison dans un terminal, et n'écrivait que ce qu'il retenait.
    // Résultat mesuré : **232 sets publiés sans logo, et ZÉRO motif lisible en base.** Impossible de
    // répondre à « la source a-t-elle été cherchée, ou est-elle absente ? » — la seule question que
    // le §36 pose devant une limite.
    // 🔑 UN REFUS NON ÉCRIT EST INDISTINGUABLE D'UN TRAVAIL JAMAIS FAIT. C'est le §21 n°7 (« un
    // compte qui décide et qui ne vit que dans un log n'est pas encore une mesure ») déplacé du
    // COMPTE au REFUS, et c'est pire : un compte se recalcule, un refus est une DÉCISION DATÉE, et
    // une décision qu'on ne peut pas relire ne se rouvre jamais (§23).
    // ⚠️ ILS S'ÉCRIVENT EN PREMIER, parce qu'ils ne coûtent aucune requête : si le téléchargement
    // échoue ou si le verrou n'est jamais obtenu, la base porte quand même la cause de chaque refus.
    let nRefus = 0;
    for (const r of refuses) {
        await cx.db.collection('sets').updateOne({ _id: r.s._id }, {
            $set: { logoRefus: { motif: r.motif, fichier: r.logo ?? null, le: new Date(), instrument: 'collecter-logos-sets.js', source: 'bulbapedia:setlogo' } },
            $unset: { logo: 1 }                       // un refus RETIRE un logo devenu faux : sinon la base garde un visuel que la règle d'aujourd'hui rejette
        });
        nRefus++;
    }
    // Et le PENDANT, qui manquait aussi : un set retenu ne doit pas garder le refus d'hier.
    const nNettoyes = (await cx.db.collection('sets').updateMany(
        { _id: { $in: retenus.map(r => r.s._id) }, logoRefus: { $exists: true } }, { $unset: { logoRefus: 1 } })).modifiedCount;
    console.log(`\n   ✍️  ${nRefus} refus écrits avec leur motif · ${nNettoyes} refus périmés retirés des sets désormais retenus`);
    // ⚠️ Les sets SANS page archivée n'apparaissent ni dans `retenus` ni dans `refuses` : ils n'ont
    // pas été jugés, et écrire « refusé » sur eux serait mentir. Ils portent leur propre cause.
    const codesJuges = new Set([...retenus, ...refuses].map(r => String(r.s._id)));
    const nonJuges = sets.filter(s => !codesJuges.has(String(s._id)));
    if (nonJuges.length) {
        await cx.db.collection('sets').updateMany({ _id: { $in: nonJuges.map(s => s._id) } },
            { $set: { logoRefus: { motif: 'aucune page Bulbapedia archivée : la source n\'a pas pu être interrogée', fichier: null, le: new Date(), instrument: 'collecter-logos-sets.js', source: 'bulbapedia:setlogo' } } });
        console.log(`   ✍️  ${nonJuges.length} sets sans page archivée marqués « jamais interrogés » — « pas cherché » et « absent » ne sont pas la même phrase (§36)`);
    }

    // ---- le verrou global : on frappe Bulbapedia, donc la promesse s'applique (§17) ----
    let arret = false;
    const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: VERROU_MS, surInsertion: { phase: 'logos' }, surPerte: () => { arret = true; }, nom: 'verrou global bulbapedia (logos)' });
    for (let essai = 0; ; essai++) {
        const tenu = await verrou.prendre();
        if (!tenu) { if (essai) console.log(`   verrou obtenu au bout de ${essai} essais (${(essai * ATTENTE_MS / 60000).toFixed(1)} min d'attente).`); break; }
        if (essai === 0) console.log(`⏳ verrou global tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s) — j'attends, ${ATTENTE_MS / 1000} s entre deux essais.`);
        else if (essai % 60 === 0) console.log(`   ⏳ toujours pas obtenu après ${essai} essais (${(essai * ATTENTE_MS / 60000).toFixed(1)} min) — détenteur pid ${tenu.pid}, pris depuis ${tenu.ageS} s.`);
        await new Promise(r => setTimeout(r, ATTENTE_MS));
    }
    console.log(`🔒 verrou global pris.`);
    try {
        const infos = await bulba.imageinfoDe(fichiers.map(f => `File:${f}`));
        let n = 0, sans = 0;
        const objets = new Map();
        for (const f of fichiers) {
            if (arret) break;
            const info = infos.get(`File:${f}`);
            if (!info?.url) { sans++; console.warn(`   ⚠️ ${f} : aucune imageinfo`); continue; }
            const ext = (info.mime || '').split('/')[1] || 'png';
            const cleObjet = `bulbapedia/logos/${cle(f)}.${ext}`;
            if (!await r2.existe(process.env.R2_BUCKET_IMAGES, cleObjet)) {
                // ⚠️ `bulba.telecharger` rend `{ buffer, type }`, PAS un Buffer. Passer l'objet entier en
                // `Body` fait lever le SDK S3 « Unable to calculate hash for flowing readable stream » —
                // 25 minutes d'attente du verrou perdues sur une destructuration manquante, le 2026-09-20.
                // Les deux autres appelants du dépôt le déstructurent ; celui-ci était le seul à ne pas le
                // faire (§21 bis : la même règle à deux endroits diverge toujours).
                const { buffer } = await bulba.telecharger(info.url);
                // le sha1 de l'API contre celui des octets reçus : un fichier remplacé entre l'imageinfo
                // et le téléchargement se verrait ici, et nulle part ailleurs.
                const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
                if (info.sha1 && sha1 !== info.sha1) { console.warn(`   ⚠️ ${f} : sha1 ${sha1} ≠ imageinfo ${info.sha1} — non déposé`); sans++; continue; }
                await r2.deposerBinaire(process.env.R2_BUCKET_IMAGES, cleObjet, buffer, info.mime);
            }
            objets.set(f, { cleR2: cleObjet, w: info.width ?? null, h: info.height ?? null, urlOriginal: info.url, sha1: info.sha1 ?? null });
            n++;
        }
        let ecrits = 0, sansFichier = 0;
        for (const r of retenus) {
            const o = objets.get(r.logo);
            // 🔴 UN SET RETENU DONT LE FICHIER NE SE TÉLÉCHARGE PAS TOMBAIT ENTRE LES DEUX ÉCRITURES :
            // son `logoRefus` venait d'être retiré (il est retenu) et aucun `logo` ne le remplace —
            // il finissait sans logo ET SANS CAUSE, c'est-à-dire exactement l'état qu'on vient de
            // supprimer partout ailleurs. Mesuré le 2026-09-21 : 3 sets publiés (CBB2C, CSM2.1C,
            // MCD12), dont les fichiers n'ont aucune `imageinfo` chez Bulbagarden.
            // 🔑 Une décision a TROIS issues, pas deux — retenu, refusé, et « retenu mais
            // irréalisable » — et c'est toujours la troisième qui n'est écrite nulle part.
            if (!o) {
                sansFichier++;
                await cx.db.collection('sets').updateOne({ _id: r.s._id }, {
                    $set: { logoRefus: { motif: `le fichier « ${r.logo} » est nommé par l'infobox mais introuvable chez Bulbagarden (aucune imageinfo)`, fichier: r.logo, le: new Date(), instrument: 'collecter-logos-sets.js', source: 'bulbapedia:setlogo' } }
                });
                continue;
            }
            const gen = logoGenerique(o.sha1);
            await cx.db.collection('sets').updateOne({ _id: r.s._id }, { $set: { logo: { ...o, fichier: r.logo, source: 'bulbapedia:setlogo', preuve: r.preuve, le: new Date() }, logoGenerique: !!gen, ...(gen ? { logoGeneriquePreuve: gen } : {}) }, ...(gen ? {} : { $unset: { logoGeneriquePreuve: 1 } }) });
            ecrits++;
        }
        if (sansFichier) console.log(`   ✍️  ${sansFichier} set(s) retenu(s) dont le FICHIER est introuvable — cause écrite, pas laissée vide`);
        const relu = await cx.db.collection('sets').countDocuments({ 'logo.cleR2': { $nin: [null, ''] } });
        console.log(`\n   TÉLÉCHARGÉS : ${n} fichiers (${sans} sans imageinfo) · ÉCRITS : ${ecrits} sets · relu en base : ${relu} sets portent un logo`);
    } finally { await verrou.rendre(); console.log(`🔓 verrou rendu.`); }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
