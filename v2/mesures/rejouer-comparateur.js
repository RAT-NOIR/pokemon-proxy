'use strict';
// SPI-CONTRADICTIONS — REJEU COMPLET du comparateur de PRODUCTION (v2/identifier/comparateur-image.js, pas une copie) sur toutes les paires (ligne, candidat) des trois bancs qui ont une lecture en cache.
//   node v2/mesures/rejouer-comparateur.js [dossier des caches : vivier-lectures.json, resultats-LDA-base.json]
// Lecture seule : aucun réseau, aucune base, aucun appel au modèle. Les caches sont ceux des mesures LANGUE-D-ABORD / VIVIER-IMAGE (archive 27).
// Une CONTRADICTION JUSTE PERDUE = un candidat qui n'est PAS la vérité, que l'ancien comparateur contredisait (au moins un champ ko) et que le nouveau ne contredit plus du tout. Exigence : 0.
// Les JUMEAUX DE LA VÉRITÉ (même nom, même code, même numéro que la vérité) sont comptés à part : la même carte, le même code faux pour elle.
// Le dénominateur s'imprime : lignes lues, sans vérité, paires, candidats faux contredits.
const fs = require('fs'), path = require('path');
const { statuts, CHAMPS } = require('../identifier/garde-contradiction');
const { ajuster } = require('../identifier/comparateur-image');
const dossier = process.argv[2] || 'C:/Users/Yung/rat-market-travail/api/designation';
const lire = f => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));
const V = lire('vivier-lectures.json').lectures, R = lire('resultats-LDA-base.json');
const contredit = st => CHAMPS.some(k => st[k] === 'ko');
const c = { lignes: 0, sansVerite: 0, paires: 0, fauxContredits: 0, perdues: [], jumeauxDeLaVerite: [], veritesCorrigees: 0, reconstruction: 0 };
for (const x of R.ref.filter(r => r.banc !== 'hors-banc')) {
    const v = V[x.cle]; if (!v) continue;
    c.lignes++;
    const verite = Number.isInteger(x.verite) ? x.verite : (x.et && x.et.type === 'sur' && x.et.classe === 'juste' ? x.et.id : null);
    if (verite === null) { c.sansVerite++; continue; }
    const lignes = Object.entries(v.cands).filter(([, k]) => k.statuts && k.ligne !== false).map(([id, k]) => [Number(id), k, { idProduct: Number(id), numero: k.numero, nomCardmarket: k.nom, set: { code: k.code }, tirageSource: k.tirage }]);
    const vrai = v.cands[String(verite)];
    for (const [id, k, ligne] of lignes) {
        c.paires++;
        if (JSON.stringify(statuts(v.lu, ligne)).length && ['numero', 'code', 'attaque', 'symbole', 'langue'].every(f => statuts(v.lu, ligne)[f] === k.statuts[f])) c.reconstruction++;
        const autres = lignes.filter(([i]) => i !== id).map(([, , l]) => l);
        const apres = ajuster(k.statuts, v.lu, ligne, autres);
        const avant = contredit(k.statuts), ainsi = contredit(apres);
        if (id === verite) { if (avant && !ainsi) c.veritesCorrigees++; continue; }
        if (avant) c.fauxContredits++;
        if (avant && !ainsi) {
            const jumeau = vrai && vrai.nom === k.nom && vrai.code === k.code && vrai.numero === k.numero;
            (jumeau ? c.jumeauxDeLaVerite : c.perdues).push(`${x.cle.slice(0, 8)} ${id} ${k.nom} | ${k.code} ${k.numero}`);
        }
    }
}
console.log(`DÉNOMINATEUR : ${c.lignes} lignes lues, ${c.sansVerite} sans vérité (exclues), ${c.paires} paires, dont ${c.fauxContredits} candidats faux contredits par l'ancien comparateur ; statuts reconstruits à l'identique : ${c.reconstruction}/${c.paires}`);
console.log(`CONTRADICTIONS JUSTES PERDUES : ${c.perdues.length}${c.perdues.map(l => '\n   ' + l).join('')}`);
console.log(`JUMEAUX DE LA VÉRITÉ (même carte, même code faux) : ${c.jumeauxDeLaVerite.length}${c.jumeauxDeLaVerite.map(l => '\n   ' + l).join('')}`);
console.log(`CONTRADICTIONS FAUSSES CORRIGÉES (la vérité n'est plus contredite) : ${c.veritesCorrigees}`);
process.exit(c.perdues.length ? 1 : 0);
