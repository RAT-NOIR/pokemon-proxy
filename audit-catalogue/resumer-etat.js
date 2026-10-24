'use strict';
// node audit-catalogue/resumer-etat.js — les classes de fiche et de visuel VENTILÉES par langue du tirage, famille, type de set, tamponnée (relit etat-produits.json et mesure-sets.json ; aucune base).
// Écrit S8\AUDIT\resume-ventile.json. Chaque tableau imprime son dénominateur.
const { lireJson, ecrireJson } = require('./ecrire');

const produits = lireJson('etat-produits.json'), sets = lireJson('mesure-sets.json').lignesSet;
const setDe = new Map(sets.map(l => [l.idExpansion, l]));
const manquants = produits.filter(p => !setDe.has(p.idExpansion));
if (manquants.length) throw new Error(`${manquants.length} produits dont l'expansion n'est pas dans mesure-sets.json : la clé de jointure est fausse (§41)`);
const ventiler = (cle) => {
    const m = new Map();
    for (const p of produits) {
        const k = cle(setDe.get(p.idExpansion)), e = m.get(k) || { produits: 0, fiche: {}, visuel: {}, ficheMotifs: {}, visuelMotifs: {} };
        e.produits++; e.fiche[p.fiche.classe] = (e.fiche[p.fiche.classe] || 0) + 1; e.visuel[p.visuel.classe] = (e.visuel[p.visuel.classe] || 0) + 1;
        for (const mo of p.fiche.motifs) e.ficheMotifs[mo] = (e.ficheMotifs[mo] || 0) + 1;
        if (p.visuel.classe === 'MANQUANT' || p.visuel.classe === 'EMPRUNTE') for (const mo of p.visuel.motifs) e.visuelMotifs[mo] = (e.visuelMotifs[mo] || 0) + 1;
        m.set(k, e);
    }
    return Object.fromEntries([...m].sort((a, b) => b[1].produits - a[1].produits));
};
const sortie = { le: new Date().toISOString(), denominateur: produits.length, parLangue: ventiler(s => s.langue), parFamille: ventiler(s => s.famille), parType: ventiler(s => s.type || 'non-type'), parTamponnee: ventiler(s => (s.tamponnee ? `tamponnee:${s.tamponnee}` : 'ordinaire')) };
// les sets qui portent chaque motif de fiche douteuse
const parSet = (motif) => { const m = new Map(); for (const p of produits) if (p.fiche.motifs.includes(motif)) m.set(p.setId, (m.get(p.setId) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 12); };
sortie.setsParMotif = { 'sans-numero': parSet('sans-numero'), 'preuve-nom-seul': parSet('preuve-nom-seul') };
const parClasse = (classe, motif) => { const m = new Map(); for (const p of produits) if (p.visuel.classe === classe && (!motif || p.visuel.motifs.includes(motif))) m.set(p.setId || `exp:${p.idExpansion}`, (m.get(p.setId || `exp:${p.idExpansion}`) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 12); };
sortie.setsParClasseVisuel = { 'MANQUANT/aucun-visuel': parClasse('MANQUANT', 'aucun-visuel'), 'EMPRUNTE': parClasse('EMPRUNTE'), 'BASSE_DEFINITION': parClasse('BASSE_DEFINITION') };
ecrireJson('resume-ventile.json', sortie, { indent: 1 });
console.log(`DÉNOMINATEUR ${produits.length} produits`);
for (const k of ['parLangue', 'parFamille', 'parType', 'parTamponnee']) {
    console.log(`\n── ${k}`);
    for (const [nom, e] of Object.entries(sortie[k])) console.log(`${nom.padEnd(24)} ${String(e.produits).padStart(6)} · fiche ${JSON.stringify(e.fiche)} · visuel ${JSON.stringify(e.visuel)}`);
}
console.log('\nsets par motif de fiche :', JSON.stringify(sortie.setsParMotif));
console.log('sets par classe de visuel :', JSON.stringify(sortie.setsParClasseVisuel));
