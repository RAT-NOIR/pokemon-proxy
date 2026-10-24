// ============================================================
// LES RELEVÉS LOCAUX D'UNE SECONDE SOURCE (PHASE 3a, 2026-10-24) — PikaQian (pages passives + fiches apprises), et la CALIBRATION de leur rattachement à nos sets
// ============================================================
// Un relevé = { source, set (notre slug), numero, nom, ref }. Le rattachement code PikaQian → notre set est la table du dépôt (`pikaqian-sets.json` : codePk → slug), JAMAIS un
// appariement par le nom. 🔑 Un rattachement n'est cru que s'il est PROUVÉ sur ce qu'on connaît : pour chaque set, les produits DÉJÀ JOINTS (leur numéro et leur nom viennent de
// Cardmarket, leur ligne a été vérifiée) sont comparés au relevé ; un set qui contredit un produit joint (même numéro, autre nom) ou qui en confirme moins de MIN_ACCORDS n'est
// PAS calibré, et aucun de ses relevés ne sert de seconde source. Écrit par ce qu'il autorise : `calibres` est la liste fermée des sets prouvés.
const fs = require('fs');
const path = require('path');
const { cleNumero } = require('./jointure');
const { memeNom } = require('./deux-sources');

const MIN_ACCORDS = 20;
/** @param {string} dossier le dossier `catalogue` (pikaqian-passif/, pikaqian/apprises/) @param {Array<{codePk:string, slug:string}>} table @returns {{releves: object[], pagesSansSet: string[], pages: number}} */
function relevesPikaqian(dossier, table) {
    const slugDe = new Map(table.map(l => [l.codePk, l.slug]));
    const releves = [], sansSet = new Set(); const vus = new Set(); let pages = 0;
    const lire = f => JSON.parse(fs.readFileSync(f, 'utf8'));
    const ajouter = (page, j, origine) => {
        const slug = slugDe.get(page); pages++;
        if (!slug) { sansSet.add(page); return; }
        for (const t of j.tuiles || j.fiches || []) {
            if (t.numero == null || String(t.numero).trim() === '' || !t.nom) continue;
            const k = `${slug}|${cleNumero(String(t.numero))}|${t.id ?? t.nom}`;
            if (vus.has(k)) continue; vus.add(k);                       // la même tuile vue par deux relevés n'est pas deux relevés
            releves.push({ source: 'pikaqian', set: slug, numero: String(t.numero), nom: t.nom, ref: `pikaqian/${page}/${t.id ?? t.numero}` });
        }
    };
    const passif = path.join(dossier, 'pikaqian-passif'), apprises = path.join(dossier, 'pikaqian', 'apprises');
    if (fs.existsSync(passif)) for (const d of fs.readdirSync(passif, { withFileTypes: true })) if (d.isDirectory()) for (const f of fs.readdirSync(path.join(passif, d.name))) if (f.endsWith('.json')) ajouter(d.name, lire(path.join(passif, d.name, f)), 'passif');
    if (fs.existsSync(apprises)) for (const f of fs.readdirSync(apprises)) { const j = lire(path.join(apprises, f)); if (j.code) ajouter(j.code, j, 'apprises'); }
    return { releves, pagesSansSet: [...sansSet].sort(), pages };
}

/**
 * La calibration, par set. @param {object[]} releves  @param {Array<{idProduct:number, set:string, numero:string|null, nom:string}>} joints  les produits DÉJÀ JOINTS (vérité connue de Cardmarket)
 * @returns {{parSet: Object, calibres: string[]}}
 */
function calibrer(releves, joints, { minAccords = MIN_ACCORDS } = {}) {
    const index = new Map();
    for (const r of releves) { const k = `${r.set}|${cleNumero(String(r.numero))}`; (index.get(k) || index.set(k, []).get(k)).push(r); }
    const parSet = {};
    const setsReleves = new Set(releves.map(r => r.set));
    for (const p of joints) {
        if (!setsReleves.has(p.set)) continue;
        const s = (parSet[p.set] ||= { compares: 0, accords: 0, conflits: 0, sansReleve: 0, exemplesConflit: [] });
        if (p.numero == null || String(p.numero).trim() === '') continue;
        const rs = index.get(`${p.set}|${cleNumero(String(p.numero))}`) || [];
        if (!rs.length) { s.sansReleve++; continue; }
        s.compares++;
        if (rs.some(r => memeNom(p.nom, r.nom))) s.accords++;
        else { s.conflits++; if (s.exemplesConflit.length < 5) s.exemplesConflit.push(`${p.idProduct} n°${p.numero} « ${p.nom} » / relevé « ${rs.map(r => r.nom).join(' | ')} »`); }
    }
    const calibres = Object.entries(parSet).filter(([, s]) => s.conflits === 0 && s.accords >= minAccords).map(([k]) => k).sort();
    return { parSet, calibres };
}

module.exports = { relevesPikaqian, calibrer, MIN_ACCORDS };
