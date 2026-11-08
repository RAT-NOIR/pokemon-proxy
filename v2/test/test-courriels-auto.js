'use strict';
// BREVO — la RESYNCHRONISATION automatique des gabarits de courriel du site, et le verdict DÉTERMINISTE du verrou. Sans base, sans le vrai site :
// un FAUX dépôt de site est fabriqué dans un dossier temporaire (jamais les chemins du testeur) et un ESPION refuse toute écriture hors de ce dossier.
//   épingle à jour → vert · le site avance → verrou VERT + avertissement · copie retouchée à la main → ROUGE · resynchronisation → copie et COMMIT à jour, banc vert
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const H = require('./_harnais');
const R = require('../chargeur/copier-regle-site');
const C = require('../comptes/copier-courriels-site');
const S = require('../comptes/resynchroniser-courriels-site');

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-courriels-auto-'));
const repo = path.join(racine, 'site'), lib = path.join(repo, 'lib'), dossier = path.join(racine, 'copie'), fichierCommit = path.join(racine, 'copieur.js');

// ESPION : toute écriture hors du dossier temporaire de ce banc est refusée (et nomme le chemin).
const NOMS = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'renameSync', 'copyFileSync', 'createWriteStream', 'truncateSync'];
const originaux = {};
const sous = p => { const r = path.resolve(String(p)); return r === racine || r.startsWith(racine + path.sep); };
function armer() { for (const n of NOMS) { originaux[n] = fs[n]; fs[n] = function (p, ...a) { if (!sous(p)) throw new Error(`ESPION : écriture refusée hors du dossier temporaire du banc : ${p}`); return originaux[n].call(fs, p, ...a); }; } }
function desarmer() { for (const n of NOMS) fs[n] = originaux[n]; }

