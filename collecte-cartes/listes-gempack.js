// ============================================================
// GEM PACK : LES LISTES ANGLAISES DU CACHE -> LES CIBLES DE LA PREUVE PAR LE SET (module sans réseau, sans base : il LIT des fichiers du cache)
// ============================================================
// UNE SEULE définition pour la simulation d'écriture et l'écriture (§21 bis) : lire SC + PC + ppr en cache, croiser, et fabriquer la cible que `ecrire-fiches-preuve-set.jugerTout` juge (`tolerance: true` :
// décision de l'éditeur du 31/10, une faute d'orthographe corroborée par les quatre conditions de tolerance-orthographe.js). Rien n'est jamais téléchargé ici.
const fs = require('fs'), path = require('path');
const G = require('./sources-gempack');
const FPS = require('./fiches-preuve-set');

const RACINE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8';
const SETS = Object.freeze([
    { code: 'CBB4C', exp: 6447, nom: 'Gem Pack Vol. 4 (CBB4C)', slug: 'gem-pack-vol-4-card-list' },
    { code: 'CBB5C', exp: 6544, nom: 'Gem Pack Vol. 5 (CBB5C)', slug: 'gem-pack-vol-5-card-list' },
    { code: 'CBB6C', exp: 6669, nom: 'Gem Pack Vol. 6 (CBB6C)', slug: 'gem-pack-vol-6-card-list' }
]);

const lireTry = (f, lecteur) => { try { return { v: lecteur(fs.readFileSync(f, 'utf8')) }; } catch (e) { return { erreur: e.message }; } };

/**
 * @param {{codes?: string[], racine?: string, produitsDe: (exp:number)=>Array<{idProduct:number,name:string,numero:string|null}>, base: object}} o   `base` = FPS.chargerSources(...) (traduire, cleProduit, SETS)
 * @returns {{cibles: object[], SETSL: object, parSet: object[]}}   parSet : le bilan du croisement, set par set (dit pourquoi un set n'a pas de cible)
 */
function preparerListes({ codes = SETS.map(s => s.code), racine = RACINE, produitsDe, base }) {
    const cache = path.join(racine, 'GEMPACK-SOURCES', 'cache');
    const ppr = JSON.parse(fs.readFileSync(path.join(racine, 'RECOLTE', 'releves-ppr.json'), 'utf8'));
    const cibles = [], SETSL = {}, parSet = [];
    for (const s of SETS.filter(x => codes.includes(x.code))) {
        const produits = produitsDe(s.exp).map(p => ({ idProduct: p.idProduct, name: p.name, numero: p.numero ?? null }));
        const sc = lireTry(path.join(cache, `sc-${s.slug}.html`), G.lireSimplifiedCollector), pc = lireTry(path.join(cache, `pc-${s.slug}.html`), G.lirePokeCottage);
        const rendu = { code: s.code, exp: s.exp, nom: s.nom, produits: produits.length };
        parSet.push(rendu);
        if (sc.erreur || pc.erreur) { rendu.verdict = 'TOMBÉ'; rendu.motif = `liste illisible : ${sc.erreur || pc.erreur}`; continue; }
        const p = ppr[s.code] ? G.lirePpr(ppr[s.code]) : null;
        const pg = {};
        for (const pr of produits) { const kk = String(pr.numero ?? '').replace(/^0+/, ''); const g = (pg[kk] ||= { noms: new Set(), effectif: 0 }); g.noms.add(base.cleProduit(pr.name)); g.effectif++; }
        const cr = G.croiserSources({ sc: sc.v, pc: pc.v, ppr: p, attendu: produits.length, produitsParGroupe: pg, cleNom: base.cleProduit });
        rendu.croisement = { ok: cr.ok, couverture: cr.couverture, reserves: cr.reserves.map(r => r.type), discordances: cr.discordances.length };
        if (!cr.ok) { rendu.verdict = 'TOMBÉ'; rendu.motif = `le croisement des trois listes discorde (${cr.discordances.length})`; continue; }
        const etiquette = `liste-externe:${s.code}`;
        SETSL[etiquette] = { etiquette, cartes: G.listeDuSet(cr) };
        cibles.push({ nom: s.nom, exp: s.exp, kado: [[etiquette, '']], groupeDe: FPS.groupeGem, role: 'vise', calibrable: true, etiquetteRef: etiquette, tolerance: true });
    }
    return { cibles, SETSL, parSet };
}

module.exports = { SETS, RACINE, preparerListes };
