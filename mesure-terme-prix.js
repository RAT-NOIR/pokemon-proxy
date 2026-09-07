// ============================================================================
// LE TERME PRIX (+25 sous 3 €) CONTRE LES VÉRITÉS DU BANC — 2026-09-08, LECTURE SEULE
// ============================================================================
// LA QUESTION. Le critère 5 de `scorerCandidat` (scoring.js) donne +25 au candidat bon
// marché quand la rareté lue n'est pas élevée. Mesuré trois fois : il déclasse les cartes
// CHÈRES — Rattata, vérité à 23,08 €, 0 point ; concurrent à 0,69 €, +25 ; écart exactement
// 25. Le RETIRER est mesuré perdant (6 refus pour 1 gain, 2026-09-04). La piste retenue est
// plus étroite : ne plus tirer quand la rareté n'a PAS été lue — un cas qui n'existe que
// depuis le commit f188a0c (`rarete` nullable). Ce fichier MESURE, il ne câble rien.
//
// DEUX MESURES, ET LA SECONDE VAUT MÊME SI LA PREMIÈRE EST VIDE :
//   1. combien de lignes verraient le terme neutralisé sous la règle « rareté non lue ->
//      pas de +25 », et ce que le rejeu donne avec cette neutralisation ;
//   2. le terme pénalise-t-il les cartes chères de façon SYSTÉMATIQUE : prix médian des
//      vérités JUSTES contre MANQUÉES, et, sur les lignes où la vérité perd, combien de
//      fois l'écart au gagnant vaut exactement 25.
//
// 🔑 TOUT DÉNOMINATEUR S'IMPRIME AVANT TOUT TAUX. Le journal d'avant f188a0c ne porte AUCUN
// `rarete: null` : si la population de la mesure 1 est vide, on le dit et on s'arrête là,
// on ne fabrique pas un chiffre.
//
// CE QUI EST RÉUTILISÉ, PAS RÉIMPLÉMENTÉ :
//   · la vérité de chaque ligne : les MÊMES règles que banc-japonais.js — seaux, numérotation
//     et rattachement par identité viennent de banc-seaux.js ; les deux tables codées en dur
//     (VERITE, VERITE_PAR_NOM) sont LUES DANS LA SOURCE de banc-japonais.js, comme
//     verrou/empreinte.js lit le prompt dans index.js. Le banc s'exécute au require, il ne
//     peut pas être importé ; recopier ses tables en ferait une seconde source ;
//   · le scoring : `scorerCandidatsLocal` d'index.js, sur le vivier par le nom
//     (`trouverProduitsLocaux`), numéro de Pokédex neutralisé comme dans `apres()` du banc.
//
// ⚠️ LIMITE DU REJEU, à lire avec chaque chiffre : le vivier est celui du NOM LU, sans le
// `nomExact` TCGdex, sans les expansions attendues, sans le périmètre vintage. C'est le
// rejeu des mesures du 2026-09-04, pas la production. La colonne « production » (AVANT du
// banc) vient du journal et n'a pas cette limite.
//
// USAGE : node mesure-terme-prix.js
// ============================================================================
process.env.MONGODB_BASE = process.env.MONGODB_BASE || 'test';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const S = require('./scoring.js');
const { trouverProduitsLocaux, scorerCandidatsLocal, lireCodeSets } = require('./index');
const { numeroEstUnDexId } = require('./pokedex');
const { seauDe, numeroter, identiteDe, rattacherVerites } = require('./banc-seaux');
// Pour le tri « table vintage d'abord » (mesure 5) : la table close, celle du périmètre.
const { EXPANSIONS_VINTAGE } = require('./sets-vintage-japonais');

const J = mongoose.model('Jm', new mongoose.Schema({}, { strict: false }), 'journal_scans');
const Cat = mongoose.model('Pm', new mongoose.Schema({}, { strict: false }), 'catalogue_produits');
const G = mongoose.model('Gm', new mongoose.Schema({}, { strict: false }), 'guide_prix');
const EST_CODE_CARD = /code\s*card/i;
const SEAUX_VERITES_CODEES = new Set(['entrainement', 'verification']);
const MOTIFS_TECHNIQUES = new Set(['ia-echec', 'erreur-serveur']);
const SEUIL_CHER = 3; // le seuil du critère 5, recopié pour l'AFFICHAGE seulement

/** Une table littérale de banc-japonais.js, lue dans sa source (le banc s'exécute au require). */
function tableDuBanc(nom) {
    const src = fs.readFileSync(path.join(__dirname, 'banc-japonais.js'), 'utf8');
    const m = src.match(new RegExp(`\\nconst ${nom} = (\\[[\\s\\S]*?\\n\\]);`));
    if (!m) throw new Error(`table ${nom} introuvable dans banc-japonais.js — la mesure ne conclut pas`);
    return new Function('return ' + m[1])();
}

let VERITES_SAISIES;
try { VERITES_SAISIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'banc-verites.json'), 'utf8')).verites || {}; }
catch (e) { console.error(`banc-verites.json illisible (${e.message}) : on ne conclut pas.`); process.exit(1); }

