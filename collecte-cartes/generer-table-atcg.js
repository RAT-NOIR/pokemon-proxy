// ============================================================
// LES LIGNES CHINOISES — la route « (ATCG) », appariée par le CODE et non par le nom
// ============================================================
//   node collecte-cartes/generer-table-atcg.js              (mesure seule, c'est le défaut)
//   node collecte-cartes/generer-table-atcg.js --ecrire
//   node collecte-cartes/generer-table-atcg.js --cache=<dossier>   (zéro requête, relecture)
//
// 🔴 POURQUOI CE GÉNÉRATEUR EXISTE : LES DEUX AUTRES EXCLUENT LE CHINOIS PAR UN FILTRE.
// `generer-table-auto.js` a `langueAsiatique()`, `generer-table-sans-page.js` a
// `!/chinois|asiatique/.test(u.famille)`. Les deux ont été écrits quand le §28 disait « le chinois est
// irréductible ». Le §28 est tombé le 2026-09-20 : la route « (ATCG) » est ouverte depuis le
// 2026-09-15 et produit 5 675 fiches à 92,8 %. **Les filtres, eux, sont restés** — et 49 expansions
// chinoises, 4 168 produits, n'ont jamais reçu ne serait-ce qu'une ligne CANDIDATE.
// ⚠️ C'est la forme du §23 : quand une règle change, les décisions prises sous l'ancienne ne se
// réévaluent pas toutes seules. Ici la « décision » était un filtre de génération, donc invisible :
// une expansion sans ligne ne réclame rien.
//
// 🔑 ET LA CLÉ N'EST PAS LE NOM — MESURÉ À 0 PAIRE SUR 49. Cardmarket et Bulbapedia traduisent
// chacun le chinois de leur côté, et le résultat ne se ressemble pas :
//     « Collect 151 »       ↔ « Collection 151 »
//     « Brilliant Fantasy » ↔ « Sparkling Fable »
//     « Eternal Birth »     ↔ « Ancient Times, Future Progress »
//     « Dark Crystal Blaze »↔ « Ardent Obsidian »
// L'égalité des noms rend ZÉRO. ⚠️ Et une clé plus souple serait exactement le §31 : « Vivid
// Portrayals Obsidian » ET « Vivid Portrayals Indigo » contiennent tous deux « Vivid Portrayals »,
// donc l'inclusion apparierait les deux au même set et l'un des deux serait faux.
//
// ✅ LE DISCRIMINANT EST LE CODE, PARCE QU'UN CODE NE SE TRADUIT PAS. Bulbapedia l'écrit dans
// `alt=` (« alt = CSV6 »), dans le nom du logo (« CSV10 Logo SC.png »), dans celui du symbole
// (« SetSymbolCS21.png »), et pour les sous-sets EN TOUTES LETTRES dans le corps du texte
// (« The Obsidian subset was assigned expansion mark CS2a »).
// 🔴 Et Cardmarket suffixe ses codes d'un « C » que Bulbapedia n'écrit pas : `CSV6C` contre `CSV6`.
// Ma première sonde cherchait `CS…C` — l'orthographe de l'AUTRE source — et rendait « AUCUN code ».
// C'est le motif dominant du chantier, une fois de plus : l'outil cherchait ce que la source n'écrit
// pas, et son vide avait l'air d'une absence.
//
// ✅ LES PAGES À DEUX SOUS-SETS SONT CADRÉES, PAS DEVINÉES. Quatre pages portent DEUX expansions
// Cardmarket (CS2a/CS2b, CS4a/CS4b, CS5a/CS5b, CS6a/CS6b — 1 342 produits), et trois d'entre elles
// RENUMÉROTENT chaque moitié de 1 à N : « Vivid Portrayals » a 286 entrées pour 143 numéros
// distincts. Une ligne non cadrée réclamerait toute la Setlist et joindrait la moitié de ses
// produits à la mauvaise carte — les 14 produits à deux cartes du §34, à l'échelle.
// 🔑 La Setlist les sépare, et son en-tête porte le code : `{{Setlist/header|title=Obsidian|…
// |image=SetSymbolCS2a.png}}`. Le couple section↔code est donc LU sur la page, jamais deviné, et le
// cadrage utilise `bulba.setlist`, le mécanisme déjà éprouvé par xWHT/xBLK sur leur page commune.
//
// Débit : Bulbapedia, 1 requête / 5 s via bulba.js, sous le verrou global `bulbapedia/__collecteur__`.
// Production : LECTURE SEULE. Une ligne générée porte `verifie: null` — c'est verifier-table.js qui admet.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const bulba = require('./bulba');
const { ouvrirConnexions } = require('./garde');
const { fabriquerVerrou } = require('./verrou-source');
const { modeles } = require('./schemas');
// 🔴 `TABLE_MAIN`, PAS `TABLE` — ET LA DIFFÉRENCE A COÛTÉ UN PASSAGE. `table-sets.js` fait
// `TABLE.push(...TABLE_AUTO.filter(l => l.verifie))` : `TABLE` n'est donc PAS la table à la main,
// c'est la table à la main PLUS les lignes automatiques ADMISES. Construire « ce qui est déjà
// pourvu » dessus réintègre les lignes que ce générateur vient d'écrire — et il n'en régénère plus
// que les REFUSÉES, en leur réattribuant au passage un code suffixé. `TABLE_MAIN` est la vraie
// table à la main. ⚠️ `generer-table-sans-page.js` se protège du même piège avec son propre
// marqueur, et son commentaire le dit ; je ne l'avais pas transposé (§21 bis).
const { TABLE_MAIN, TABLE_AUTO, TABLE_SANS_PAGE, FICHIER_AUTO } = require('./table-sets');
const { entreesDeLaSetlist } = require('./wikitext');
const { cleNumero, numeroDeSetlist, jetonsDeSetlist } = require('./jointure');
const UNIVERS = require('./univers-expansions.json');

