'use strict';
// STRIPE-DECISIONS — l'outil qui fabrique le lien réservé des Fondateurs : il l'écrit dans un fichier local, ne l'affiche ni ne le journalise jamais, et refuse ce qu'il ne sait pas faire sans jamais citer le code.
// Le banc n'écrit que dans un dossier temporaire : aucun dossier du testeur n'est cité ni ouvert.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const H = require('./_harnais'); const { ecrireLien, NOM_FICHIER } = require('../admin/abonnements/lien-fondateurs-lib');
const A = require('./_aide-abonnements'); const Cfg = require('../abonnements/config');

const sortie = []; const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, write: process.stdout.write.bind(process.stdout) };
const capter = () => { for (const k of ['log', 'error', 'warn', 'info']) console[k] = (...a) => { sortie.push(a.join(' ')); }; };
const rendre = () => { for (const k of ['log', 'error', 'warn', 'info']) console[k] = orig[k]; };

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-lien-'));
try {
    const code = A.CODE_FONDATEURS;
    capter();
    const r = ecrireLien({ code: ` ${code.toLowerCase()} `, site: 'https://rat-market.fr', dossier });
    rendre();
    const ecrit = fs.readFileSync(r.chemin, 'utf8');
    H.v('le lien est écrit dans UN fichier du dossier demandé, avec le code sous sa forme canonique (celle que l\'API compare)', [path.basename(r.chemin) === NOM_FICHIER, path.dirname(r.chemin) === dossier, ecrit], [true, true, `https://rat-market.fr/fr/fondateurs?code=${encodeURIComponent(Cfg.normaliserCode(code))}\n`]);
    H.v('   ce que la fonction rend : le chemin et le nombre d\'octets, JAMAIS le lien ni le code', [Object.keys(r).sort(), JSON.stringify(r).includes(code), r.octets === Buffer.byteLength(ecrit)], [['chemin', 'octets'], false, true]);
    H.v('   rien n\'est affiché ni journalisé pendant l\'écriture (console.log/error/warn/info)', [sortie.length, sortie.join('\n').includes(code)], [0, false]);
    // le code d'une valeur à caractères spéciaux est encodé
    const r2 = ecrireLien({ code: 'Code Spécial&=?#12', site: 'https://rat-market.fr', dossier });
    H.v('un code à caractères spéciaux est ENCODÉ dans l\'adresse (rien ne casse la requête)', fs.readFileSync(r2.chemin, 'utf8').trim(), `https://rat-market.fr/fr/fondateurs?code=${encodeURIComponent(Cfg.normaliserCode('Code Spécial&=?#12'))}`);

    // les refus : chacun nomme sa cause et ne cite JAMAIS le code
    const refuse = (nom, o) => { let m = null; try { ecrireLien(o); } catch (e) { m = e.message; } H.v(`refus : ${nom}`, [Boolean(m), m ? m.includes(String(o.code || '§§')) : false], [true, false]); };
    refuse('code absent (le .env ne porte que l\'empreinte)', { code: '', site: 'https://rat-market.fr', dossier });
    refuse('code absent (non texte)', { code: undefined, site: 'https://rat-market.fr', dossier });
    refuse('code trop court', { code: 'ABC12', site: 'https://rat-market.fr', dossier });
    refuse('code trop long', { code: 'X'.repeat(65), site: 'https://rat-market.fr', dossier });
    refuse('site qui n\'est pas https://hôte', { code, site: 'http://rat-market.fr', dossier });
    refuse('site avec un chemin', { code, site: 'https://rat-market.fr/fr', dossier });
    refuse('dossier inexistant (jamais créé)', { code, site: 'https://rat-market.fr', dossier: path.join(dossier, 'absent') });
    refuse('dossier qui est un fichier', { code, site: 'https://rat-market.fr', dossier: r.chemin });
    H.v('   et le dossier inexistant n\'a pas été créé', fs.existsSync(path.join(dossier, 'absent')), false);

    // le script : un argument non admis arrête AVANT toute lecture du .env
    const e = spawnSync(process.execPath, [path.join(__dirname, '..', 'admin', 'abonnements', 'lien-fondateurs.js'), '--afficher'], { encoding: 'utf8', timeout: 20000 });
    H.v('le script refuse un argument non admis (admis : --ecrire seulement), sans rien lire', [e.status, /non admis/.test(e.stderr), e.stdout], [1, true, '']);
    // le source de l'outil n'affiche jamais le lien : aucune sortie ne reçoit le contenu ni le code
    const src = fs.readFileSync(path.join(__dirname, '..', 'admin', 'abonnements', 'lien-fondateurs-lib.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'admin', 'abonnements', 'lien-fondateurs.js'), 'utf8');
    H.v('   le source de l\'outil : la bibliothèque n\'écrit sur aucune sortie ; le script n\'imprime ni `code`, ni `contenu`', [/console\.|process\.std/.test(fs.readFileSync(path.join(__dirname, '..', 'admin', 'abonnements', 'lien-fondateurs-lib.js'), 'utf8').replace(/\/\/.*$/gm, '')), /\$\{\s*(code|contenu|canonique|ENV)\b|console\.\w+\(\s*(code|contenu|canonique|ENV)\b/.test(src.replace(/\/\/.*$/gm, ''))], [false, false]);
} finally { rendre(); fs.rmSync(dossier, { recursive: true, force: true }); }
H.bilan();
