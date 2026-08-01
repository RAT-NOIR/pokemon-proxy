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

        // 1. Le chemin par le code, en tête.
        const piste = await trouverParSetCodeEtNumero(d.setCode, d.numero, d.langue);
        if (piste.length === 1) {
            const a = await nomOpposeUnVeto(cardInfo, piste[0]);
            if (!a.veto) { retenu = piste[0].idProduct; voie = 'setcode-numero'; }
        }

        // 2. Le veto par le nom sur le gagnant, et son re-classement.
        const prod = catById.get(retenu);
        if (prod) {
            const avis = await nomOpposeUnVeto(cardInfo, prod);
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

    const R = { avant: { juste: 0, faux: 0, signale: 0 }, apres: { juste: 0, faux: 0, signale: 0 } };
    const lec = { juste: 0, contredite: 0, 'invérifiable': 0 };
    let exclus = 0, retenus = 0;
    const detail = [];
    for (const { cle, d } of bancs) {
        const v = VERITE[cle];
        const attendu = v === undefined ? d.idProduct : v;
        if (attendu === 'inconnu') { exclus++; continue; }
        retenus++;
        const l = lecture(d, attendu);
        lec[l.verdict]++;
        const a = await apres(d);
        const okAvant = d.idProduct === attendu, okApres = a.retenu === attendu;
        R.avant[okAvant ? 'juste' : 'faux']++;
        if (!okAvant && d.carteIncertaine) R.avant.signale++;
        R.apres[okApres ? 'juste' : 'faux']++;
        if (!okApres && a.incertain) R.apres.signale++;
        if (!okAvant || !okApres) detail.push({ cle, d, attendu, a, l, okAvant, okApres });
    }

    const p = x => `${(100 * x / retenus).toFixed(1)} %`;
    console.log(`${bancs.length} cartes distinctes · ${exclus} exclues (inconnu) · ${retenus} exploitables\n`);
    console.log('── TAUX DE LECTURE IA ──');
    console.log(`   juste (nom ET numéro confirmés) . ${String(lec.juste).padStart(3)}  ${p(lec.juste)}`);
    console.log(`   CONTREDITE par la carte attendue  ${String(lec.contredite).padStart(3)}  ${p(lec.contredite)}`);
    console.log(`   invérifiable (numéro non publié) . ${String(lec['invérifiable']).padStart(3)}  ${p(lec['invérifiable'])}`);
    console.log('\n── TAUX D\'IDENTIFICATION ──');
    console.log('                     AVANT          APRÈS');
    console.log(`   juste ......... ${String(R.avant.juste).padStart(3)}  ${p(R.avant.juste).padStart(7)}   ${String(R.apres.juste).padStart(3)}  ${p(R.apres.juste).padStart(7)}`);
    console.log(`   FAUX .......... ${String(R.avant.faux).padStart(3)}  ${p(R.avant.faux).padStart(7)}   ${String(R.apres.faux).padStart(3)}  ${p(R.apres.faux).padStart(7)}`);
    console.log(`     dont signalé  ${String(R.avant.signale).padStart(3)}              ${String(R.apres.signale).padStart(3)}`);
    console.log(`     FAUX ET AFFIRMÉ ${String(R.avant.faux - R.avant.signale).padStart(2)}              ${String(R.apres.faux - R.apres.signale).padStart(3)}`);

    console.log('\n── LES LIGNES QUI BOUGENT OU RESTENT FAUSSES ──');
    for (const x of detail) {
        const nomAtt = String(catById.get(x.attendu)?.name ?? '?').split('[')[0].trim();
        console.log(`${x.cle}  "${x.d.nom}" n°${x.d.numero} code=${x.d.setCode ?? '—'} total=${x.d.total ?? '—'}  [lecture ${x.l.verdict}${x.l.champ ? ` : ${x.l.champ}` : ''}]`);
        console.log(`      attendu ${x.attendu} "${nomAtt}"`);
        console.log(`      AVANT ${x.d.idProduct} ${x.okAvant ? '✅' : '❌'} incertain=${Boolean(x.d.carteIncertaine)}  ->  APRÈS ${x.a.retenu} ${x.okApres ? '✅' : '❌'} incertain=${x.a.incertain} voie=${x.a.voie}`);
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch(async e => { console.error('ERREUR', e.message, e.stack); try { await mongoose.disconnect(); } catch (_) { } process.exit(1); });
