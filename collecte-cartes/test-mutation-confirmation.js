// node collecte-cartes/test-mutation-confirmation.js — MUTATIONS de B1 : chaque garde retirée DOIT faire échouer un banc. Un banc qui reste vert sans la garde ne la garde pas.
// Les modules mutés sont écrits dans un dossier TEMPORAIRE (aucun fichier du dépôt n'est touché) et rechargés par le banc via CONFIRMATION_MODULE / CLASSEMENT_MODULE.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..');
const lire = f => fs.readFileSync(path.join(RACINE, f), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-confirmation-'));
let ok = 0, ko = 0;

const entre = (src, debut, fin) => { const a = src.indexOf(debut), b = src.indexOf(fin); if (a < 0 || b < a) throw new Error(`marqueurs ${debut}/${fin} introuvables : la mutation ne mord sur rien (§41)`); return src.slice(0, a) + src.slice(b + fin.length); };
const remplacer = (src, de, par) => { if (!src.includes(de)) throw new Error(`motif introuvable « ${de.slice(0, 60)} » : la mutation ne mord sur rien (§41)`); return src.replace(de, par); };
// les require relatifs du module muté pointent vers le dépôt
const absolus = (src, dossier) => src.replace(/require\('\.\/([\w-]+)'\)/g, (_, m) => `require(${JSON.stringify(path.join(RACINE, dossier, m))})`);

function muter(nom, { fichier, dossier, transformer, banc, env }) {
    const f = path.join(tmp, `${nom}.js`);
    fs.writeFileSync(f, absolus(transformer(lire(fichier)), dossier));
    const r = spawnSync(process.execPath, [path.join(RACINE, banc)], { env: { ...process.env, [env]: f }, encoding: 'utf8' });
    const echoue = r.status !== 0;
    const lignes = (r.stdout || '').split(/\r?\n/).filter(l => l.startsWith('❌')).length;
    if (echoue) { ok++; console.log(`✅ mutation « ${nom} » : le banc ÉCHOUE (${lignes} cas en échec)`); } else { ko++; console.log(`❌ mutation « ${nom} » : le banc reste VERT — la garde n'est gardée par rien`); }
}

const CONF = { fichier: 'collecte-cartes/confirmation.js', dossier: 'collecte-cartes', banc: 'collecte-cartes/test-confirmation.js', env: 'CONFIRMATION_MODULE' };
muter('sans-concordance-avec-la-ligne-actuelle', { ...CONF, transformer: s => entre(s, '// [CONCORDE-DEBUT]', '// [CONCORDE-FIN]') });
muter('sans-rejeu-de-la-regle-de-production', { ...CONF, transformer: s => entre(s, '// [REJEU-DEBUT]', '// [REJEU-FIN]') });
muter('numero-de-la-ligne-non-compare', { ...CONF, transformer: s => remplacer(s, "if (ligne.numeroFiche != null &&", "if (false && ligne.numeroFiche != null &&") });
muter('carte-de-la-ligne-non-comparee', { ...CONF, transformer: s => remplacer(s, 'if (conf.carteId == null || conf.carteId !== ligne.carteId)', 'if (false)') });
muter('sources-declarees-non-confrontees-aux-concordantes', { ...CONF, transformer: s => remplacer(s, 'if (portees.length !== independantes.length || independantes.some(s => !portees.includes(s)))', 'if (false)') });
muter('contradictions-toujours-vides', { ...CONF, transformer: s => remplacer(s, 'return (refusees || []).filter(', 'return [] || (refusees || []).filter(') });
const CLASS = { fichier: 'audit-catalogue/classement.js', dossier: 'audit-catalogue', banc: 'audit-catalogue/test-classement.js', env: 'CLASSEMENT_MODULE' };
muter('classement-croit-toute-confirmation-meme-ignoree', { ...CLASS, transformer: s => remplacer(s, 'confirmation.concorde === true', 'true') });
muter('classement-leve-aussi-les-autres-motifs', { ...CLASS, transformer: s => remplacer(s, "if (sansNumero && setANumeros === true && numeroConnu === true) motifs.push('sans-numero');", "if (sansNumero && setANumeros === true && numeroConnu === true && !confirmee) motifs.push('sans-numero');") });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${ok} mutations détectées, ${ko} survivantes`);
process.exit(ko ? 1 : 0);
