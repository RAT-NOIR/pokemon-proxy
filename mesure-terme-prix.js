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
    await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
