// ============================================================
// LE BANC JAPONAIS — le taux, point de correctif par point de correctif
// ============================================================
// POURQUOI IL EXISTE. Pendant tout ce chantier, la seule mesure disponible était
// « environ deux tiers », c'est-à-dire une impression. Ce banc est la première mesure :
// 38 cartes RÉELLES scannées par les testeurs, dont la bonne réponse a été vérifiée une
// par une sur les fiches Cardmarket. Il répond à la question qu'aucun test unitaire ne
// pose : sur des annonces vraies, combien de fois l'outil se trompe.
//
// IL SÉPARE DEUX TAUX QUE TOUT LE MONDE CONFOND :
//   - taux de LECTURE  : l'IA a-t-elle lu la bonne carte ?
//   - taux d'IDENTIFICATION : la lecture étant bonne, la chaîne a-t-elle trouvé le produit ?
// Sans cette séparation, les deux se compensent et on optimise à l'aveugle.
//
// COMMENT L'« APRÈS » EST CALCULÉ. Rejouer /api/identifier de bout en bout est impossible :
// il faudrait les photos d'annonces disparues et un appel IA payant. On fait donc l'exact
// plutôt que l'approché — les correctifs mesurés ici (chemin par le code, veto par le nom,
// égalité parfaite) AJOUTENT des décisions en tête et en fin de chaîne sans modifier les
// branches intermédiaires. La sortie enregistrée au journal EST donc l'avant réel, et la
// base exacte de l'après. Les fonctions appelées sont les VRAIES, importées d'index.js —
// jamais une réimplémentation : c'est l'erreur qui a produit « la simulation dit 12, la
// production dit 0 ».
//
// LECTURE SEULE, sur la base de production. USAGE : node banc-japonais.js

require('dotenv').config();
const mongoose = require('mongoose');
const S = require('./scoring.js');
const {
    trouverParSetCodeEtNumero, nomOpposeUnVeto, scorerCandidatsLocal, lireCodeSets
} = require('./index');
const { numeroEstUnDexId } = require('./pokedex');
const { EXPANSIONS_VINTAGE, setCodeCompatibleVintage } = require('./sets-vintage-japonais');
const { trouverProduitsLocaux, setsPourTotal } = require('./index');