const gitFaux = (...args) => execFileSync(R.trouverGit(), ['-C', repo, '-c', 'user.name=banc', '-c', 'user.email=banc@exemple.invalid', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ecrireSite = (nom, texte) => fs.writeFileSync(path.join(lib, nom), texte);
const commiterSite = msg => { gitFaux('add', '--', 'lib'); gitFaux('commit', '-m', msg); return gitFaux('rev-parse', 'HEAD'); };
const lireTout = d => Object.fromEntries(fs.readdirSync(d).sort().map(f => [f, fs.readFileSync(path.join(d, f), 'utf8')]));
const sorties = []; const sortie = t => sorties.push(String(t));
const essai = f => { try { f(); return null; } catch (e) { return e.message; } };

(async () => {
    // ---- le faux site : sept sources TypeScript, fermeture respectée
    fs.mkdirSync(lib, { recursive: true });
    ecrireSite('courriels.ts', 'import { ENTETE } from "./courrielsGabarit.ts";\nimport { NOM } from "./site.ts";\nexport const COURRIELS = {\n  creationCompte: (x: { adresse: string; lienConfirmation: string }) => ({ objet: ENTETE + NOM, html: "<html>" + x.lienConfirmation, texte: x.lienConfirmation }),\n};\n');
    ecrireSite('courrielsGabarit.ts', 'export const ENTETE: string = "Bienvenue ";\n');
    ecrireSite('site.ts', 'import { QUOTA } from "./tarifs.ts";\nexport const NOM: string = "Rat-Market " + QUOTA;\n');
    ecrireSite('extension.ts', 'export const EXTENSION: string = "ext";\n');
    ecrireSite('tarifs.ts', 'import { M } from "./montants.ts";\nimport { PLAFOND } from "./offre.ts";\nexport const QUOTA: number = M + PLAFOND;\n');
    ecrireSite('montants.ts', 'export const M: number = 1;\n');
    ecrireSite('offre.ts', 'export const PLAFOND: number = 200;\n');
    execFileSync(R.trouverGit(), ['-C', repo, 'init', '-b', 'main'], { stdio: 'ignore' });
    const c1 = commiterSite('site v1');
    const c1court = gitFaux('rev-parse', '--short=7', c1);
    fs.writeFileSync(fichierCommit, `'use strict';\n// copieur de banc\nconst COMMIT = '${c1court}';\nmodule.exports = {};\n`);
    armer();
    const garde = essai(() => fs.writeFileSync(path.join(__dirname, 'ne-doit-pas-exister.tmp'), 'x'));
    H.vrai('l\'espion refuse une écriture hors du dossier temporaire (et nomme le chemin)', /ESPION/.test(garde || '') && !fs.existsSync(path.join(__dirname, 'ne-doit-pas-exister.tmp')));

    const opt = (extra = {}) => ({ siteLib: lib, dossier, commit: c1court, ...extra });
    C.ecrire(null, dossier, { commit: c1court, repo });

    // ---- 1. épingle à jour → vert, aucun avertissement
    H.v('épingle à jour : verrou vert', [C.verifier(opt()).etat, C.verifier(opt()).derives], ['ok', []]);
    H.v('épingle à jour : le site n\'a rien changé', C.deriveDuSite({ siteLib: lib, dossier }).etat, 'a-jour');

    // ---- 2. le site avance (offre.ts, commit) : le verrou RESTE vert, l'avertissement est visible
    ecrireSite('offre.ts', 'export const PLAFOND: number = 300;\nexport const NOUVEAU: string = "texte neuf";\n');
    const c2 = commiterSite('site v2 : offre.ts');
    H.v('le site avance : verrou toujours VERT (il ne regarde que l\'épingle)', [C.verifier(opt()).etat, C.verifier(opt()).derives], ['ok', []]);
    const dv = C.deriveDuSite({ siteLib: lib, dossier });
    H.v('le site avance : dérive nommée', [dv.etat, dv.changees, dv.tete], ['avance', ['offre.ts'], c2]);
    const av = C.avertissement(dv, c1court);
    H.vrai('   l\'avertissement dit « 1 des 7 », l\'épingle et la commande', av.includes('1 des 7') && av.includes(c1court) && av.includes('node v2/comptes/resynchroniser-courriels-site.js') && av.includes('n\'échoue pas'));
    // --verifier : lecture seule, rien n'est écrit
    const avantTout = JSON.stringify([lireTout(dossier), fs.readFileSync(fichierCommit, 'utf8')]);
    const ro = S.resynchroniser({ repo, dossier, fichierCommit, verifierSeulement: true, sortie });
    H.v('--verifier : constate la dérive sans rien écrire', [ro.ecrit, ro.etat, JSON.stringify([lireTout(dossier), fs.readFileSync(fichierCommit, 'utf8')]) === avantTout], [false, 'avance', true]);
    // l'arbre de travail du site ne compte pas pour le verrou : une modification non commitée n'y change rien
    ecrireSite('offre.ts', 'export const PLAFOND: number = 999;\n');
    H.v('arbre du site modifié (non commité) : verrou inchangé, vert', C.verifier(opt()).etat, 'ok');

    // ---- 3. refus si l'arbre du site a des modifications non commitées sur les sources
    const refus = essai(() => S.resynchroniser({ repo, dossier, fichierCommit, lancerTest: () => ({ ok: true, texte: '' }), sortie }));
    H.vrai('resynchroniser REFUSE un arbre du site sale, en nommant la source', /REFUS/.test(refus || '') && /offre\.ts/.test(refus));
    H.v('   et n\'a rien écrit', JSON.stringify([lireTout(dossier), fs.readFileSync(fichierCommit, 'utf8')]) === avantTout, true);
    gitFaux('checkout', '--', 'lib/offre.ts');

    // ---- 4. copie retouchée à la main → ROUGE
    const cible = path.join(dossier, 'courriels.mjs'), propre = fs.readFileSync(cible, 'utf8');
    fs.writeFileSync(cible, propre + '// retouche à la main\n');
    const rouge = C.verifier(opt());
    H.v('copie modifiée à la main : ROUGE, fichier nommé', [rouge.etat, rouge.derives], ['derive', ['courriels.mjs']]);
    const rougeSansSite = C.verifier(opt({ siteLib: path.join(racine, 'inexistant', 'lib') }));
    H.v('   rouge aussi quand le site est absent (la retouche ne dépend pas du site)', [rougeSansSite.etat, rougeSansSite.derives], ['derive', ['courriels.mjs']]);
    fs.writeFileSync(cible, propre);
    // une copie dont le contenu et l'empreinte ont été retouchés ENSEMBLE reste rouge : elle n'est plus ce que produit l'épingle
    const emp = JSON.parse(fs.readFileSync(path.join(dossier, 'empreintes.json'), 'utf8')), sauvEmp = JSON.stringify(emp, null, 2) + '\n';
    const retouche = propre + '// retouche\n'; fs.writeFileSync(cible, retouche);
    emp.produits['courriels.mjs'] = require('crypto').createHash('sha256').update(retouche).digest('hex'); fs.writeFileSync(path.join(dossier, 'empreintes.json'), JSON.stringify(emp, null, 2) + '\n');
    H.v('copie ET empreinte retouchées ensemble : ROUGE (≠ ce que produit l\'épingle)', [C.verifier(opt()).etat, C.verifier(opt()).derives], ['derive', ['courriels.mjs']]);
    fs.writeFileSync(cible, propre); fs.writeFileSync(path.join(dossier, 'empreintes.json'), sauvEmp);
    H.v('copie rétablie : de nouveau vert', C.verifier(opt()).etat, 'ok');

    // ---- 5. site ou commit épinglé absent : DIT, jamais un vert muet
    const sa = C.verifier(opt({ siteLib: path.join(racine, 'inexistant', 'lib') }));
    H.v('dépôt du site absent : « non vérifié » (raison dite), pas « ok »', [sa.etat, sa.raison], ['non-verifie', 'site-absent']);
    const ca = C.verifier(opt({ commit: 'deadbee' }));
    H.v('commit épinglé introuvable dans le site : « non vérifié » (raison dite)', [ca.etat, ca.raison], ['non-verifie', 'commit-absent']);
    H.v('dérive du site indéterminée quand il est absent (avertissement dit)', C.deriveDuSite({ siteLib: path.join(racine, 'inexistant', 'lib'), dossier }).etat, 'indetermine');

    // ---- 6. resynchronisation
    const avant = lireTout(dossier), avantCopieur = fs.readFileSync(fichierCommit, 'utf8');
    let testLance = null;
    const r = S.resynchroniser({ repo, dossier, fichierCommit, sortie, lancerTest: ({ commit }) => { testLance = commit; const v = C.verifier({ siteLib: lib, dossier, commit }); return { ok: v.etat === 'ok', texte: JSON.stringify(v) }; } });
    const c2court = gitFaux('rev-parse', '--short=7', c2);
    H.v('resynchronisation : écrit, de l\'épingle ancienne à la nouvelle', [r.ecrit, r.ancien, r.nouveau], [true, c1court, c2court]);
    H.v('   le banc de la copie a été rejoué sur la NOUVELLE épingle', testLance, c2court);
    const apres = lireTout(dossier), copieur = fs.readFileSync(fichierCommit, 'utf8');
    H.v('   COMMIT à jour, et seule cette ligne du copieur a bougé', copieur, avantCopieur.replace(c1court, c2court));
    const emp2 = JSON.parse(apres['empreintes.json']);
    H.v('   empreintes.json porte le commit complet de la tête', emp2.commit, c2);
    H.v('   seuls offre.mjs (sa source a changé) et empreintes.json sont modifiés', Object.keys(apres).filter(f => apres[f] !== avant[f]).sort(), ['empreintes.json', 'offre.mjs'].sort());
    H.v('   verrou vert sur la nouvelle épingle, site à jour', [C.verifier({ siteLib: lib, dossier, commit: c2court }).etat, C.deriveDuSite({ siteLib: lib, dossier }).etat], ['ok', 'a-jour']);
    const texteSortie = sorties.join('\n');
    H.vrai('   le diff du contenu servi est imprimé (fichier, lignes), avec les fichiers à commiter', /--- offre\.mjs/.test(texteSortie) && /^\+\s+\d+\s+export const NOUVEAU/m.test(texteSortie) && /^-\s+\d+\s+export const PLAFOND\s+= 200/m.test(texteSortie) && /NON COMMITÉ/.test(texteSortie) && /sources du site changées : offre\.ts/.test(texteSortie));
    H.v('   rien n\'est commité côté site (aucune écriture git du script)', gitFaux('rev-parse', 'HEAD'), c2);
    // rejouée : rien à faire
    const encore = S.resynchroniser({ repo, dossier, fichierCommit, sortie, lancerTest: () => { throw new Error('ne doit pas être lancé'); } });
    H.v('relancée à jour : « rien à faire », rien d\'écrit', [encore.ecrit, JSON.stringify(lireTout(dossier)) === JSON.stringify(apres)], [false, true]);

    // ---- 7. le banc de la copie qui échoue fait échouer le script (fichiers laissés pour relecture)
    ecrireSite('montants.ts', 'export const M: number = 2;\n'); commiterSite('site v3 : montants.ts');
    const echec = essai(() => S.resynchroniser({ repo, dossier, fichierCommit, sortie, lancerTest: () => ({ ok: false, texte: 'simulé' }) }));
    H.vrai('banc de la copie rouge après resynchronisation : le script échoue', /banc de la copie échoue/.test(echec || ''));

    desarmer();
    fs.rmSync(racine, { recursive: true, force: true });       // dossier temporaire du banc : fichiers ordinaires, aucune jonction
    H.bilan();
})().catch(e => { try { desarmer(); } catch { /* déjà désarmé */ } console.error('❌', e); process.exit(1); });
