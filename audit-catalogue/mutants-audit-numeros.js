'use strict';
// Mutants de numeros-attendus.js et de son câblage dans audit-sets.js : chacun doit faire échouer test-audit-numeros.js. Restaure toujours.
// Le banc est rejoué DANS le processus (caches de require vidés, process.exit et console.log interceptés) : pas de child_process.
const fs = require('fs'); const path = require('path');
const spawnSync = (_node, [t]) => {
    for (const k of Object.keys(require.cache)) if (k.startsWith(__dirname)) delete require.cache[k];
    const exit = process.exit, log = console.log; let code = 0, sortie = '';
    process.exit = c => { code = c || 0; throw new Error('__sortie__'); };
    console.log = (...a) => { sortie += a.join(' ') + '\n'; };
    try { require(t); } catch (e) { if (e.message !== '__sortie__') { code = 1; sortie += String(e.message) + '\n'; } } finally { process.exit = exit; console.log = log; }
    for (const k of Object.keys(require.cache)) if (k.startsWith(__dirname) && !k.endsWith('mutants-audit-numeros.js')) delete require.cache[k];
    return { status: code, stdout: sortie };
};
const D = __dirname;
const T = path.join(D, 'test-audit-numeros.js');
const N = path.join(D, 'numeros-attendus.js'), S = path.join(D, 'audit-sets.js');
const origs = { [N]: fs.readFileSync(N, 'utf8'), [S]: fs.readFileSync(S, 'utf8') };
const M = [
    [N, 'principal = tout entier', "/^\\d+$/.test(String(n))", "/\\d+$/.test(String(n))"],
    [N, 'N sans préfixés', "Q === 0 || maxP > T ? T :", "Q === 0 ? T :"],
    [N, 'N = T toujours', "Q === 0 || maxP > T ? T : Math.max(T - Q, maxP)", "T"],
    [N, 'sans le plus grand principal', "Math.max(T - Q, maxP)", "T - Q"],
    [N, 'annexe comptée en sous-série', "[A-Z]+\\d+|[A-Z]+|[!?])$/i", "[A-Z]+\\d+|\\d+[A-Z]+|[A-Z]+|[!?])$/i"],
    [N, 'mot en lettres hors sous-série', "|[A-Z]+|[!?])$/i", "|[A-Z]|[!?])$/i"],
    [N, 'libellé au-delà du total', "const auDela = principaux.filter(n => n > T).length;", "const auDela = 0;"],
    [N, 'trou compté seulement après 1', "for (let i = 1; i <= N; i++)", "for (let i = 2; i <= N; i++)"],
    [N, 'borne haute exclue', "i <= N; i++", "i < N; i++"],
    [N, 'total nul accepté', "totalImprime > 0 ? totalImprime : null", "totalImprime >= 0 ? totalImprime : null"],
    [N, 'préfixés non comptés', "const prefixes = [...presents].filter(estSousSerie).length;", "const prefixes = 0;"],
    [N, 'libellé', "attendu : total imprimé ${T} = ${P} principaux", "attendu : total ${T} = ${P}"],
    [S, 'câblage : liste ancienne', "const liste = attenduDetail.manquants;", "const liste = [...Array(attendu).keys()].map(i => String(i + 1)).filter(n => !nums.has(n));"],
    [S, 'câblage : détail non porté', "attendu, attenduDetail, totalImprime: total", "attendu, totalImprime: total"],
];
let tues = 0; const vivants = [];
try {
    for (const [F, nom, a, b] of M) {
        const orig = origs[F];
        if (orig.split(a).length !== 2) { console.log(`INVALIDE (motif absent ou multiple) : ${nom}`); vivants.push(nom + ' (invalide)'); continue; }
        fs.writeFileSync(F, orig.replace(a, () => b));
        const r = spawnSync('node', [T], { encoding: 'utf8' });
        fs.writeFileSync(F, orig);
        if (r.status !== 0) { tues++; console.log(`tué     : ${nom}`); } else { vivants.push(nom); console.log(`VIVANT  : ${nom}`); }
    }
} finally { for (const [F, o] of Object.entries(origs)) fs.writeFileSync(F, o); }
console.log(`\n${tues} tués sur ${M.length}; vivants : ${vivants.join(' | ') || 'aucun'}`);
const v = spawnSync('node', [T], { encoding: 'utf8' }); console.log('restauré, banc :', v.stdout.trim().split('\n').pop());