const J = mongoose.model('Jb', new mongoose.Schema({}, { strict: false }), 'journal_scans');
const Cat = mongoose.model('Pb', new mongoose.Schema({}, { strict: false }), 'catalogue_produits');
const Num = mongoose.model('Nb', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');
const EST_CODE_CARD = /code\s*card/i;

// ---- LA VÉRITÉ DU BANC ---------------------------------------------------
// Fournie par le testeur sous forme d'URL Cardmarket, résolue en idProduct via les slugs
// de numeros_cartes. Les lignes absentes de cette table sont celles où la chaîne avait
// VU JUSTE : idProduct attendu = idProduct retenu.
// 'inconnu' = le testeur n'a pas pu retrouver la carte (annonce vendue et disparue). Ces
// lignes sont EXCLUES du calcul, jamais comptées comme des réussites.
const VERITE = {
    JP001: 562000,   // Charmander  -> MCDP-004     (McDonalds-Original-Minimum-Pack)
    JP002: 654781,   // Wartortle   -> EC1-S19      (Base-Expansion-Pack)
    JP007: 654781,   // Wartortle   -> EC1-S19      (même carte que JP002)
    JP003: 653962,   // Rhydon      -> EC4-055 V2   (Split-Earth)
    JP009: 651965,   // Porygon2    -> EC2-063      (The-Town-on-No-Map)
    JP017: 653910,   // Flareon     -> EC4-017 V2   (Split-Earth, holo)
    JP026: 606835,   // Light Jolteon -> N4         (Darkness-and-to-Light)
    JP031: 606847,   // Dark Haunter  -> N4         (Darkness-and-to-Light)
    JP036: 571754,   // Mew         -> SI-JP        (Southern-Islands-JP)
    JP004: 'inconnu', // Ledian holo : V1 ou V2 indéterminable, annonce disparue
    JP030: 'inconnu', // Meowth : ROG ou EC4-062 ?
    JP034: 'inconnu'  // Misty's Staryu : carte non retrouvée
};

// ⚠️ VÉRITÉS DONNÉES PAR NOM, PAS PAR CLÉ. Le testeur a fourni cinq cartes sous forme
// d'URL Cardmarket sans les rattacher à un numéro de ligne. Sans cette table, elles
// tombaient dans le cas « absente de VERITE -> attendu = ce que la production avait
// retenu » — c'est-à-dire `null`, puisque ces cinq scans avaient ÉCHOUÉ. Le banc comptait
// donc l'échec comme la bonne réponse, et affichait une identification correcte comme une
// régression. Un banc qui prend l'échec pour la vérité est pire qu'un banc absent.
const VERITE_PAR_NOM = {
    'Raichu': 654243,          // Intro-Pack-Bulbasaur/Raichu-IPB3
    "Koga's Ditto": 605387,    // Challenge-from-the-Darkness/Kogas-Ditto-CFTD
    'Tangela': 557645,         // Expansion-Pack/Tangela
    'Dragonite': 698502,       // Cry-from-the-Mysterious/Dragonite-Lv61-DP5c
    'Jigglypuff': 584684       // Pokemon-Jungle (PJU), « Jungle, No.039 »
};

(async () => {
    const t0 = Date.now();
    while (mongoose.connection.readyState !== 1 && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 100));
    console.log(`\nbase : ${mongoose.connection.db.databaseName} (lecture seule)\n`);

    const produits = (await Cat.find({}, { idProduct: 1, idExpansion: 1, name: 1 }).lean())
        .filter(p => !EST_CODE_CARD.test(String(p.name || '')));
    const catById = new Map(produits.map(p => [p.idProduct, p]));
    const numDocs = await Num.find({}, { idProduct: 1, numero: 1, numeroUrl: 1, nomFr: 1 }).lean();
    const numParId = new Map(numDocs.map(d => [d.idProduct, d]));

    const docs = await J.find({}).sort({ le: 1 }).lean();
    const vues = new Map();
    for (const d of docs.filter(d => ['JP', 'ZH', 'KR'].includes(d.langue))) {
        const k = `${d.nom ?? ''}|${d.numero ?? ''}|${d.setCode ?? ''}|${d.total ?? ''}`;
        if (!vues.has(k)) vues.set(k, d);
    }
    const bancs = [...vues.values()].map((d, i) => ({ cle: `JP${String(i + 1).padStart(3, '0')}`, d }));

    const cardInfoDe = d => ({
        name: d.nom, number: d.numero, total: d.total, setCode: d.setCode,
        language: d.langue, rarete: d.rarete, nomBrut: d.nomBrut, nomConfiance: d.nomConfiance,
        motif: null, reverse: false, rareteElevee: false
    });

    // L'état APRÈS : les décisions ajoutées, appliquées à la sortie enregistrée.
    async function apres(d) {
        const cardInfo = cardInfoDe(d);
        let retenu = d.idProduct, incertain = Boolean(d.carteIncertaine), voie = d.voieCatalogue;

        // 0. LA RÈGLE DU NUMÉRO DE POKÉDEX. Quand elle se déclenche, le nombre lu n'est
        //    pas un numéro de carte : il ne sert plus ni de clé, ni de preuve, ni de rang.
        const avisDex = numeroEstUnDexId({ nom: d.nom, numero: d.numero, total: d.total, langue: d.langue });
        const numeroCarte = avisDex.estDex ? null : d.numero;
        const cardInfoNeutre = { ...cardInfo, number: numeroCarte };
        // Perdre une source propage l'incertitude : sans le numéro, l'identification ne
        // tient plus qu'au nom, et sur ces cartes vintage le nom ne suffit pas.
        if (avisDex.estDex) { voie = 'numero-pokedex-neutralise'; incertain = true; }

        // 0 bis. LE PÉRIMÈTRE FERMÉ. Sans numéro exploitable et en langue asiatique, le
        //    vivier par le nom est restreint aux 24 sets japonais vintage. Sortie en
        //    SUGGESTION AVERTIE : `incertain` est forcé, jamais un verdict affirmé.
        // Deux portes : aucun numéro exploitable, OU un numéro mais aucune expansion
        // attendue — gardé par la compatibilité du setCode lu avec la table close.
        const compat = setCodeCompatibleVintage(d.setCode, S);
        let sansExpansion = false;
        if (numeroCarte != null) {
            const sets = await setsPourTotal(d.total, d.langue);
            const exps = new Set();
            for (const s of sets) for (const e of await Num.distinct('idExpansion', { setTcgdex: s.id })) if (e != null) exps.add(Number(e));
            sansExpansion = exps.size === 0;
        }
        if ((numeroCarte == null || sansExpansion) && compat.compatible && ['JP', 'ZH', 'KR'].includes(d.langue)) {
            const parNom = await trouverProduitsLocaux(d.nom);
            const dedans = parNom.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
            if (parNom.length > 1 && dedans.length) {
                const cs = await lireCodeSets(dedans.map(p => p.idExpansion));
                const r = await scorerCandidatsLocal(dedans, cardInfoNeutre, null, [], cs, {});
                const eg = r.scores.length > 1 && r.scores[0].score === r.scores[1].score;
                if (r.scores.length && !eg) {
                    retenu = r.scores[0].candidat.idProduct;
                    voie = 'perimetre-vintage';
                    incertain = true;   // suggestion avertie, arbitrage F
                    return { retenu, incertain, voie };
                }
                // Égalité dans le périmètre : on retombe sur la règle de l'égalité.
                if (eg) {
                    const prix = r.scores.filter(s => s.score === r.scores[0].score).map(s => s.candidat.prix).filter(p => Number.isFinite(p) && p > 0);
                    const ecart = prix.length >= 2 ? Math.max(...prix) - Math.min(...prix) : null;
                    if (ecart == null || ecart >= 1.00) return { retenu: null, incertain: true, voie: 'REFUS-egalite-perimetre' };
                    return { retenu: r.scores[0].candidat.idProduct, incertain: true, voie: 'perimetre-egalite-sans-enjeu' };
                }
            }
        }

        // 1. Le chemin par le code, en tête.
        const piste = await trouverParSetCodeEtNumero(d.setCode, numeroCarte, d.langue);
        if (piste.length === 1) {
            const a = await nomOpposeUnVeto(cardInfoNeutre, piste[0]);
            if (!a.veto) { retenu = piste[0].idProduct; voie = 'setcode-numero'; }
        }

        // 2. Le veto par le nom sur le gagnant, et son re-classement.
        const prod = catById.get(retenu);
        if (prod) {
            const avis = await nomOpposeUnVeto(cardInfoNeutre, prod);
            if (avis.incoherent) incertain = true;
            if (avis.veto) {
                const cs = await lireCodeSets(avis.preuves.map(p => p.idExpansion));
                const r = await scorerCandidatsLocal(avis.preuves, cardInfo, null, [], cs, {});
                const eg = r.scores.length > 1 && r.scores[0].score === r.scores[1].score;
                if (r.scores.length && !eg) { retenu = r.scores[0].candidat.idProduct; voie = 'veto-nom-reclasse'; }
                else { retenu = null; voie = 'REFUS-veto'; incertain = true; }
            }
        }

        // 3. L'égalité parfaite du chemin principal. `ecartScore` est enregistré au
        //    journal, donc l'égalité est CONSTATÉE, pas simulée. Elle ne s'applique qu'aux
        //    lignes que les étapes 1 et 2 n'ont pas déjà tranchées : quand une clé exacte
        //    ou un re-classement a désigné un produit, il n'y a plus d'égalité à arbitrer.
        if (voie === d.voieCatalogue && d.ecartScore === 0) {
            retenu = null; voie = 'REFUS-egalite'; incertain = true;
        }
        return { retenu, incertain, voie };
    }

    // Lecture jugée par CONTRADICTION POSITIVE seulement — même principe que partout
    // ailleurs. Un numéro absent en base ne contredit rien : il rend la lecture
    // INVÉRIFIABLE, ce qui n'est pas une réussite.
    function lecture(d, idAttendu) {
        const p = catById.get(idAttendu);
        if (!p) return { verdict: 'invérifiable', champ: null };
        const info = numParId.get(idAttendu);
        const nomOk = S.nomConcorde([d.nom, d.nomBrut].filter(Boolean),
            [String(p.name).split('[')[0].trim(), info?.nomFr].filter(Boolean));
        const numBase = info ? (info.numero || info.numeroUrl) : null;
        if (!nomOk) return { verdict: 'contredite', champ: 'nom' };
        if (!numBase || !d.numero) return { verdict: 'invérifiable', champ: 'numéro non publié' };
        if (!S.comparerNumeros(d.numero, numBase)) return { verdict: 'contredite', champ: 'numéro' };
        return { verdict: 'juste', champ: null };
    }

    // ════════════════════════════════════════════════════════════════════════
    // D'OÙ VIENT LA VÉRITÉ DE CHAQUE LIGNE — l'audit de l'instrument lui-même
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ LE DÉFAUT LE PLUS GRAVE DE TOUT LE CHANTIER ÉTAIT ICI, dans l'instrument et non
    // dans le code mesuré : le banc tirait sa référence de la chose qu'il mesurait. Quand
    // aucune vérité n'était fournie, il prenait `d.idProduct` — ce que la PRODUCTION avait
    // retenu. Sur un scan qui avait ÉCHOUÉ, cela vaut `null` : le banc notait donc juste
    // l'échec lui-même, et comptait deux identifications correctes comme des régressions.
    // UNE MESURE QUI DÉRIVE SA RÉFÉRENCE DU SYSTÈME MESURÉ NE MESURE RIEN.
    //
    // La provenance est désormais explicite et comptée. Cinq cas, et un seul est interdit :
    //   'cle'          la clé JPxxx porte un idProduct fourni par le testeur (URL Cardmarket)
    //   'nom'          idem, rattaché par le nom de la carte
    //   'bloc'         aucune vérité individuelle, MAIS la production avait abouti et le
    //                  testeur a validé en bloc « toutes les autres lignes : attendu =
    //                  retenu ». C'est une affirmation du testeur, pas une dérivation.
    //   'inconnu'      le testeur n'a pas pu retrouver la carte -> exclue
    //   'SANS-VERITE'  la production avait ÉCHOUÉ et aucune vérité n'a été fournie. Il n'y
    //                  a RIEN à comparer -> exclue, et comptée à part. C'est le cas qui
    //                  produisait le mensonge.
    function verite(cle, d) {
        if (VERITE[cle] !== undefined) return { valeur: VERITE[cle], source: VERITE[cle] === 'inconnu' ? 'inconnu' : 'cle' };
        if (VERITE_PAR_NOM[d.nom] !== undefined) return { valeur: VERITE_PAR_NOM[d.nom], source: 'nom' };
        if (d.idProduct == null) return { valeur: null, source: 'SANS-VERITE' };
        return { valeur: d.idProduct, source: 'bloc' };
    }

    const R = { avant: { juste: 0, faux: 0, refus: 0, signale: 0 }, apres: { juste: 0, faux: 0, refus: 0, signale: 0 } };
    const lec = { juste: 0, contredite: 0, 'invérifiable': 0 };
    const provenance = { cle: 0, nom: 0, bloc: 0, inconnu: 0, 'SANS-VERITE': 0 };
    let exclus = 0, retenus = 0;
    const detail = [], sansVerite = [];
    for (const { cle, d } of bancs) {
        const v = verite(cle, d);
        provenance[v.source]++;
        if (v.source === 'inconnu') { exclus++; continue; }
        if (v.source === 'SANS-VERITE') { exclus++; sansVerite.push({ cle, d }); continue; }
        const attendu = v.valeur;
        retenus++;
        const l = lecture(d, attendu);
        lec[l.verdict]++;
        const a = await apres(d);
        const okAvant = d.idProduct === attendu, okApres = a.retenu === attendu;
        // ⚠️ UN REFUS N'AFFIRME RIEN. Un scan qui ne rend aucun produit (`retenu === null`)
        // est un échec, pas un mensonge : l'utilisateur est remboursé et n'a vu aucun prix.
        // Le compter parmi les « faux et affirmés » gonflait le seul chiffre qui décide du
        // lancement, et dans le mauvais sens — il faisait passer une amélioration réelle
        // pour une régression.
        // TROIS ISSUES, jamais deux. Un REFUS (aucun produit rendu) n'est ni une réussite
        // ni un mensonge : l'utilisateur est remboursé et n'a vu aucun prix. Le ranger
        // parmi les « faux » gonflait le chiffre qui décide du lancement.
        const issue = r => r.id === attendu ? 'juste' : (r.id == null ? 'refus' : 'faux');
        const iAvant = issue({ id: d.idProduct }), iApres = issue({ id: a.retenu });
        R.avant[iAvant]++; R.apres[iApres]++;
        if (iAvant === 'faux' && d.carteIncertaine) R.avant.signale++;
        if (iApres === 'faux' && a.incertain) R.apres.signale++;
        if (iAvant !== 'juste' || iApres !== 'juste') detail.push({ cle, d, attendu, a, l, iAvant, iApres, source: v.source });
    }

    const p = x => `${(100 * x / retenus).toFixed(1)} %`;
    console.log('── D\'OÙ VIENT LA VÉRITÉ DE CHAQUE LIGNE ──');
    console.log(`   idProduct fourni par le testeur, par CLÉ .......... ${provenance.cle}`);
    console.log(`   idProduct fourni par le testeur, par NOM .......... ${provenance.nom}`);
    console.log(`   validé EN BLOC (« toutes les autres : attendu = retenu ») ${provenance.bloc}`);
    console.log(`   « inconnu » — carte non retrouvée, EXCLUE ......... ${provenance.inconnu}`);
    console.log(`   SANS VÉRITÉ (production en échec), EXCLUE ......... ${provenance['SANS-VERITE']}`);
    for (const x of sansVerite) console.log(`      ${x.cle} "${x.d.nom}" n°${x.d.numero ?? '—'} — aucune référence, rien à comparer`);
    console.log(`\n${bancs.length} cartes distinctes · ${exclus} exclues · ${retenus} exploitables\n`);
    console.log('── TAUX DE LECTURE IA ──');
    console.log(`   juste (nom ET numéro confirmés) . ${String(lec.juste).padStart(3)}  ${p(lec.juste)}`);
    console.log(`   CONTREDITE par la carte attendue  ${String(lec.contredite).padStart(3)}  ${p(lec.contredite)}`);
    console.log(`   invérifiable (numéro non publié) . ${String(lec['invérifiable']).padStart(3)}  ${p(lec['invérifiable'])}`);
    console.log('\n── TROIS ISSUES, JAMAIS DEUX ──');
    console.log('                     AVANT          APRÈS');
    console.log(`   JUSTE ......... ${String(R.avant.juste).padStart(3)}  ${p(R.avant.juste).padStart(7)}   ${String(R.apres.juste).padStart(3)}  ${p(R.apres.juste).padStart(7)}`);
    console.log(`   FAUX .......... ${String(R.avant.faux).padStart(3)}  ${p(R.avant.faux).padStart(7)}   ${String(R.apres.faux).padStart(3)}  ${p(R.apres.faux).padStart(7)}`);
    console.log(`     dont signalé  ${String(R.avant.signale).padStart(3)}              ${String(R.apres.signale).padStart(3)}`);
    console.log(`     FAUX ET AFFIRMÉ ${String(R.avant.faux - R.avant.signale).padStart(2)}              ${String(R.apres.faux - R.apres.signale).padStart(3)}   ← le seuil de lancement`);
    console.log(`   REFUS ......... ${String(R.avant.refus).padStart(3)}  ${p(R.avant.refus).padStart(7)}   ${String(R.apres.refus).padStart(3)}  ${p(R.apres.refus).padStart(7)}   (remboursés, aucun prix montré)`);

    console.log('\n── LES LIGNES QUI BOUGENT OU RESTENT FAUSSES ──');
    for (const x of detail) {
        const nomAtt = String(catById.get(x.attendu)?.name ?? '?').split('[')[0].trim();
        const ic = { juste: '✅', faux: '❌', refus: '⛔' };
        console.log(`${x.cle}  "${x.d.nom}" n°${x.d.numero} code=${x.d.setCode ?? '—'} total=${x.d.total ?? '—'}  [lecture ${x.l.verdict}${x.l.champ ? ` : ${x.l.champ}` : ''}] [vérité: ${x.source}]`);
        console.log(`      attendu ${x.attendu} "${nomAtt}"`);
        console.log(`      AVANT ${x.d.idProduct} ${ic[x.iAvant]}  ->  APRÈS ${x.a.retenu} ${ic[x.iApres]} incertain=${x.a.incertain} voie=${x.a.voie}`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // AUTO-CONTRÔLE : le banc sait-il se tromper ?
    // ════════════════════════════════════════════════════════════════════════
    // Un instrument qu'on n'a jamais vu signaler une erreur n'est pas vérifié. On injecte
    // une vérité FAUSSE connue sur une ligne aujourd'hui juste : le banc doit la compter
    // comme fausse. S'il la compte juste, il ne compare rien.
    if (process.argv.includes('--auto-controle')) {
        console.log('\n── AUTO-CONTRÔLE : injection d\'une vérité fausse ──');
        const temoin = bancs.find(({ cle, d }) => {
            const v = verite(cle, d);
            return v.source !== 'inconnu' && v.source !== 'SANS-VERITE' && d.idProduct === v.valeur;
        });
        if (!temoin) { console.log('   aucune ligne juste disponible comme témoin'); }
        else {
            const vraie = verite(temoin.cle, temoin.d).valeur;
            const fausse = 999999999;
            const a = await apres(temoin.d);
            const avecVraie = a.retenu === vraie ? 'juste' : (a.retenu == null ? 'refus' : 'faux');
            const avecFausse = a.retenu === fausse ? 'juste' : (a.retenu == null ? 'refus' : 'faux');
            console.log(`   témoin ${temoin.cle} "${temoin.d.nom}" — la chaîne rend ${a.retenu}`);
            console.log(`     avec la vraie vérité (${vraie})   -> ${avecVraie}   ${avecVraie === 'juste' ? '✅' : '❌'}`);
            console.log(`     avec une vérité FAUSSE (${fausse}) -> ${avecFausse}   ${avecFausse === 'faux' ? '✅ le banc la signale' : '❌ LE BANC NE COMPARE RIEN'}`);
        }
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch(async e => { console.error('ERREUR', e.message, e.stack); try { await mongoose.disconnect(); } catch (_) { } process.exit(1); });
