// MUTANTS de la garde « identique au bit » (verdict.mjs) : chaque mutation affaiblit UNE ligne de la garde ; test-decodeur-page.js doit alors ÉCHOUER (mutant tué).
// Le fichier est modifié sur place, puis RESTAURÉ dans un finally (octet pour octet) ; ne rien éditer ni lancer d'autre test pendant ce temps.
//   node outils\decodeur\mutations-verdict.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const RACINE = path.join(import.meta.dirname, '..', '..');
const V = path.join(RACINE, 'v2', 'banc-telephone', 'public', 'verdict.mjs'), TEST = path.join(RACINE, 'v2', 'test', 'test-decodeur-page.js');
const M = [
    ['garde : pil absent compte comme identique', 'else if (!Number.isInteger(pil)) identiqueAuBit = null;', 'else if (!Number.isInteger(pil)) identiqueAuBit = true;'],
    ['garde : identité inférieure à 30 tolérée', 'else identiqueAuBit = pil === attendu;', 'else identiqueAuBit = pil >= attendu - 2;'],
    ['garde : un repli ne bloque plus (29 rm + 1 repli)', 'else if (repli > 0 || rm !== attendu) identiqueAuBit = false;', 'else if (rm < 1) identiqueAuBit = false;'],
    ['comptePil : mesure partielle prise pour complète', 'mesurees.length === l.length ? identiques : null', 'mesurees.length > 0 ? identiques : null'],
    ['comptePil : empreinte absente comptée identique', 'hex(p.attendu) && hex(p.calcule)', '(hex(p.attendu) || p.attendu == null) && hex(p.calcule)'],
    ['avis : « non établie » dit comme « identique au bit »', "etat === null ? 'identique à la référence ; identité de l\\'entrée aux octets de PIL non établie'", "etat === null ? 'identique à la référence, entrée identique au bit'"],
];
const orig = fs.readFileSync(V);
let vivantes = 0;
try {
    for (const [nom, a, b] of M) {
        const t = orig.toString('utf8');
        if (!t.includes(a)) { console.log(`INTROUVABLE  ${nom}`); vivantes++; continue; }
        fs.writeFileSync(V, t.replace(a, () => b));
        const r = spawnSync(process.execPath, [TEST], { encoding: 'utf8' });
        const tue = r.status !== 0;
        if (!tue) vivantes++;
        console.log(`${tue ? 'TUÉ     ' : 'VIVANTE '} ${nom}`);
    }
} finally { fs.writeFileSync(V, orig); }
console.log(`${M.length - vivantes}/${M.length} tuées`);
process.exit(vivantes ? 1 : 0);
