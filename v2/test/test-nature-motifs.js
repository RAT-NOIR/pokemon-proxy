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
async function vingtEtUn(motif) {
    const p = await inst({ essais: 0, achete: 0 }); const issues = [];
    for (let i = 0; i < 21; i++) {
        const q = await requete(p, `nm-${motif}-${i}`.replace(/[^A-Za-z0-9-]/g, '_'));
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
    // la fonction elle-même : deux listes fermées, un motif inconnu du côté constat
    {
        H.v('D1. natureDuMotif : panne-*, ia-echec, erreur-serveur, tcgdex-injoignable => panne ; le reste, introuvable', [N.natureDuMotif('panne-X'), N.natureDuMotif('ia-echec'), N.natureDuMotif('erreur-serveur'), N.natureDuMotif('tcgdex-injoignable'), N.natureDuMotif('introuvable'), N.natureDuMotif('?'), N.natureDuMotif(undefined), N.natureDuMotif({})], ['panne', 'panne', 'panne', 'panne', 'introuvable', 'introuvable', 'introuvable', 'introuvable']);
        // le ledger ne rabat plus un compteur absent sur `panne` : il demande à la fonction
        const p = await inst({ essais: 0, achete: 0 }); const cr = []; for (let i = 0; i < 21; i++) { const sc = `ld${i}`; const d = await Lg.debiter(p, { scanId: sc, cleIdempotence: `d|${sc}`, maintenant: t }, cfg); cr.push(d.credit); }
        const out = []; for (let i = 0; i < 21; i++) { const r = await Lg.rembourser(p, cr[i], 'carte-introuvable', { scanId: `ld${i}`, maintenant: t }, cfg); out.push(r.rendu ? 'rendu' : r.raisonNonRembourse); }
        H.v('D2. ledger.rembourser SANS compteur et motif de constat : plafonné (le défaut `panne` a disparu)', out, [...rep(20, 'rendu'), 'plafond-jour']);
    }
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