const SUFFIXES = /\((ATCG|SCTCG|TCTCG)\)$/;
const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };

/** Le code Cardmarket ramené à l'écriture de Bulbapedia : « CSV6C » → « CSV6 », « CS2.1C » → « CS21 ». */
const codeNu = c => String(c || '').replace(/C$/, '').replace(/\./g, '').toUpperCase();
/** Un code plausible de set chinois — et le motif est FERMÉ, pour qu'un jeton quelconque ne passe pas. */
const estCode = k => /^(CS|CBB)[A-Z0-9]{1,6}$/.test(k);

/** Les codes qu'une page porte, avec la PROVENANCE de chacun : une preuve dit d'où elle sort. */
function codesDeLaPage(wt) {
    const t = new Map();
    const pose = (c, dou) => { const k = codeNu(c); if (estCode(k) && !t.has(k)) t.set(k, dou); };
    for (const m of wt.matchAll(/^\s*\|\s*alt\s*=\s*([^\n|}]+)/gim)) pose(m[1].trim(), 'infobox alt=');
    for (const m of wt.matchAll(/^\s*\|\s*set(?:logo|symbol)?\s*=\s*([A-Za-z0-9.]+)\s+[Ll]ogo/gim)) pose(m[1].trim(), 'nom du fichier de logo');
    for (const m of wt.matchAll(/^\s*\|\s*(?:image|logo)\s*=\s*(?:SetSymbol)?([A-Za-z0-9.]+?)[ _.]/gim)) pose(m[1].trim(), 'nom du fichier de symbole');
    for (const m of wt.matchAll(/expansion mark\s+([A-Za-z0-9.]+)/gi)) pose(m[1].trim(), 'texte « expansion mark »');
    return t;
}

