// Extrait les TYPES de variantes (normal / reverse / holo / …) de chaque carte du clone TCGdex — lu COMME DU TEXTE (regex), rien n'est exécuté ni importé.
//   node extraire-variants-tcgdex.js [--clone=<dossier data>] [--sortie=<fichier.json>]
// Sortie : { "<serie>/<dossierSet>|<numéro de fichier>": ["holo","reverse"], … } — la preuve STRUCTURELLE de l'arbitrage de rareté (une carte « Rare » chez TCGdex qui n'existe
// qu'en holo est un « Rare Holo » : TCGdex n'agrège que ce mot). Les cartes sans `variants` n'ont pas d'entrée : aucune preuve, jamais « non holo ».
const fs = require('fs');
const path = require('path');

const CLONE = 'C:/Users/Yung/rat-market-travail/catalogue/exports/tcgdex-clone-2026-09-25/data';
const SORTIE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/BULBA-DONNEES/tcgdex-variants.json';
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;

/** Le texte du tableau `variants: [ … ]` (crochets appariés), ou null. */
function blocVariants(txt) {
    const i = txt.search(/\bvariants:\s*\[/);
    if (i < 0) return null;
    const j = txt.indexOf('[', i); let d = 0, k = j;
    for (; k < txt.length; k++) { const c = txt[k]; if (c === '[') d++; else if (c === ']') { d--; if (!d) break; } }
    return txt.slice(j, k + 1);
}
/** Les `type: 'x'` de premier niveau des objets du tableau (les sous-objets thirdParty / stamp n'en portent pas). */
function typesDe(txt) {
    const b = blocVariants(txt); if (!b) return null;
    const t = [...b.matchAll(/\btype:\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => m[1] ?? m[2]);
    return [...new Set(t)].sort();
}
module.exports = { blocVariants, typesDe };

if (require.main === module) {
    const racine = arg('clone') || CLONE, sortie = arg('sortie') || SORTIE;
    const out = {}; let fichiers = 0, avec = 0;
    for (const serie of fs.readdirSync(racine, { withFileTypes: true })) {
        if (!serie.isDirectory() || /Pocket/.test(serie.name)) continue;
        for (const e of fs.readdirSync(path.join(racine, serie.name), { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            for (const f of fs.readdirSync(path.join(racine, serie.name, e.name))) {
                if (!f.endsWith('.ts')) continue;
                fichiers++;
                const t = typesDe(fs.readFileSync(path.join(racine, serie.name, e.name, f), 'utf8'));
                if (t && t.length) { out[`${serie.name}/${e.name}|${f.replace(/\.ts$/, '')}`] = t; avec++; }
            }
        }
    }
    if (!fichiers || !avec) throw new Error(`dénominateur : ${fichiers} fichiers, ${avec} avec variantes — une extraction vide est un instrument cassé`);
    fs.writeFileSync(sortie, JSON.stringify(out));
    console.log(`${fichiers} fichiers de carte lus, ${avec} avec des variantes (${(100 * avec / fichiers).toFixed(1)} %) → ${sortie}`);
}
