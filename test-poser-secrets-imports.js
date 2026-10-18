// BANC — poser-secrets-imports.js : lit un .env, n'imprime que des NOMS, appelle `gh secret set NOM --repo …` avec la valeur sur l'entrée
// standard. Faux `gh`, faux .env : le vrai .env n'est jamais lu par ce banc.
//   node test-poser-secrets-imports.js
const assert = require('assert');
const P = require('./poser-secrets-imports');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`🔴 ${nom} : ${e.message}`); } };

const ENV_TXT = [
    '# commentaire', 'MONGODB_URI="mongodb+srv://u:VALEUR-MONGO@h/x"', 'R2_BUCKET_BRUT=bucket-x', 'R2_ACCESS_KEY_ID=VALEUR-CLE', "R2_SECRET_ACCESS_KEY='VALEUR-SEC'",
    'R2_ENDPOINT=https://VALEUR-EP.r2.cloudflarestorage.com', 'AUTRE=ne-doit-pas-partir', ''
].join('\n');

function fauxGh(code = 0) {
    const appels = [];
    return { appels, gh: (args, valeur) => { appels.push({ args, valeur }); return { status: code }; } };
}
const muet = () => { const s = []; return { s, journal: { log: m => s.push(String(m)), error: m => s.push(String(m)) } }; };

(async () => {
    await t('analyse du .env : guillemets, commentaires, valeurs', () => {
        const e = P.lireEnv(ENV_TXT);
        assert.equal(e.MONGODB_URI, 'mongodb+srv://u:VALEUR-MONGO@h/x'); assert.equal(e.R2_SECRET_ACCESS_KEY, 'VALEUR-SEC'); assert.equal(e.AUTRE, 'ne-doit-pas-partir');
    });
    await t('pose : MONGODB_URI_IMPORTS vient de MONGODB_URI, la valeur passe par l\'entrée standard, jamais dans les arguments', async () => {
        const f = fauxGh(), m = muet();
        const code = await P.poser({ texteEnv: ENV_TXT, repo: 'RAT-NOIR/pokemon-proxy', gh: f.gh, journal: m.journal });
        assert.equal(code, 0);
        const noms = f.appels.map(a => a.args[2]);
        assert.deepEqual(noms.sort(), ['MONGODB_URI_IMPORTS', 'R2_ACCESS_KEY_ID', 'R2_BUCKET_BRUT', 'R2_ENDPOINT', 'R2_SECRET_ACCESS_KEY'].sort());
        for (const a of f.appels) {
            assert.deepEqual(a.args.slice(0, 2), ['secret', 'set']); assert.deepEqual(a.args.slice(3), ['--repo', 'RAT-NOIR/pokemon-proxy']);
            assert.ok(!a.args.join(' ').includes('VALEUR'), 'aucune valeur dans les arguments');
        }
        assert.equal(f.appels.find(a => a.args[2] === 'MONGODB_URI_IMPORTS').valeur, 'mongodb+srv://u:VALEUR-MONGO@h/x');
        assert.ok(!f.appels.some(a => a.args[2] === 'AUTRE'), 'une variable hors liste ne part pas');
    });
    await t('sortie : seulement des NOMS', async () => {
        const f = fauxGh(), m = muet();
        await P.poser({ texteEnv: ENV_TXT, repo: 'RAT-NOIR/pokemon-proxy', gh: f.gh, journal: m.journal });
        assert.ok(!/VALEUR/.test(m.s.join('\n'))); assert.match(m.s.join('\n'), /MONGODB_URI_IMPORTS/);
    });
    await t('variable obligatoire absente du .env : sortie 1, aucun gh appelé', async () => {
        const f = fauxGh(), m = muet();
        const code = await P.poser({ texteEnv: 'R2_BUCKET_BRUT=b', repo: 'RAT-NOIR/pokemon-proxy', gh: f.gh, journal: m.journal });
        assert.equal(code, 1); assert.equal(f.appels.length, 0); assert.match(m.s.join('\n'), /MONGODB_URI/);
    });
    await t('R2_ACCOUNT_ID présent : posé aussi ; R2_ENDPOINT absent : simplement non posé', async () => {
        const f = fauxGh();
        await P.poser({ texteEnv: ENV_TXT.replace(/R2_ENDPOINT=.*/, 'R2_ACCOUNT_ID=acct'), repo: 'r/p', gh: f.gh, journal: muet().journal });
        const noms = f.appels.map(a => a.args[2]);
        assert.ok(noms.includes('R2_ACCOUNT_ID')); assert.ok(!noms.includes('R2_ENDPOINT'));
    });
    await t('ni R2_ACCOUNT_ID ni R2_ENDPOINT : sortie 1', async () => {
        const f = fauxGh();
        const code = await P.poser({ texteEnv: ENV_TXT.replace(/R2_ENDPOINT=.*/, ''), repo: 'r/p', gh: f.gh, journal: muet().journal });
        assert.equal(code, 1); assert.equal(f.appels.length, 0);
    });
    await t('gh échoue : sortie 1 et le nom du secret en échec est dit', async () => {
        const m = muet();
        const code = await P.poser({ texteEnv: ENV_TXT, repo: 'r/p', gh: fauxGh(1).gh, journal: m.journal });
        assert.equal(code, 1); assert.match(m.s.join('\n'), /échec/);
    });
    await t('--a-blanc : liste les noms, n\'appelle pas gh', async () => {
        const f = fauxGh(), m = muet();
        assert.equal(await P.poser({ texteEnv: ENV_TXT, repo: 'r/p', gh: f.gh, journal: m.journal, aBlanc: true }), 0);
        assert.equal(f.appels.length, 0); assert.match(m.s.join('\n'), /MONGODB_URI_IMPORTS/);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