/** Les sections de Setlist d'une page : { titre, code|null } — le code est lu dans l'image de l'en-tête. */
function sectionsDeLaPage(wt) {
    const out = [];
    for (const m of wt.matchAll(/\{\{Setlist\/header\|([^\n]*)/g)) {
        const champs = m[1];
        const titre = (champs.match(/title=([^|}]+)/) || [])[1]?.trim() || null;
        const img = (champs.match(/image=SetSymbol([A-Za-z0-9.]+?)\.(?:png|jpg)/i) || [])[1];
        out.push({ titre, code: img ? codeNu(img) : null });
    }
    return out;
}

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const cache = arg('cache');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });

    // ── LES PAGES : énumérées, pas cherchées (§30)
    // ⚠️ `intitle:ATCG` seul aurait manqué les pages en (SCTCG) et (TCTCG) — trouvées parce qu'une
    // SECONDE énumération, par le texte, les a fait apparaître. Une seule requête ciblée sur un
    // suffixe deviné rend le même vide qu'une absence, et c'est exactement le §30.
    let wikis;
    const fCache = cache ? path.join(cache, 'atcg-wikitext.json') : null;
    if (fCache && fs.existsSync(fCache)) {
        wikis = JSON.parse(fs.readFileSync(fCache, 'utf8'));
        console.log(`CACHE ${cache} : ${wikis.length} wikitexts — ZÉRO requête`);
    } else {
        const verrou = fabriquerVerrou({ Modele: modeles(cx).EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: 3 * 60 * 1000, surInsertion: { phase: 'collecteur' }, nom: 'verrou global bulbapedia (génération ATCG)' });
        const tenu = await verrou.prendre();
        if (tenu) { console.error(`❌ ARRÊT : verrou bulbapedia tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s).`); await fermer(); process.exit(1); }
        try {
            const titres = new Set();
            for (const [quoi, srsearch] of [['titre', 'intitle:ATCG'], ['texte', 'insource:"{{ATCG|"']]) {
                let off = 0;
                for (let tour = 0; tour < 12; tour++) {
                    const d = await bulba.api({ action: 'query', list: 'search', srsearch, srlimit: 500, sroffset: off, srnamespace: 0 });
                    for (const p of d.query?.search || []) if (SUFFIXES.test(p.title)) titres.add(p.title);
                    if (!d.continue?.sroffset) break;
                    off = d.continue.sroffset;
                }
                console.log(`   énumération par le ${quoi} : ${titres.size} titres cumulés`);
            }
            const r = await bulba.revisionsDe([...titres]);
            wikis = r.pages.map(p => ({ titre: p.title, wt: p.content }));
            if (cache) { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(fCache, JSON.stringify(wikis)); }
            console.log(`   ${wikis.length} wikitexts · ${r.manquantes.length} manquantes · requêtes ${bulba.compteRequetes()}`);
        } finally { await verrou.rendre(); }
    }

    const parCode = new Map();
    for (const { titre, wt } of wikis)
        for (const [k, dou] of codesDeLaPage(wt)) (parCode.get(k) || parCode.set(k, []).get(k)).push({ titre, dou, wt });
    console.log(`DÉNOMINATEUR Bulbapedia : ${wikis.length} pages chinoises · ${parCode.size} codes distincts lus`);

    // ── LES EXPANSIONS CHINOISES SANS LIGNE
    // 🔴 L'OUTIL NE DOIT PAS SE RELIRE. `TABLE_AUTO` contient désormais les lignes qu'il a lui-même
    // écrites : les compter comme « déjà pourvues » le rendrait inerte au lancement suivant — il
    // n'aurait plus jamais rien à dire, sans une erreur, et un contrôle ajouté ici ne s'appliquerait
    // jamais aux lignes existantes. Ses propres lignes sont donc RÉGÉNÉRABLES, et leurs verdicts
    // repris plus bas.
    const mienne = l => /^atcg-code-/.test(l.auto?.cle || '');
    const autres = TABLE_AUTO.filter(l => !mienne(l));
    const avecLigne = new Set([...TABLE_MAIN, ...autres, ...TABLE_SANS_PAGE].map(l => l.exp).filter(Boolean));
    // Compté sur le CATALOGUE (2026-09-25) : `numeros_cartes.idExpansion` est absent sur 367 produits de septembre — Chasing Glory
    // Together comptait 0 et ne pouvait pas devenir candidate (même défaut que produitsDeLExpansion, jointure.js).
    const compte = new Map((await prod.db.collection('catalogue_produits').aggregate([
        { $match: { idExpansion: { $ne: null } } }, { $group: { _id: '$idExpansion', n: { $sum: 1 } } }]).toArray()).map(x => [x._id, x.n]));
    const cibles = UNIVERS
        .filter(u => (u.famille === 'chinois-simplifie' || u.famille === 'autre-asiatique') && !avecLigne.has(u.exp) && u.slugSet && compte.get(u.exp))
        .sort((a, b) => (compte.get(b.exp) || 0) - (compte.get(a.exp) || 0));
    console.log(`DÉNOMINATEUR Cardmarket : ${cibles.length} expansions chinoises sans ligne · ${cibles.reduce((s, u) => s + (compte.get(u.exp) || 0), 0)} produits\n`);

    // Les codes déjà pris par les AUTRES lignes : les siennes n'en font pas partie, sinon une
    // régénération renommerait chaque ligne en « CODE-<exp> » à chaque passage.
    const codesPris = new Set([...TABLE_MAIN, ...autres, ...TABLE_SANS_PAGE].map(l => l.code));
    const lignes = [], restes = [];
    for (const u of cibles) {
        const k = codeNu(u.codeSet);
        const cands = parCode.get(k) || [];
        if (cands.length !== 1) {
            restes.push({ u, k, pourquoi: cands.length ? `🔴 AMBIGU : ${cands.length} pages portent « ${k} »` : `aucune page ne porte le code « ${k} »` });
            continue;
        }
        const { titre, dou, wt } = cands[0];
        const nomPage = titre.replace(/\s*\((ATCG|SCTCG|TCTCG)\)$/, '');
        // 🔑 LE CADRAGE SE LIT SUR LA PAGE. Une section dont l'en-tête porte NOTRE code est LA section de
        // cette expansion ; s'il n'y en a qu'une en tout, elle vaut pour la page entière. Sans l'une ni
        // l'autre, on laisse `setlist` absent — le défaut (le nom d'expansion) reprend la main.
        const sections = sectionsDeLaPage(wt);
        const mienne = sections.find(s => s.code === k && s.titre);
        const setlist = mienne ? [mienne.titre]
            : (sections.length === 1 && sections[0].titre ? [sections[0].titre] : null);
        const cadrage = mienne ? `section « ${mienne.titre} », reconnue par son en-tête « image=SetSymbol${k} »`
            : sections.length === 1 ? `section unique « ${sections[0].titre} »`
                : `AUCUN cadrage : ${sections.length} sections, aucune ne porte le code`;
        let code = u.codeSet || `X${u.exp}`;
        if (codesPris.has(code)) code = `${code}-${u.exp}`;
        codesPris.add(code);
        // ⚠️ `numerosAmbigus` — LE CONTRÔLE QUE LA COUVERTURE NE PEUT PAS FAIRE (§34). Un `Set` écrase les
        // doublons AVANT toute comparaison : « 143/143 = 100 % dans les deux sens » ne dit RIEN sur le fait
        // qu'un numéro désigne deux cartes. Sur ces pages-ci le risque est réel et nommé — quatre d'entre
        // elles portent deux moitiés renumérotées chacune de 1 à N. On compte donc les MULTIPLICITÉS, avec
        // les fonctions du collecteur et non une réécriture (le motif dominant du chantier).
        const bulba0 = { titre, tirage: /\(TCTCG\)$/.test(titre) ? 'zh-hant' : 'zh-hans', expansion: nomPage, numerosDepuisSetlist: true, ...(setlist ? { setlist } : {}) };
        const entrees = entreesDeLaSetlist(wt, bulba0).entrees;
        const jetons = jetonsDeSetlist(entrees, [].concat(bulba0.expansion, bulba0.setlist || []));
        const parNum = new Map();
        for (const e of entrees) {
            const n = numeroDeSetlist(e, jetons);
            if (n == null) continue;
            (parNum.get(cleNumero(n)) || parNum.set(cleNumero(n), new Set()).get(cleNumero(n))).add(e.titre);
        }
        const ambigus = [...parNum.entries()].filter(([, s]) => s.size > 1).map(([n]) => n);
        lignes.push({
            code, exp: u.exp, prod: compte.get(u.exp), nom: nomPage, slugSet: u.slugSet, region: 'chinois',
            bulba: bulba0,
            attendu: compte.get(u.exp),
            controle: { entreesSection: entrees.length, numerosSetlist: parNum.size, numerosAmbigus: ambigus.length, exemplesAmbigus: ambigus.slice(0, 5), le: new Date().toISOString().slice(0, 10) },
            auto: {
                cle: `atcg-code-${new Date().toISOString().slice(0, 10)}`,
                liste: 'énumération Bulbapedia (intitle:ATCG + insource:{{ATCG|), suffixes ATCG/SCTCG/TCTCG',
                nomBulbapedia: nomPage, familleUnivers: u.famille, genereLe: new Date().toISOString().slice(0, 10),
                // 🔴 SANS CE MARQUEUR, LA PROCHAINE RÉGÉNÉRATION LES EFFACE EN SILENCE.
                // `generer-table-auto.js` ne reprend du fichier précédent que les lignes `auto.aLaMain` —
                // et il EXCLUT le chinois, donc il ne les refabriquerait pas. C'est la forme du §21 :
                // aucune erreur, un résultat plausible, du travail disparu.
                aLaMain: `route « (ATCG) » : appariée par le CODE de set (${u.codeSet} → ${k}, lu dans ${dou}), le NOM ne peut pas servir — les deux sources traduisent le chinois indépendamment. ${cadrage}.`
            },
            verifie: null
        });
    }

    // 🔑 IMPRIMER AVANT D'ÉCRIRE, ET LIRE LIGNE À LIGNE (§31).
    // ⚠️ LA MAJORITÉ DES NUMÉROS DOUBLÉS N'EST PAS UN SEUIL DE RÉGLAGE, C'EST UN CONSTAT DE STRUCTURE
    // (§34) : si la plupart des numéros de la section désignent deux cartes, le cadrage n'a pas
    // fonctionné et le nom couvre PLUSIEURS numérotations. Une collision ISOLÉE, elle, ne referme
    // pas la ligne — elle coûterait des dizaines de produits justes pour un faux — elle s'ÉCRIT.
    for (const l of lignes)
        if (l.controle.numerosAmbigus > l.controle.numerosSetlist / 2)
            l.refus = `${l.controle.numerosAmbigus} des ${l.controle.numerosSetlist} numéros de la section désignent PLUSIEURS cartes : le cadrage ne sépare pas les moitiés de cette page (§34).`;

    console.log(`── ${lignes.length} LIGNES CANDIDATES (${lignes.reduce((s, l) => s + l.prod, 0)} produits) · ${lignes.filter(l => l.controle.numerosAmbigus).length} portent au moins un numéro ambigu`);
    for (const l of lignes)
        console.log(`   ${String(l.prod).padStart(4)} p · ${l.code.padEnd(10)} ${String(l.slugSet).slice(0, 36).padEnd(36)} → « ${l.bulba.titre} »${l.bulba.setlist ? ` [section « ${l.bulba.setlist[0]} »]` : ' [page entière]'} · ${l.controle.numerosSetlist} n° ${l.controle.numerosAmbigus ? `· 🔴 ${l.controle.numerosAmbigus} AMBIGU(S) : ${l.controle.exemplesAmbigus.join(',')}` : '· ✅ 0 ambigu'}${l.refus ? ` · REFUSÉE` : ''}`);
    console.log(`\n── ${restes.length} SANS PAIRE (${restes.reduce((s, r) => s + (compte.get(r.u.exp) || 0), 0)} produits) — listés avec leur cause, jamais résolus au fil`);
    for (const r of restes)
        console.log(`   ${String(compte.get(r.u.exp) || 0).padStart(4)} p · ${String(r.u.codeSet).padEnd(10)} ${String(r.u.slugSet).slice(0, 40).padEnd(40)} — ${r.pourquoi}`);

    // ⚠️ ET LES LIGNES CHINOISES DÉJÀ VÉRIFIÉES PORTENT LE MÊME MARQUEUR, pour la même raison.
    let marquees = 0;
    for (const l of TABLE_AUTO) {
        if (!/\((ATCG|SCTCG|TCTCG)\)$/.test(l.bulba?.titre || '') || l.auto?.aLaMain) continue;
        l.auto = { ...(l.auto || {}), aLaMain: `route « (ATCG) » — ligne du ${l.auto?.genereLe ?? '2026-09-15'}, à conserver : le générateur automatique exclut le chinois et ne la refabriquerait pas.` };
        marquees++;
    }
    console.log(`\n   lignes chinoises ANCIENNES nouvellement protégées d'une régénération : ${marquees}`);

    // 🔴 ET UNE RÉGÉNÉRATION NE PERD PAS UNE VÉRIFICATION (§23). Sans cette reprise, relancer ce
    // générateur remettrait `verifie: null` sur des lignes admises la veille — donc rejouerait les
    // requêtes, et surtout ANNULERAIT en silence des admissions qui avaient coûté une mesure.
    // Même geste que `generer-table-auto.js`, et pour la même raison : reprise si l'`exp` ET la page
    // sont identiques, jamais sinon — une ligne qui change de page doit être rejugée.
    const avant = new Map(TABLE_AUTO.map(l => [l.exp, l]));
    let reprises = 0;
    for (const l of lignes) {
        const p = avant.get(l.exp);
        if (p && p.bulba?.titre === l.bulba.titre && p.verif) { l.verif = p.verif; l.verifie = p.verifie ?? null; reprises++; }
    }
    if (reprises) console.log(`   vérifications reprises du fichier précédent : ${reprises}`);

    // 🔴 UNE RÉGÉNÉRATION AJOUTE, ELLE NE REMPLACE PAS (2026-09-25, la règle du §59 pour generer-table-auto.js, ici oubliée —
    // §21 bis). La fusion REMPLAÇAIT toute ligne de même expansion par sa version régénérée : les Happy Sets et Battle Party
    // calés à la main la nuit du 24 (préfixes par liste mesurés, `prefixesParJeton`) seraient redevenus « section Happy Set »
    // seule, en gardant leur admission — une recollecte aurait alors perdu trois listes sur quatre. Une ligne existante n'est
    // jamais réécrite ici ; si sa version régénérée diffère, elle est IMPRIMÉE, à relire à la main.
    const existantes = new Map(TABLE_AUTO.map(l => [l.exp, l]));
    const differentes = lignes.filter(n => existantes.has(n.exp) && JSON.stringify(existantes.get(n.exp).bulba) !== JSON.stringify(n.bulba));
    for (const n of differentes) console.log(`   ⚠️ ${n.code} : la ligne existante diffère de sa version régénérée — GARDÉE telle quelle (existante ${JSON.stringify(existantes.get(n.exp).bulba).slice(0, 120)} · régénérée ${JSON.stringify(n.bulba).slice(0, 120)})`);
    const neuves = lignes.filter(n => !existantes.has(n.exp));
    console.log(`   lignes NEUVES (expansion sans ligne) : ${neuves.length} ${neuves.map(n => n.code).join(' ')} · existantes gardées : ${lignes.length - neuves.length}`);
    if (ecrire) {
        const fusion = [...TABLE_AUTO, ...neuves];
        fs.writeFileSync(FICHIER_AUTO, JSON.stringify(fusion, null, 1));
        console.log(`   ÉCRIT : ${path.relative(process.cwd(), FICHIER_AUTO)} — ${fusion.length} lignes (${TABLE_AUTO.length} + ${neuves.length})`);
    } else console.log(`\n   (mesure seule — relancer avec --ecrire)`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