const med = a => { if (!a.length) return null; const v = [...a].sort((x, y) => x - y); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
const eur = x => x == null ? '—' : `${x.toFixed(2)} €`;
const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)} %` : '—';
/** La contribution du critère 5, lue dans `detail.prix` (« +25 (...) » ou « 0 (...) »). */
const contributionPrix = detail => { const m = String(detail?.prix ?? '').match(/^([+-]?\d+)/); return m ? Number(m[1]) : 0; };

// ── LA TABLE EXACTE DU TERME (scoring.js, critère 5), relue dans le code le 2026-09-08 ──
//   entrée : lu.rarete (promo ?), lu.rareteElevee (IR/SR/SIR/UR/AR/SAR/CHR/CSR lue, OU
//   numéro > total), candidat.prix (≥ 3 € = « cher »). Sortie :
//     lu.rarete = 'promo'                         -> 0   « promo : le prix ne dit rien »   (toute la ligne)
//     prix absent                                 -> 0   « pas de prix »
//     rareteElevee ET cher                        -> +25 « IR attendue, prix élevé »
//     rareteElevee ET pas cher                    -> 0   « incohérent avec rareté lue »
//     PAS rareteElevee ET cher                    -> 0   « incohérent avec rareté lue »     <- la vérité, 32 fois
//     PAS rareteElevee ET pas cher                -> +25 « carte normale, prix bas »
//   Il n'existe AUCUNE valeur négative : la « pénalité » est un +25 refusé, et elle ne se
//   distingue du bonus que par rapport aux candidats SANS prix ou aux lignes promo, qui
//   restent à 0 dans tous les cas. C'est ce qui rend (a) et (b) presque confondus avec (c).
const BRANCHES = [
    ['coh-elevee', /^\+\d+ \(IR attendue/], ['coh-basse', /^\+\d+ \(carte normale/],
    ['incoherent', /^0 \(prix .*incohérent/], ['promo', /^0 \(promo/], ['sans-prix', /^0 \(pas de prix\)/]
];
const brancheDe = detail => { const s = String(detail?.prix ?? ''); const b = BRANCHES.find(([, re]) => re.test(s)); return b ? b[0] : 'autre'; };
// Ce que chaque régime DONNE à une branche, à la place de la contribution de référence.
const REGIMES = {
    'référence': b => ({ 'coh-elevee': 25, 'coh-basse': 25 }[b] ?? 0),
    '(a) sans bonus, pénalité gardée': b => (b === 'incoherent' ? -25 : 0),
    '(b) sans pénalité, bonus gardé': b => (['coh-elevee', 'coh-basse', 'incoherent'].includes(b) ? 25 : 0),
    '(c) terme entier neutralisé': () => 0
};
const SEUIL_MARGE = 30;   // SEUIL_MARGE_CONFORTABLE de choisirMeilleur — pour un PROXY, voir plus bas
const prixTri = p => (typeof p === 'number' && p > 0) ? p : Infinity;

/** Rejoue un régime sur les scores d'une ligne : même tri que choisirMeilleur (score desc, puis le moins cher). */
function rejouerRegime(scores, attendu, regime) {
    const re = scores.map(s => ({ ...s, score: s.score - REGIMES['référence'](s.branche) + regime(s.branche) }))
        .sort((a, b) => (b.score - a.score) || (prixTri(a.prix) - prixTri(b.prix)));
    const top = re[0], second = re[1];
    const tailleSommet = re.filter(s => s.score === top.score).length;
    const iv = re.findIndex(s => s.id === attendu);
    if (iv < 0) return { issue: 'absente', rang: null, position: null, tailleSommet, dansSommet: false };
    const rang = 1 + re.filter(s => s.score > re[iv].score).length;
    const issue = tailleSommet > 1 ? 'refus' : (top.id === attendu ? 'juste' : 'faux');
    // PROXY de « faux et affirmé » : faux ET marge ≥ 30 sur le 2e. Ce n'est PAS la réserve de
    // la route (dix drapeaux y entrent) ; c'est le seul signal de confiance que le scoring porte.
    const fauxMargeLarge = issue === 'faux' && second && (top.score - second.score) >= SEUIL_MARGE;
    return { issue, rang, position: iv + 1, tailleSommet, dansSommet: rang === 1, fauxMargeLarge, tailleEgaliteVerite: re.filter(s => s.score === re[iv].score).length };
}

(async () => {
    const t0 = Date.now();
    while (mongoose.connection.readyState !== 1 && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 100));
    if (mongoose.connection.readyState !== 1) { console.error('Mongo non connecté'); process.exit(1); }
    console.log(`base : ${mongoose.connection.db.databaseName} (lecture seule)\n`);

    const VERITE = tableDuBanc('VERITE'), VERITE_PAR_NOM = tableDuBanc('VERITE_PAR_NOM');
    const catById = new Map((await Cat.find({}, { idProduct: 1, name: 1 }).lean())
        .filter(p => !EST_CODE_CARD.test(String(p.name || ''))).map(p => [p.idProduct, p]));

    // ── LE JOURNAL, PUIS LES LIGNES DU BANC — mêmes règles que banc-japonais.js ──
    const docs = await J.find({}).sort({ le: 1 }).lean();
    const nullJournal = docs.filter(d => d.rarete == null).length;
    const existeJournal = docs.filter(d => 'rarete' in d).length;
    console.log('══ DÉNOMINATEURS ══');
    console.log(`journal : ${docs.length} lignes · \`rarete\` existe sur ${existeJournal} · vaut null sur ${nullJournal}`);

    const utiles = docs.map(d => ({ ...d, le: d.le instanceof Date ? d.le : new Date(d.le) }))
        .filter(d => !(seauDe(d) === 'entrainement' && !['JP', 'ZH', 'KR'].includes(d.langue)));
    const { lignes } = numeroter(utiles);
    const rattachement = rattacherVerites(lignes, VERITES_SAISIES);

    function verite(d) {
        if (MOTIFS_TECHNIQUES.has(d.motifEchec)) return { valeur: null, source: 'TECHNIQUE' };
        if (SEAUX_VERITES_CODEES.has(seauDe(d))) {
            const ident = identiteDe(d);
            const parCle = VERITE.find(v => identiteDe({ ...v.lu }) === ident);
            if (parCle) return { valeur: parCle.idProduct, source: parCle.idProduct === 'inconnu' ? 'inconnu' : 'cle' };
            const parNom = VERITE_PAR_NOM.find(v => identiteDe({ ...v.lu }) === ident);
            if (parNom) return { valeur: parNom.idProduct, source: 'nom' };
        }
        const vs = rattachement.parIdentite.get(identiteDe(d));
        if (vs !== undefined) {
            if (vs.idProduct === 'inconnu') return { valeur: null, source: 'inconnu' };
            if (vs.idProduct === 'hors-perimetre') return { valeur: null, source: 'hors-perimetre' };
            return { valeur: vs.idProduct, source: `saisie:${vs.source}` };
        }
        if (d.idProduct == null) return { valeur: null, source: 'SANS-VERITE' };
        return { valeur: d.idProduct, source: 'bloc' };
    }

    const provenance = {};
    const V = [];   // les lignes à vérité INDIVIDUELLE
    for (const { cle, d, seau } of lignes) {
        const v = verite(d);
        provenance[seau] = provenance[seau] || {};
        provenance[seau][v.source] = (provenance[seau][v.source] || 0) + 1;
        // Exclues PAR SOURCE, comme le banc — pas par « valeur nulle » : la table codée porte
        // la CHAÎNE 'inconnu' comme idProduct, et un filtre sur null la laissait passer (3
        // lignes à attendu NaN au premier passage, 112 « vérités » au lieu de 109).
        if (['bloc', 'inconnu', 'hors-perimetre', 'SANS-VERITE', 'TECHNIQUE'].includes(v.source)) continue;
        V.push({ cle, d, seau, attendu: Number(v.valeur), source: v.source });
    }
    console.log(`lignes du banc : ${lignes.length}`);
    for (const [s, p] of Object.entries(provenance)) console.log(`   ${s.padEnd(14)} ${JSON.stringify(p)}`);
    const parSeau = {}; for (const x of V) parSeau[x.seau] = (parSeau[x.seau] || 0) + 1;
    console.log(`vérités INDIVIDUELLES (les seules mesurées ici) : ${V.length}  ${JSON.stringify(parSeau)}`);
    // ⚠️ À COMPARER AU BANC : il imprime les mêmes compteurs de provenance par seau. Un écart
    // ici est un écart d'INSTRUMENT, à expliquer avant de lire un seul chiffre plus bas.
    console.log(`   entraînement, ligne par ligne : ${V.filter(x => x.seau === 'entrainement').map(x => `${x.cle}(${x.source.replace('saisie:', '')})`).join(' ')}`);
    const nullBanc = V.filter(x => x.d.rarete == null).length;
    console.log(`  dont \`rarete\` null : ${nullBanc}   (distribution : ${JSON.stringify(V.reduce((a, x) => (a[x.d.rarete ?? 'null'] = (a[x.d.rarete ?? 'null'] || 0) + 1, a), {}))})`);

    // ── LE PRIX DES VÉRITÉS — le même prix que le scoring (prixDeReference, axe normal) ──
    const guides = await G.find({ idProduct: { $in: [...new Set(V.map(x => x.attendu))] } }).lean();
    const prixParId = new Map(guides.map(g => [Number(g.idProduct), S.prixDeReference(g, false)]));

    // ── LE REJEU — vivier par le nom, scoring de production ──
    for (const x of V) {
        const d = x.d;
        const avisDex = numeroEstUnDexId({ nom: d.nom, numero: d.numero, total: d.total, langue: d.langue });
        const cardInfo = {
            name: d.nom, number: avisDex.estDex ? null : d.numero, total: d.total, setCode: d.setCode,
            language: d.langue, rarete: d.rarete ?? null, nomBrut: d.nomBrut, nomConfiance: d.nomConfiance,
            motif: null, reverse: false, rareteElevee: false
        };
        const vivier = await trouverProduitsLocaux(d.nom);
        x.prixVerite = prixParId.get(x.attendu) ?? null;
        x.issueProd = d.idProduct === x.attendu ? 'juste' : (d.idProduct == null ? 'refus' : 'faux');
        if (!vivier.length) { x.rejeu = { vide: true }; continue; }
        const cs = await lireCodeSets(vivier.map(p => p.idExpansion));
        const r = await scorerCandidatsLocal(vivier, cardInfo, null, [], cs, {});
        const scores = r.scores;
        const iv = scores.findIndex(s => s.candidat.idProduct === x.attendu);
        const top = scores[0];
        const egalite = scores.length > 1 && S.sontExAequo(scores[0].score, scores[1].score);
        const sv = iv >= 0 ? scores[iv] : null;
        const rang = sv ? 1 + scores.filter(s => s.score > sv.score).length : null;
        const ip = scores.findIndex(s => s.candidat.idProduct === d.idProduct);
        // Les scores compacts, pour les régimes — et la branche de chaque candidat.
        const ordreVivier = new Map(vivier.map((p, i) => [p.idProduct, i]));
        x.scores = scores.map(s => ({
            id: s.candidat.idProduct, score: s.score, prix: s.candidat.prix, branche: brancheDe(s.detail),
            // Pour les tris de la mesure 5 : la place dans le vivier tel que rendu par Mongo
            // (ordre naturel, aucun tri demandé), l'expansion, et l'appartenance à la table close.
            ordreVivier: ordreVivier.get(s.candidat.idProduct) ?? Infinity,
            idExpansion: Number(s.candidat.idExpansion),
            vintage: EXPANSIONS_VINTAGE.has(Number(s.candidat.idExpansion)),
            // Pour la mesure 6 (« même carte ? ») : le numéro Cardmarket du candidat enrichi, et
            // l'idMetacard lu sur le PRODUIT du vivier — il n'est pas recopié dans le candidat
            // enrichi par scorerCandidatsLocal (à savoir avant tout câblage).
            numeroCardmarket: s.candidat.numeroCardmarket ?? null,
            idMetacard: vivier.find(p => p.idProduct === s.candidat.idProduct)?.idMetacard ?? null
        }));
        // PARTIE 2 : la même ligne, rareté ABSENTE. `rareteElevee` reste false, comme dans
        // `cardInfoDe` du banc — et comme en production, où null ne peut pas la lever.
        const rNull = await scorerCandidatsLocal(vivier, { ...cardInfo, rarete: null }, null, [], cs, {});
        x.branchesNull = new Map(rNull.scores.map(s => [s.candidat.idProduct, brancheDe(s.detail)]));
        // L'ordre RENDU par la production dans les deux cas (mesure 7) : c'est ce que l'écran montre.
        x.ordreProd = scores.map(s => ({ id: s.candidat.idProduct, prix: s.candidat.prix, nom: String(vivier.find(p => p.idProduct === s.candidat.idProduct)?.name ?? '').split('[')[0].trim(), score: s.score }));
        x.ordreNull = rNull.scores.map(s => ({ id: s.candidat.idProduct, prix: s.candidat.prix, nom: String(vivier.find(p => p.idProduct === s.candidat.idProduct)?.name ?? '').split('[')[0].trim(), score: s.score }));
        x.rejeu = {
            vide: false, taille: scores.length, presente: iv >= 0, rang, egalite,
            issue: !sv ? 'absente' : (rang === 1 ? (egalite ? 'refus' : 'juste') : 'faux'),
            ecartTop: sv ? top.score - sv.score : null,
            prixTop: sv ? contributionPrix(top.detail) : null, prixVer: sv ? contributionPrix(sv.detail) : null,
            detailTop: top.detail?.prix ?? null, detailVer: sv?.detail?.prix ?? null,
            ecartGagnantProd: (sv && ip >= 0) ? scores[ip].score - sv.score : null,
            // La contrefactuelle de la mesure 1 : le terme retranché à TOUS les candidats
            // quand la rareté n'a pas été lue, puis re-classement sans toucher au scoring.
            neutralise: null
        };
        if (d.rarete == null) {
            const re = scores.map(s => ({ id: s.candidat.idProduct, score: s.score - contributionPrix(s.detail) }))
                .sort((a, b) => b.score - a.score);
            const jv = re.findIndex(s => s.id === x.attendu);
            const eg = re.length > 1 && S.sontExAequo(re[0].score, re[1].score);
            const rg = jv >= 0 ? 1 + re.filter(s => s.score > re[jv].score).length : null;
            x.rejeu.neutralise = { rang: rg, issue: jv < 0 ? 'absente' : (rg === 1 ? (eg ? 'refus' : 'juste') : 'faux') };
        }
    }

    const tableau = (titre, lignesV, issueDe) => {
        const c = { juste: 0, faux: 0, refus: 0, absente: 0, vide: 0 };
        for (const x of lignesV) c[issueDe(x)]++;
        console.log(`   ${titre.padEnd(52)} juste ${c.juste} · faux ${c.faux} · refus(égalité) ${c.refus} · vérité absente du vivier ${c.absente} · vivier vide ${c.vide}   (n=${lignesV.length})`);
    };
    const rangs = (titre, lignesV, rangDe) => {
        const b = { '1': 0, '2': 0, '3': 0, '4-10': 0, '>10': 0, 'absente/vide': 0 };
        for (const x of lignesV) { const r = rangDe(x); b[r == null ? 'absente/vide' : r === 1 ? '1' : r === 2 ? '2' : r === 3 ? '3' : r <= 10 ? '4-10' : '>10']++; }
        console.log(`   ${titre.padEnd(52)} ${Object.entries(b).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
    };
    const issueRejeu = x => x.rejeu.vide ? 'vide' : x.rejeu.issue;
    const rangRejeu = x => x.rejeu.vide ? null : x.rejeu.rang;

    // ══ MESURE 1 ══
    console.log('\n══ MESURE 1 — « rareté non lue -> pas de +25 » ══');
    const touchees = V.filter(x => x.d.rarete == null && !x.rejeu.vide);
    console.log(`lignes que la règle toucherait : ${touchees.length} sur ${V.length} vérités (journal entier : ${nullJournal} sur ${docs.length})`);
    if (touchees.length === 0) {
        console.log('   🔴 POPULATION VIDE. Le journal antérieur à f188a0c ne porte aucun `rarete: null` (le');
        console.log('   forçage `|| \'normale\'` était en place, et le prompt disait « réponds normale »). La règle');
        console.log('   ne peut être mesurée que sur des scans POSTÉRIEURS au déploiement de f188a0c, et');
        console.log('   dotés d\'une vérité. Rien à chiffrer : le rejeu neutralisé est IDENTIQUE au rejeu');
        console.log('   de référence par construction, il n\'est pas affiché comme un résultat.');
    } else {
        tableau('rejeu de référence', touchees, issueRejeu);
        tableau('rejeu, terme neutralisé (rareté non lue)', touchees, x => x.rejeu.neutralise.issue);
        rangs('rangs de la vérité, référence', touchees, rangRejeu);
        rangs('rangs de la vérité, neutralisé', touchees, x => x.rejeu.neutralise.rang);
    }
    console.log('\n   Le rejeu de RÉFÉRENCE sur toutes les vérités (limite : vivier par le nom, voir en-tête) :');
    tableau('rejeu de référence, toutes vérités', V, issueRejeu);
    rangs('rangs de la vérité, référence', V, rangRejeu);
    console.log('   ⚠️ « faux et affirmé » n\'est pas dérivable de ce rejeu (les réserves sont posées par la route) ;');
    console.log('      le chiffre du banc est 0, et aucune ligne n\'est touchée : il ne bouge pas.');

    // ══ MESURE 2 ══
    console.log('\n══ MESURE 2 — le terme prix pénalise-t-il les cartes chères de façon systématique ? ══');
    const avecPrix = V.filter(x => x.prixVerite != null);
    console.log(`vérités avec un prix guide : ${avecPrix.length} sur ${V.length}`);
    const groupe = (titre, sel) => {
        const p = sel.map(x => x.prixVerite);
        console.log(`   ${titre.padEnd(40)} n=${String(sel.length).padStart(3)}  médiane ${eur(med(p)).padStart(9)}  ≥ ${SEUIL_CHER} € : ${sel.filter(x => x.prixVerite >= SEUIL_CHER).length} (${pct(sel.filter(x => x.prixVerite >= SEUIL_CHER).length, sel.length)})`);
    };
    console.log('   Par le VERDICT DE PRODUCTION (colonne AVANT du banc) :');
    groupe('JUSTES', avecPrix.filter(x => x.issueProd === 'juste'));
    groupe('MANQUÉES (faux + refus)', avecPrix.filter(x => x.issueProd !== 'juste'));
    groupe('  dont FAUX', avecPrix.filter(x => x.issueProd === 'faux'));
    groupe('  dont REFUS', avecPrix.filter(x => x.issueProd === 'refus'));
    console.log('   Par le REJEU (vivier par le nom) :');
    groupe('rang 1 sans égalité', avecPrix.filter(x => issueRejeu(x) === 'juste'));
    groupe('perdante (rang > 1)', avecPrix.filter(x => issueRejeu(x) === 'faux'));
    groupe('égalité au sommet', avecPrix.filter(x => issueRejeu(x) === 'refus'));
    groupe('absente du vivier / vivier vide', avecPrix.filter(x => ['absente', 'vide'].includes(issueRejeu(x))));

    const perdantes = V.filter(x => issueRejeu(x) === 'faux');
    const ecarts = {};
    for (const x of perdantes) ecarts[x.rejeu.ecartTop] = (ecarts[x.rejeu.ecartTop] || 0) + 1;
    const exact25 = perdantes.filter(x => x.rejeu.ecartTop === 25);
    const mecanisme = exact25.filter(x => x.rejeu.prixTop === 25 && x.rejeu.prixVer === 0);
    console.log(`\n   lignes où la vérité PERD au rejeu (présente, rang > 1) : ${perdantes.length}`);
    console.log(`   écart au 1er : ${Object.entries(ecarts).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
    console.log(`   écart EXACTEMENT 25 : ${exact25.length} sur ${perdantes.length} (${pct(exact25.length, perdantes.length)})`);
    console.log(`     dont le terme prix seul l'explique (1er +25, vérité 0) : ${mecanisme.length}`);
    const perdProd = V.filter(x => x.issueProd === 'faux' && x.rejeu.ecartGagnantProd != null);
    const perdProd25 = perdProd.filter(x => x.rejeu.ecartGagnantProd === 25);
    console.log(`   lignes FAUSSES en production dont gagnant ET vérité sont au vivier du rejeu : ${perdProd.length} · écart gagnant−vérité = 25 : ${perdProd25.length}`);
    const termeSeul = V.filter(x => !x.rejeu.vide && x.rejeu.presente && x.rejeu.prixVer === 0 && x.rejeu.prixTop === 25);
    console.log(`   vérités présentes où le 1er a +25 et la vérité 0, tous rangs : ${termeSeul.length} sur ${V.filter(x => !x.rejeu.vide && x.rejeu.presente).length} présentes`);

    console.log('\n   Les lignes à écart exactement 25 :');
    for (const x of exact25) {
        console.log(`     ${x.cle.padEnd(6)} ${String(x.d.nom).padEnd(18)} vérité ${x.attendu} ${eur(x.prixVerite).padStart(9)} rang ${x.rejeu.rang}/${x.rejeu.taille} · prod:${x.issueProd.padEnd(5)} · 1er « ${x.rejeu.detailTop} » · vérité « ${x.rejeu.detailVer} »`);
    }

    // ══ MESURE 3 — LE TERME DÉCOMPOSÉ, TROIS RÉGIMES ══
    console.log('\n══ MESURE 3 — le terme décomposé : bonus, pénalité, et les trois régimes ══');
    const presentes = V.filter(x => !x.rejeu.vide && x.rejeu.presente);
    const parBranche = {}; let nCand = 0;
    for (const x of presentes) for (const s of x.scores) { nCand++; parBranche[s.branche] = (parBranche[s.branche] || 0) + 1; }
    const brancheVerite = {}; for (const x of presentes) { const b = x.scores.find(s => s.id === x.attendu)?.branche; brancheVerite[b] = (brancheVerite[b] || 0) + 1; }
    console.log(`   branches OBSERVÉES sur ${nCand} candidats des ${presentes.length} lignes (vérité présente) : ${JSON.stringify(parBranche)}`);
    console.log(`   branche de la VÉRITÉ : ${JSON.stringify(brancheVerite)}`);
    console.log('   (table exacte du terme : voir l\'en-tête BRANCHES — aucune valeur négative, la pénalité est un +25 refusé)');
    console.log('   ⚠️ témoin externe pour (c) : 2026-09-04, 221 lignes de journal, même vivier — 6 refus pour 1 gain, 219 gagnants inchangés.\n');
    const entete = `   ${'régime'.padEnd(34)} juste  faux  faux·marge≥30(proxy)  refus(égalité)  absente | rang strict 1 / 2 / 3 / 4-10 / >10 | position affichée ≤ 3 | vérité au sommet : n, taille médiane`;
    console.log(entete);
    for (const [nom, regime] of Object.entries(REGIMES)) {
        const res = presentes.map(x => rejouerRegime(x.scores, x.attendu, regime));
        const c = { juste: 0, faux: 0, refus: 0, absente: 0 }; let fml = 0;
        const rb = { 1: 0, 2: 0, 3: 0, '4-10': 0, '>10': 0 }; let pos3 = 0; const sommets = [];
        for (const r of res) {
            c[r.issue]++; if (r.fauxMargeLarge) fml++;
            if (r.rang != null) rb[r.rang === 1 ? 1 : r.rang === 2 ? 2 : r.rang === 3 ? 3 : r.rang <= 10 ? '4-10' : '>10']++;
            if (r.position != null && r.position <= 3) pos3++;
            if (r.dansSommet) sommets.push(r.tailleSommet);
        }
        console.log(`   ${nom.padEnd(34)} ${String(c.juste).padStart(5)} ${String(c.faux).padStart(5)} ${String(fml).padStart(21)} ${String(c.refus).padStart(15)} ${String(c.absente).padStart(8)} | ${rb[1]} / ${rb[2]} / ${rb[3]} / ${rb['4-10']} / ${rb['>10']} | ${String(pos3).padStart(3)} | ${sommets.length}, ${med(sommets) ?? '—'}`);
    }
    console.log('   « position affichée » = rang après le tri de production : score, puis le MOINS CHER. C\'est');
    console.log('   ce que voit l\'utilisateur quand la route montre les 3 premiers. Une vérité chère à égalité passe DERRIÈRE.');
    console.log('\n   Les lignes à écart 25 (mesure 2), position AFFICHÉE de la vérité par régime — référence / (a) / (b) / (c) :');
    for (const x of exact25) {
        const pos = Object.values(REGIMES).map(r => { const q = rejouerRegime(x.scores, x.attendu, r); return `${q.position}${q.dansSommet ? `(sommet de ${q.tailleSommet})` : ''}`; });
        console.log(`     ${x.cle.padEnd(6)} ${String(x.d.nom).padEnd(18)} ${eur(x.prixVerite).padStart(9)}  ${pos.join('  /  ')}`);
    }

    // ══ MESURE 4 — LA BRANCHE QUAND LA RARETÉ EST ABSENTE ══
    console.log('\n══ MESURE 4 — « incohérent avec rareté lue » quand la rareté n\'a PAS été lue ══');
    // 4a. Le code, à nu : deux candidats, une lecture sans rareté.
    const luSans = { numero: null, rarete: null, rareteElevee: false, regionAttendue: null };
    const luNormale = { ...luSans, rarete: 'normale' };
    for (const [etiquette, lu] of [['rarete = null', luSans], ['rarete = \'normale\'', luNormale]]) {
        const cher = S.scorerCandidat({ idProduct: 1, prix: 23.08 }, lu), pasCher = S.scorerCandidat({ idProduct: 2, prix: 0.05 }, lu);
        console.log(`   ${etiquette.padEnd(20)} candidat 23,08 € -> « ${cher.detail.prix} » · candidat 0,05 € -> « ${pasCher.detail.prix} »`);
    }
    // 4b. Sur les 109 lignes, rejouées avec rarete = null : la branche de chaque candidat change-t-elle ?
    const parRarete = {};
    let lignesChangees = 0, veriteIncoherenteNull = 0, veriteIncoherenteRef = 0;
    for (const x of presentes) {
        const r = x.d.rarete ?? 'null';
        parRarete[r] = parRarete[r] || { lignes: 0, changees: 0 };
        parRarete[r].lignes++;
        const change = x.scores.some(s => x.branchesNull.get(s.id) !== s.branche);
        if (change) { lignesChangees++; parRarete[r].changees++; }
        if (x.branchesNull.get(x.attendu) === 'incoherent') veriteIncoherenteNull++;
        if (x.scores.find(s => s.id === x.attendu)?.branche === 'incoherent') veriteIncoherenteRef++;
    }
    console.log(`   lignes dont AU MOINS un candidat change de branche quand rarete passe à null : ${lignesChangees} sur ${presentes.length}`);
    for (const [r, v] of Object.entries(parRarete)) console.log(`      rareté journal « ${r} » : ${v.changees} changée(s) sur ${v.lignes}`);
    console.log(`   vérité en branche « incohérent avec rareté lue » : référence ${veriteIncoherenteRef} · rarete=null ${veriteIncoherenteNull} (sur ${presentes.length})`);
    console.log('   -> avec rarete=null, `rareteElevee` est false et le terme prend la branche « carte normale » : il pénalise');
    console.log('      le candidat cher exactement comme si « normale » avait été LUE. Seule la ligne promo change (le');
    console.log('      terme cesse d\'être neutralisé). Rien n\'est câblé ici : c\'est le comportement actuel, mesuré.');

    // ══ MESURE 5 — LE TRI D'ÉGALITÉ, PAS LE TERME ══
    // D'OÙ VIENT LE TRI (scoring.js, choisirMeilleur) : « À SCORE ÉGAL, on prend le MOINS CHER —
    // décision produit assumée » : quand plusieurs variantes V d'un même numéro coexistent et
    // que rien ne dit laquelle porte le motif spécial, on choisit la BORNE BASSE parce que
    // surestimer fait SURPAYER (xASC 153 : V1 1,53 € / V2 0,35 €, test 16). Un prix inconnu
    // ou nul passe en dernier. Et, dans le même fichier (« LE PRIX N'EST JAMAIS UNE PREUVE »),
    // la règle qui borne sa portée : le prix ne désigne jamais un candidat ; sur une égalité à
    // enjeu (écart ≥ 1 €) la route REFUSE. Le tri ne décide donc que : l'ordre de `classement`
    // et de `candidats` (ce que l'utilisateur VOIT), et le gagnant des égalités sans enjeu.
    console.log('\n══ MESURE 5 — le TRI d\'égalité : « moins cher d\'abord » contre quatre autres, combiné aux deux termes ══');
    console.log('   Le verdict de ligne (juste / faux / refus) ne dépend PAS du tri : une égalité au sommet est un refus quel');
    console.log('   que soit l\'ordre. Ce qui en dépend : la POSITION AFFICHÉE de la vérité, et QUI est montré en premier.');
    const TRIS = {
        'moins cher d\'abord (production)': (a, b) => prixTri(a.prix) - prixTri(b.prix),
        '(a) ordre stable du vivier (Mongo)': (a, b) => a.ordreVivier - b.ordreVivier,
        '(b) plus cher d\'abord': (a, b) => (b.prix > 0 ? b.prix : -1) - (a.prix > 0 ? a.prix : -1),
        '(c1) idProduct croissant (entrée au catalogue)': (a, b) => a.id - b.id,
        '(c2) table vintage d\'abord, puis vivier': (a, b) => (Number(b.vintage) - Number(a.vintage)) || (a.ordreVivier - b.ordreVivier)
    };
    const TERMES = { 'terme de référence': REGIMES['référence'], 'terme (c) neutralisé': REGIMES['(c) terme entier neutralisé'] };
    console.log('   (c) critère NON MONÉTAIRE disponible : `idProduct` (toujours présent, ordre total ; `dateAdded` porte la même');
    console.log('   information à 88 %, à partir de 2015) et la table close EXPANSIONS_VINTAGE (JP seulement — c\'est le périmètre).');
    console.log('   Le rang 1 par le numéro, la région, le code : déjà dans le score, donc identiques entre ex aequo.\n');
    for (const [nomTerme, terme] of Object.entries(TERMES)) {
        console.log(`   ── ${nomTerme} ──`);
        console.log(`   ${'tri'.padEnd(48)} pos.1  top3  | 1er ≠ vérité : plus cher / moins cher / sans prix | prix médian du 1er affiché | vérité au sommet`);
        for (const [nomTri, tri] of Object.entries(TRIS)) {
            let pos1 = 0, top3 = 0, plusCher = 0, moinsCher = 0, sansPrix = 0, sommet = 0; const prix1 = [];
            for (const x of presentes) {
                const re = x.scores.map(s => ({ ...s, score: s.score - REGIMES['référence'](s.branche) + terme(s.branche) }))
                    .sort((a, b) => (b.score - a.score) || tri(a, b));
                const iv = re.findIndex(s => s.id === x.attendu);
                if (iv === 0) pos1++;
                if (iv >= 0 && iv < 3) top3++;
                if (re[0].score === re[iv].score) sommet++;
                const premier = re[0];
                if (typeof premier.prix === 'number' && premier.prix > 0) prix1.push(premier.prix);
                if (premier.id !== x.attendu) {
                    if (!(typeof premier.prix === 'number' && premier.prix > 0) || x.prixVerite == null) sansPrix++;
                    else if (premier.prix > x.prixVerite) plusCher++; else moinsCher++;
                }
            }
            console.log(`   ${nomTri.padEnd(48)} ${String(pos1).padStart(4)}  ${String(top3).padStart(4)}  | ${String(plusCher).padStart(11)} / ${String(moinsCher).padStart(10)} / ${String(sansPrix).padStart(9)} | ${eur(med(prix1)).padStart(12)} | ${sommet}`);
        }
        console.log('');
    }
    console.log('   « 1er ≠ vérité, plus cher » = ce que « plus cher d\'abord » risque : montrer en tête une carte fausse ET plus');
    console.log('   chère que la vraie (surpayer). « moins cher » = l\'erreur du tri actuel (sous-estimer, rater la bonne affaire).');
    console.log('   ⛔ « PLUS CHER D\'ABORD » EST ÉCARTÉ DÉFINITIVEMENT (2026-09-08) : 43 premiers faux ET plus chers sur 107. Ne pas reproposer.');

    // ══ MESURE 6 — LES DEUX TRIS SÉPARÉS : « même carte » -> moins cher ; cartes différentes -> vivier ══
    // ⚠️ UN ORDRE TOTAL, PAS UN COMPARATEUR À DEUX TÊTES. « si même carte : prix, sinon : vivier »
    // écrit comme un comparateur n'est PAS transitif (a~b même carte, c différent : a<c et c<b par
    // le vivier, b<a par le prix -> cycle). La forme sûre est une clé LEXICOGRAPHIQUE :
    //   (score desc, rang du GROUPE dans le vivier asc, prix asc — inconnu dernier, idProduct asc)
    // où le groupe est la classe d'équivalence « même carte » et son rang la plus petite position
    // de ses membres dans le vivier. Chaque candidat appartient à UN groupe : l'ordre est total et
    // déterministe par construction, quel que soit le point de comparaison.
    // DEUX CRITÈRES DE « MÊME CARTE » sont mesurés : (E+N) même expansion ET même numéro Cardmarket
    // — c'est LITTÉRALEMENT le cas de la décision B (variantes V d'un même numéro) ; (M) même
    // idMetacard — plus large (les 4 Rayquaza ASC/xASC partagent 456957 à travers deux expansions).
    // Un candidat sans numéro (E+N) ou sans idMetacard (M) est SEUL dans son groupe : « même carte »
    // ne se présume pas d'une donnée absente.
    console.log('\n══ MESURE 6 — les deux tris séparés : « même carte » -> moins cher (inchangé) ; sinon -> ordre du vivier ══');
    const cleEN = s => (s.numeroCardmarket != null && String(s.numeroCardmarket).trim() !== '') ? `E${s.idExpansion}#${String(s.numeroCardmarket).trim().toUpperCase()}` : `seul:${s.id}`;
    const cleM = s => (s.idMetacard != null) ? `M${s.idMetacard}` : `seul:${s.id}`;
    // Couverture des deux critères, sur tous les candidats des 107 lignes.
    let nEN = 0, nM = 0, nTot = 0;
    for (const x of presentes) for (const s of x.scores) { nTot++; if (!cleEN(s).startsWith('seul:')) nEN++; if (!cleM(s).startsWith('seul:')) nM++; }
    console.log(`   couverture : numéro Cardmarket présent ${nEN}/${nTot} candidats · idMetacard présent ${nM}/${nTot}`);
    // Les deux critères s'accordent-ils sur les paires à ÉGALITÉ DE SCORE AU SOMMET ?
    let pairesSommet = 0, memeEN = 0, memeM = 0, ENpasM = 0, MpasEN = 0;
    for (const x of presentes) {
        const top = x.scores.filter(s => s.score === x.scores[0].score);
        for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
            pairesSommet++;
            const en = cleEN(top[i]) === cleEN(top[j]), m = cleM(top[i]) === cleM(top[j]);
            if (en) memeEN++; if (m) memeM++; if (en && !m) ENpasM++; if (m && !en) MpasEN++;
        }
    }
    console.log(`   paires d'ex aequo au sommet (terme de référence) : ${pairesSommet} · même carte selon E+N : ${memeEN} · selon M : ${memeM} · E+N sans M : ${ENpasM} · M sans E+N : ${MpasEN}`);
    const trierMixte = (liste, cle) => {
        const rangGroupe = new Map();
        for (const s of liste) { const k = cle(s); rangGroupe.set(k, Math.min(rangGroupe.get(k) ?? Infinity, s.ordreVivier)); }
        return [...liste].sort((a, b) => (b.score - a.score) || (rangGroupe.get(cle(a)) - rangGroupe.get(cle(b))) || (prixTri(a.prix) - prixTri(b.prix)) || (a.id - b.id));
    };
    // Le test 16, rejoué sur le tri mixte : les deux xASC 153 (même expansion, même numéro, même
    // métacarte) doivent rester « le moins cher en tête ».
    {
        const t16 = [
            { id: 870373, score: 100, prix: 1.53, ordreVivier: 0, idExpansion: 6455, numeroCardmarket: '153', idMetacard: 456957 },
            { id: 870374, score: 100, prix: 0.35, ordreVivier: 1, idExpansion: 6455, numeroCardmarket: '153', idMetacard: 456957 }
        ];
        console.log(`   test 16 sur le tri mixte : E+N -> ${trierMixte(t16, cleEN)[0].id} · M -> ${trierMixte(t16, cleM)[0].id}   (attendu 870374 : ${trierMixte(t16, cleEN)[0].id === 870374 && trierMixte(t16, cleM)[0].id === 870374 ? '✅' : '❌ ANNULER'})`);
    }
    for (const [nomTerme, terme] of Object.entries(TERMES)) {
        console.log(`\n   ── ${nomTerme} ──`);
        console.log(`   ${'tri'.padEnd(44)} pos.1  top3  | 1er faux ET plus cher : total / dont MÊME carte que la vérité (variante) / carte différente | prix médian du 1er`);
        const tris = {
            'moins cher d\'abord (production)': l => [...l].sort((a, b) => (b.score - a.score) || (prixTri(a.prix) - prixTri(b.prix))),
            'mixte E+N : même exp.+numéro -> prix, sinon vivier': l => trierMixte(l, cleEN),
            'mixte M : même idMetacard -> prix, sinon vivier': l => trierMixte(l, cleM)
        };
        for (const [nomTri, tri] of Object.entries(tris)) {
            let pos1 = 0, top3 = 0, fauxCher = 0, fauxCherVariante = 0; const prix1 = [];
            const cle = nomTri.startsWith('mixte M') ? cleM : cleEN;
            for (const x of presentes) {
                const re = tri(x.scores.map(s => ({ ...s, score: s.score - REGIMES['référence'](s.branche) + terme(s.branche) })));
                const iv = re.findIndex(s => s.id === x.attendu);
                if (iv === 0) pos1++;
                if (iv >= 0 && iv < 3) top3++;
                const premier = re[0];
                if (typeof premier.prix === 'number' && premier.prix > 0) prix1.push(premier.prix);
                if (premier.id !== x.attendu && typeof premier.prix === 'number' && premier.prix > 0 && x.prixVerite != null && premier.prix > x.prixVerite) {
                    fauxCher++;
                    if (cle(premier) === cle(re[iv])) fauxCherVariante++;
                }
            }
            console.log(`   ${nomTri.padEnd(44)} ${String(pos1).padStart(4)}  ${String(top3).padStart(4)}  | ${String(fauxCher).padStart(5)} / ${String(fauxCherVariante).padStart(38)} / ${String(fauxCher - fauxCherVariante).padStart(16)} | ${eur(med(prix1))}`);
        }
    }
    console.log('   Les verdicts juste / faux / refus ne dépendent pas du tri (voir mesure 5) ; ils sont ceux de la mesure 3.');

    // ══ MESURE 7 — L'ORDRE RÉELLEMENT RENDU PAR LA PRODUCTION (après câblage, ce que l'écran montre) ══
    // Aucun re-tri ici : `r.scores` tel que choisirMeilleur le rend, avec la rareté du journal, puis
    // avec la rareté ABSENTE (la projection post-déploiement : le terme y est neutre depuis le câblage).
    console.log('\n══ MESURE 7 — l\'ordre rendu par choisirMeilleur, tel quel (rien de re-trié ici) ══');
    for (const [etiquette, champ] of [['rareté du journal (aujourd\'hui)', 'ordreProd'], ['rareté ABSENTE (projection post-déploiement)', 'ordreNull']]) {
        let pos1 = 0, top3 = 0, dusAuTri = 0; const fautifs = [];
        for (const x of presentes) {
            const o = x[champ];
            const iv = o.findIndex(s => s.id === x.attendu);
            if (iv === 0) pos1++;
            if (iv >= 0 && iv < 3) top3++;
            const premier = o[0];
            if (premier.id !== x.attendu && typeof premier.prix === 'number' && premier.prix > 0 && x.prixVerite != null && premier.prix > x.prixVerite) {
                // Le premier sous l'ANCIEN tri (score, puis le moins cher), recalculé sur les mêmes
                // scores : c'est lui qui dit si ce premier faux est DÛ au nouveau tri ou s'il était
                // déjà là. Un premier qui mène de 45 points ne doit rien au tri ; un premier choisi
                // dans une égalité peut en changer.
                const ancien = [...o].sort((a, b) => (b.score - a.score) || (prixTri(a.prix) - prixTri(b.prix)))[0];
                const change = ancien.id !== premier.id;
                if (change) dusAuTri++;
                fautifs.push(`${x.cle} ${x.d.nom} : 1er ${premier.id} « ${premier.nom} » ${eur(premier.prix)} · vérité ${x.attendu} ${eur(x.prixVerite)} (position ${iv + 1}, écart de score ${premier.score - o[iv].score}) · ancien tri : 1er ${ancien.id} ${eur(ancien.prix)} -> ${change ? 'CHANGÉ PAR LE TRI' : 'déjà premier, pas dû au tri'}`);
            }
        }
        console.log(`   ${etiquette.padEnd(46)} pos.1 ${pos1} · vérité dans le TOP 3 affiché ${top3} / ${presentes.length} · 1er faux ET plus cher ${fautifs.length}, dont dus au nouveau tri ${dusAuTri}`);
        for (const f of fautifs) console.log(`      ${f}`);
    }
    await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
