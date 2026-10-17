'use strict';
// FREIN-CONSTATES tour 2 (relecture 1, I1/M2) — UNE fonction `natureDuMotif(motif)` décide, pour tout remboursement qui ne nomme pas sa nature (la chaîne héritée, par le pont), s'il est HORS plafond
// (panne de NOTRE côté) ou PLAFONNÉ (constat sur la photo). Un cas par motif que le code émet aujourd'hui (index.js : rembourserScan ; v2 : routes, lot, questions), passé par le PONT, avec une installation
// sans compte (plafond des constatés 20) : le 21e scan est rendu pour une panne de notre côté, refusé (plafond-jour) pour un constat. Un motif INCONNU est plafonné, compté et journalisé sans donnée de scan.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const registre = require('../registre');
delete process.env.CODE_ILLIMITE;
const acces = require('../../acces'); const { dansUnScan, raisonNonRemboursement } = require('../../sources');
const Lg = require('../argent/ledger'); const Pont = require('../argent/pont-acces');
const { inst } = require('./_aide-argent'); const Q = require('./_aide-quota');
const cfg = Q.cfgGrand({ V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');
const MOTIFS_PANNE = ['ia-echec', 'erreur-serveur', 'tcgdex-injoignable', 'panne-INDISPONIBLE', 'panne-SERVEUR', 'panne-IA', 'arret-serveur', 'depense-modele-plafond'];
const MOTIFS_CONSTAT = ['introuvable', 'numero-illisible', 'carte-introuvable', 'aucun-prix', 'aucun-candidat', 'nom-contredit-egalite', 'nom-contredit-sans-repli', 'egalite-parfaite', 'sans-prix'];
async function requete(p, scanId) {
    const d = await Lg.debiter(p, { scanId, cleIdempotence: `d|${scanId}`, maintenant: t }, cfg);
    const req = { body: {}, scanId }; req.credit = Pont.creditPourReq(p, d.credit, cfg, { scanId, maintenant: t }); return req;
}
// 21 scans d'une installation sans compte, tous remboursés avec ce motif PAR LE PONT ; rend les issues
let seq = 0;                                   // une clé de débit neuve par scan : deux séries du même motif n'ont pas le même porteur
async function vingtEtUn(motif) {
    const p = await inst({ essais: 0, achete: 0 }); const issues = [];
    for (let i = 0; i < 21; i++) {
        const q = await requete(p, `nm${++seq}-${motif}-${i}`.replace(/[^A-Za-z0-9-]/g, '_'));
        const r = await dansUnScan(async () => ({ rendu: await acces.rembourserScan(q, motif), cause: raisonNonRemboursement() }));
        issues.push(r.rendu ? 'rendu' : r.cause);
    }
    return issues;
}
const rep = (n, x) => Array(n).fill(x);
const capter = async f => { const l = []; const w = console.warn, e = console.error; console.warn = console.error = (...a) => { l.push(a.join(' ')); }; try { return { r: await f(), lignes: l }; } finally { console.warn = w; console.error = e; } };

(async () => {
    await H.ouvrirBac('test-nature-motifs.js'); await M.creerIndex();
    for (const m of MOTIFS_PANNE) H.v(`A. pont, motif « ${m} » (panne de NOTRE côté) : sans compte, les 21 sont rendus (hors plafond)`, await vingtEtUn(m), rep(21, 'rendu'));
    for (const m of MOTIFS_CONSTAT) H.v(`B. pont, motif « ${m} » (constat sur la photo) : 20 rendus, le 21e plafond-jour`, await vingtEtUn(m), [...rep(20, 'rendu'), 'plafond-jour']);
    // un motif INCONNU : plafonné (jamais illimité), compté, journalisé sans donnée de scan
    const N = require('../argent/nature-du-motif');
    {
        const avant = N.compteurs().motifInconnu;
        const { r, lignes } = await capter(() => vingtEtUn('motif-jamais-vu-<secret-12345>'));
        H.v('C1. motif INCONNU : plafonné (20 rendus, le 21e plafond-jour)', r, [...rep(20, 'rendu'), 'plafond-jour']);
        H.v('    compteur `motif-inconnu` +21 et une ligne de journal qui ne cite ni scan ni valeur brute', [N.compteurs().motifInconnu - avant, lignes.some(l => /motif-inconnu/.test(l)), lignes.filter(l => /motif-inconnu/.test(l)).some(l => /secret-12345|nm-|scan/i.test(l))], [21, true, false]);
    }
    // ════════ TOUR 3 (relecture 2) ════════
    const { interrogerSource } = require('../../sources');
    // (d, I1) un refus d'ABSENCE prononcé alors qu'une source est TOMBÉE pendant le scan n'est pas un constat sur la photo : panne de notre côté, hors plafond. Le prédicat est unique (sources.js).
    const vingtEtUnSourceTombee = async motif => {
        const p = await inst({ essais: 0, achete: 0 }); const issues = [];
        for (let i = 0; i < 21; i++) {
            const q = await requete(p, `st${++seq}-${motif}-${i}`);
            const r = await dansUnScan(async () => { await interrogerSource('catalogue/nom', async () => { throw new Error('source tombée'); }); return { rendu: await acces.rembourserScan(q, motif), cause: raisonNonRemboursement() }; });
            issues.push(r.rendu ? 'rendu' : r.cause);
        }
        return issues;
    };
    {
        const { r: carte } = await capter(() => vingtEtUnSourceTombee('carte-introuvable')), { r: cand } = await capter(() => vingtEtUnSourceTombee('aucun-candidat'));
        H.v('T3d. pont, « carte-introuvable » avec une source TOMBÉE : absence non constatée = panne, les 21 rendus', carte, rep(21, 'rendu'));
        H.v('    idem « aucun-candidat »', cand, rep(21, 'rendu'));
        const { r: sans } = await capter(() => vingtEtUn('carte-introuvable'));
        H.v('    sans source tombée, « carte-introuvable » reste un constat plafonné (20 rendus, le 21e plafond-jour)', sans, [...rep(20, 'rendu'), 'plafond-jour']);
        const S = require('../../sources');
        H.v('    le prédicat unique : REFUS_D_ABSENCE et absenceNonConstatee viennent de sources.js', [typeof S.absenceNonConstatee, S.REFUS_D_ABSENCE instanceof Set && S.REFUS_D_ABSENCE.has('carte-introuvable'), typeof S.absenceNonConstatee === 'function' ? S.absenceNonConstatee('carte-introuvable') : 'absent'], ['function', true, false]);
    }
    // (a) une photo sans carte : le motif NEUF `ia-sans-lecture` est un constat PLAFONNÉ (le 21e d'une installation sans compte est plafond-jour)
    H.v('T3a. pont, « ia-sans-lecture » (photo sans carte : réponse non JSON, JSON sans name) : 20 rendus, le 21e plafond-jour', await vingtEtUn('ia-sans-lecture'), [...rep(20, 'rendu'), 'plafond-jour']);
    // (b) la vraie panne du fournisseur reste hors plafond
    H.v('T3b. pont, « ia-echec » (panne du fournisseur PROUVÉE) : les 21 rendus', await vingtEtUn('ia-echec'), rep(21, 'rendu'));
    // (c) la coupure de dépense en cours de scan
    H.v('T3c. pont, « depense-modele-plafond » (coupure en cours de scan) : les 21 rendus', await vingtEtUn('depense-modele-plafond'), rep(21, 'rendu'));
    // M1 : valeurs EXACTES, aucun préfixe ouvert
    for (const m of ['panne-SERVEUR', 'panne-INDISPONIBLE', 'panne-IA', 'lot-supplement-verification', 'lot-supplement-en_reconciliation', 'lot-supplement-indisponible'])
        H.v(`T3M1. pont, valeur exacte « ${m} » : hors plafond (21 rendus)`, await vingtEtUn(m), rep(21, 'rendu'));
    {
        const N3 = require('../argent/nature-du-motif'); const avant = N3.compteurs().motifInconnu;
        const a = await capter(() => vingtEtUn('panne-XXX')), b = await capter(() => vingtEtUn('lot-supplement-zzz'));
        H.v('T3e. pont, « panne-XXX » INCONNU : plafonné (20 rendus, le 21e plafond-jour), compté `motifInconnu` et journalisé', [a.r, N3.compteurs().motifInconnu - avant >= 21, a.lignes.some(l => /motif-inconnu/.test(l))], [[...rep(20, 'rendu'), 'plafond-jour'], true, true]);
        H.v('    « lot-supplement-zzz » inconnu : plafonné aussi', b.r, [...rep(20, 'rendu'), 'plafond-jour']);
    }
    // les causes d'une lecture nulle (getCardIdFromAI) : fonctions pures de lecture-de-secours.js, sans réseau
    {
        const L = Object.assign({ causeApresErreur: () => 'absent', causeApresReponse: () => 'absent', motifDuRefusIA: () => 'absent' }, require('../../lecture-de-secours'));     // une fonction absente donne « absent » (rouge lisible), pas une exception
        H.v('T3l. cause d\'une lecture nulle : panne du service classée => fournisseur ; plafond de dépense => depense ; JSON invalide, erreur non classée, contenu non textuel, 200 sans corps d\'erreur => sans-lecture',
            [L.causeApresErreur({ response: { status: 503 } }), L.causeApresErreur({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }), L.causeApresErreur({ code: 'DEPENSE_MODELE_PLAFOND' }), L.causeApresErreur(new SyntaxError('Unexpected token')), L.causeApresErreur({ response: { status: 400 } }), L.causeApresReponse({ error: { code: 502 } }), L.causeApresReponse({ choices: [{ message: { content: null } }] }), L.causeApresReponse({})],
            ['fournisseur', 'fournisseur', 'depense', 'sans-lecture', 'sans-lecture', 'fournisseur', 'sans-lecture', 'sans-lecture']);
        H.v('T3m. motif de la lecture nulle : fournisseur => ia-echec ; depense => depense-modele-plafond ; sans-lecture, cause absente ou inconnue => ia-sans-lecture (plafonné)',
            [L.motifDuRefusIA({ cause: 'fournisseur' }), L.motifDuRefusIA({ cause: 'depense' }), L.motifDuRefusIA({ cause: 'sans-lecture' }), L.motifDuRefusIA({}), L.motifDuRefusIA(null), L.motifDuRefusIA({ cause: 'autre' })],
            ['ia-echec', 'depense-modele-plafond', 'ia-sans-lecture', 'ia-sans-lecture', 'ia-sans-lecture', 'ia-sans-lecture']);
        // index.js ne se charge pas dans un banc (il démarre un serveur) : le texte dit que les DEUX routes passent par le diagnostic et que `getCardIdFromAI` le remplit à tous ses points de sortie nulle
        const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'index.js'), 'utf8');
        H.v('T3t. index.js : les deux routes lisent le diagnostic (motifDuRefusIA) et plus aucun rembourserScan(req, \'ia-echec\') en dur ; la lecture nulle dit sa cause (dire(...)) ; le motif neuf a sa nature et sa phrase',
            [(src.match(/const motifIA = motifDuRefusIA\(diagnosticIA\)/g) || []).length * (src.match(/rembourserScan\(req, motifIA\)/g) || []).length, /rembourserScan\(req, 'ia-echec'\)/.test(src), (src.match(/\bdire\(/g) || []).length >= 5, /'ia-sans-lecture': 'refus-delibere'/.test(src), /'ia-sans-lecture': 'Je n\\'ai pas pu lire cette carte\./.test(src)], [4, false, true, true, true]);
    }
    // la fonction elle-même : deux listes fermées, un motif inconnu du côté constat
    {
        H.v('D1. natureDuMotif : valeurs exactes panne-SERVEUR…, ia-echec, erreur-serveur, tcgdex-injoignable => panne ; le reste (panne-X compris), introuvable', [N.natureDuMotif('panne-SERVEUR'), N.natureDuMotif('ia-echec'), N.natureDuMotif('erreur-serveur'), N.natureDuMotif('tcgdex-injoignable'), N.natureDuMotif('introuvable'), N.natureDuMotif('?'), N.natureDuMotif(undefined), N.natureDuMotif({})], ['panne', 'panne', 'panne', 'panne', 'introuvable', 'introuvable', 'introuvable', 'introuvable']);
        // le ledger ne rabat plus un compteur absent sur `panne` : il demande à la fonction
        const p = await inst({ essais: 0, achete: 0 }); const cr = []; for (let i = 0; i < 21; i++) { const sc = `ld${i}`; const d = await Lg.debiter(p, { scanId: sc, cleIdempotence: `d|${sc}`, maintenant: t }, cfg); cr.push(d.credit); }
        const out = []; for (let i = 0; i < 21; i++) { const r = await Lg.rembourser(p, cr[i], 'carte-introuvable', { scanId: `ld${i}`, maintenant: t }, cfg); out.push(r.rendu ? 'rendu' : r.raisonNonRembourse); }
        H.v('D2. ledger.rembourser SANS compteur et motif de constat : plafonné (le défaut `panne` a disparu)', out, [...rep(20, 'rendu'), 'plafond-jour']);
    }
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
