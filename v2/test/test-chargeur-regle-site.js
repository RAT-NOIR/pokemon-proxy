'use strict';
// COTES-VISUELS — la copie EMBARQUÉE des règles du site (ruling 2). Pas de base. Quand `rat-market-site` est présent, un fichier du site qui diffère de son empreinte FAIT ÉCHOUER ce banc ;
// quand il est absent, le banc le DIT (jamais un vert muet). La copie est régénérée par l'outil et comparée octet pour octet.
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const H = require('./_harnais');
const C = require('../chargeur/copier-regle-site');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
    const dossier = C.DOSSIER;
    const emp = JSON.parse(fs.readFileSync(path.join(dossier, 'empreintes.json'), 'utf8'));
    H.v('les huit sources du site sont empreintées', Object.keys(emp.sources).sort(), ['cardmarket.ts', 'expressionsSures.ts', 'imageDeLImpression.ts', 'impressionDuSet.ts', 'impressionsDuSet.ts', 'langueDuVisuel.ts', 'visuels-anglais-regardes.json', 'visuels-japonais-sur-sets-intl.json']);
    H.v('le commit NOMMÉ est écrit dans les empreintes (35ed580, forme complète de 40 caractères)', [/^35ed580[0-9a-f]{33}$/.test(emp.commit || ''), C.COMMIT], [true, '35ed580']);
    // la copie n'a pas été retouchée à la main : chaque fichier produit porte l'empreinte écrite
    for (const [nom, h] of Object.entries(emp.produits)) H.v(`   ${nom} : empreinte de la copie conforme au fichier`, sha(fs.readFileSync(path.join(dossier, nom))), h);
    H.v('   aucune copie ne cite encore un fichier .ts (imports réécrits en .mjs)', Object.keys(emp.produits).filter(n => n.endsWith('.mjs')).filter(n => /from\s+["'][^"']+\.ts["']/.test(fs.readFileSync(path.join(dossier, n), 'utf8'))), []);

    // le site, quand il est là
    const siteLib = C.SITE_LIB;
    const etat = C.verifier({ siteLib });
    if (etat.etat === 'site-absent') console.log(`⚠️ SITE ABSENT (${path.basename(path.dirname(siteLib))}) : la synchronisation avec le site n'est PAS vérifiée par ce banc — jamais un vert à lire comme « à jour »`);
    else {
        H.v('le site présent : chaque fichier source porte l\'empreinte de la copie, et la régénération donne la copie octet pour octet', [etat.etat, etat.derives], ['ok', []]);
        // M7 : une régénération SAUTÉE (Node sans stripTypeScriptTypes) ne doit pas passer pour « comparée » — le vert muet est interdit
        if (etat.regenerationSautee) console.log('⚠️ RÉGÉNÉRATION SAUTÉE (Node sans stripTypeScriptTypes) : seules les empreintes des sources ont été comparées, pas la copie produite — non vérifiée');
        else H.v('   la régénération a été COMPARÉE (pas sautée)', etat.regenerationSautee, undefined);
        // S2 (équivalent) : retirer cette comparaison laisse les empreintes des six sources ET celles des fichiers produits (vérifiées plus haut) : la couche est redondante, elle ne diffère que si l'outil lui-même change
    }

    // les cas fabriqués : la dérive est vue, et nommée
    const leve1 = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    const git = C.trouverGit();
    const gitBrut = (repo, ...args) => require('child_process').execFileSync(git, ['-C', repo, ...args], { maxBuffer: 64 * 1024 * 1024 });
    // la LECTURE AU COMMIT NOMMÉ : les octets de `git show <commit>:lib/<fichier>`, jamais l'arbre de travail (fins de ligne du poste)
    const absentDuSite = etat.etat === 'site-absent';
    if (!absentDuSite) {
        const pin = C.lecteurGit(C.REPO_SITE, C.COMMIT);
        for (const nom of Object.keys(emp.sources)) H.v(`   ${nom} : octets lus = \`git show ${C.COMMIT}:lib/${nom}\` (empreinte de la copie)`, sha(pin(nom)), emp.sources[nom]);
        H.v('   le lecteur rend exactement les octets de git show (comparés à un appel direct à git)', pin('impressionDuSet.ts').equals(gitBrut(C.REPO_SITE, 'show', `${C.COMMIT}:lib/impressionDuSet.ts`)), true);
        H.v('   un commit qui n\'existe pas : le lecteur LÈVE (jamais un repli sur l\'arbre de travail)', /introuvable|existe|fatal/i.test(leve1(() => C.lecteurGit(C.REPO_SITE, 'deadbeef00000000')('impressionDuSet.ts')) || ''), true);
        H.v('   un fichier absent du commit : le lecteur LÈVE', leve1(() => pin('nexiste-pas.ts')) !== null, true);
    }
    // sur un dépôt FABRIQUÉ : l'arbre de travail diffère du commit (fins de ligne CRLF) ; le lecteur rend le commit
    const depot = fs.mkdtempSync(path.join(os.tmpdir(), 'regle-depot-'));
    try {
        const g = (...a) => require('child_process').execFileSync(git, ['-C', depot, '-c', 'user.name=banc', '-c', 'user.email=banc@exemple.invalid', '-c', 'core.autocrlf=false', ...a]);
        g('init', '-q'); fs.mkdirSync(path.join(depot, 'lib'));
        fs.writeFileSync(path.join(depot, 'lib', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
        g('add', 'lib/a.ts'); g('commit', '-q', '-m', 'un');
        const commit = g('rev-parse', 'HEAD').toString().trim();
        fs.writeFileSync(path.join(depot, 'lib', 'a.ts'), 'export const a = 1;\r\nexport const b = 3;\r\n');
        H.v('dépôt fabriqué : le lecteur rend le COMMIT, pas l\'arbre de travail modifié', C.lecteurGit(depot, commit)('a.ts').toString('utf8'), 'export const a = 1;\nexport const b = 2;\n');
        H.v('   le lecteur de dossier, lui, rend l\'arbre (c\'est ce qui changerait les octets)', C.lecteurDossier(path.join(depot, 'lib'))('a.ts').toString('utf8'), 'export const a = 1;\r\nexport const b = 3;\r\n');
    } finally { fs.rmSync(depot, { recursive: true, force: true }); }
    H.v('git introuvable : trouverGit LÈVE (jamais un chemin de version écrit en dur)', /introuvable/.test(leve1(() => C.trouverGit({ LOCALAPPDATA: path.join(os.tmpdir(), 'nexiste-pas-' + process.pid) })) || ''), true);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regle-site-'));
    try {
        if (!absentDuSite) {
            const pin = C.lecteurGit(C.REPO_SITE, C.COMMIT);
            for (const f of Object.keys(emp.sources)) fs.writeFileSync(path.join(tmp, f), pin(f));
            const lec = (dir) => ({ pin: C.lecteurDossier(dir), main: C.lecteurDossier(dir) });
            H.v('copie conforme du site : ok', C.verifier({ siteLib, lecteurs: lec(tmp) }).etat, 'ok');
            fs.appendFileSync(path.join(tmp, 'imageDeLImpression.ts'), '\n// dérive\n');
            const d = C.verifier({ siteLib, lecteurs: lec(tmp) });
            H.v('un fichier du site modifié : DÉRIVE, nommé', [d.etat, d.derives], ['derive', ['imageDeLImpression.ts']]);
            fs.writeFileSync(path.join(tmp, 'imageDeLImpression.ts'), pin('imageDeLImpression.ts'));
            fs.writeFileSync(path.join(tmp, 'visuels-anglais-regardes.json'), JSON.stringify({ cles: ['x'] }));
            H.v('un JSON du site modifié : DÉRIVE, nommé', C.verifier({ siteLib, lecteurs: lec(tmp) }).derives, ['visuels-anglais-regardes.json']);
            fs.writeFileSync(path.join(tmp, 'visuels-anglais-regardes.json'), pin('visuels-anglais-regardes.json'));
            fs.rmSync(path.join(tmp, 'cardmarket.ts'));
            H.v('un fichier du site manquant (dossier présent) : DÉRIVE, pas « absent »', [C.verifier({ siteLib, lecteurs: lec(tmp) }).etat, C.verifier({ siteLib, lecteurs: lec(tmp) }).derives.includes('cardmarket.ts')], ['derive', true]);
            fs.writeFileSync(path.join(tmp, 'cardmarket.ts'), pin('cardmarket.ts'));
            // le `main` du site bouge APRÈS le commit nommé : la dérive est dite, même si le commit nommé est intact
            const apres = nom => (nom === 'impressionDuSet.ts' ? Buffer.concat([pin(nom), Buffer.from('\n// lot suivant\n')]) : pin(nom));
            const dm = C.verifier({ siteLib, lecteurs: { pin: C.lecteurGit(C.REPO_SITE, C.COMMIT), main: apres } });
            H.v('le main du site change impressionDuSet.ts après le commit nommé : DÉRIVE, nommée', [dm.etat, dm.derives], ['derive', ['impressionDuSet.ts']]);
        }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    H.v('dossier du site absent : « site-absent », ni ok ni dérive', C.verifier({ siteLib: path.join(os.tmpdir(), 'nexiste-pas-' + process.pid) }).etat, 'site-absent');

    // la GARDE DE FERMETURE : toute importation relative d'un fichier copié doit viser un fichier de la liste des sources (écrite par ce qu'elle autorise)
    const SANS_EXPR = C.SOURCES.filter(n => n !== 'expressionsSures.ts');
    const SANS_IMP = C.SOURCES.filter(n => n !== 'impressionDuSet.ts');
    if (!absentDuSite) {
        const pin = C.lecteurGit(C.REPO_SITE, C.COMMIT);
        const m = leve1(() => C.produire(pin, SANS_EXPR));
        H.vrai('garde : le site au commit nommé sans expressionsSures.ts dans la liste → produire() LÈVE en nommant le fichier manquant et l\'importeur', m && /expressionsSures/.test(m) && /impressionsDuSet/.test(m));
        const m2 = leve1(() => C.produire(pin, SANS_IMP));
        H.vrai('garde : sans impressionDuSet.ts dans la liste → produire() LÈVE (la copie importerait ./impressionDuSet.mjs, absent), nomme le fichier et l\'importeur', m2 && /impressionDuSet\.ts/.test(m2) && /impressionsDuSet/.test(m2));
        H.v('   la liste réelle (huit sources) produit sans lever', leve1(() => C.produire(pin)), null);
        H.v('   la copie produite importe ./impressionDuSet.mjs ET ce fichier est livré', [/from "\.\/impressionDuSet\.mjs"/.test(C.produire(pin).fichiers['impressionsDuSet.mjs'].toString('utf8')), 'impressionDuSet.mjs' in C.produire(pin).fichiers], [true, true]);
    }
    const L = ['a.ts', 'c.json'];
    H.v('garde : import relatif d\'un fichier de la liste (.ts) : accepté', leve1(() => C.fermeture('a.ts', 'import { x } from "./a.ts";', L)), null);
    H.v('garde : import relatif d\'un JSON de la liste : accepté', leve1(() => C.fermeture('a.ts', 'import c from "./c.json" with { type: "json" };', L)), null);
    H.vrai('garde : import relatif sans extension, même d\'un fichier de la liste : LÈVE (la copie .mjs ne se résoudrait pas)', /a\.ts/.test(leve1(() => C.fermeture('a.ts', "import { x } from './a';", L)) || ''));
    H.vrai('garde : import relatif .ts absent de la liste : LÈVE, nomme le fichier', /b\.ts/.test(leve1(() => C.fermeture('a.ts', 'import { y } from "./b.ts";', L)) || ''));
    H.vrai('garde : import relatif sans extension absent de la liste : LÈVE', /b\.ts/.test(leve1(() => C.fermeture('a.ts', "import { y } from './b';", L)) || ''));
    H.vrai('garde : import relatif remontant (../) : LÈVE, nomme l\'import', /\.\.\/a\.ts/.test(leve1(() => C.fermeture('a.ts', 'import { y } from "../a.ts";', L)) || ''));
    H.vrai('garde : import dynamique relatif absent : LÈVE, nomme le fichier', /b\.ts/.test(leve1(() => C.fermeture('a.ts', 'const m = await import("./b.ts");', L)) || ''));
    H.vrai('garde : réexport relatif absent : LÈVE, nomme le fichier', /b\.ts/.test(leve1(() => C.fermeture('a.ts', 'export * from "./b.ts";', L)) || ''));
    H.v('garde : import NON relatif (module de Node, paquet) : hors du champ, accepté', leve1(() => C.fermeture('a.ts', 'import fs from "node:fs"; import z from "zod"; import q from "b.ts";', L)), null);

    // la règle embarquée se charge, a ses six fonctions, et dit la même chose que celle du site (.ts) sur des cas fabriqués
    const R = require('../chargeur/regle-site');
    const regle = await R.regleEmbarquee();
    H.v('règle embarquée : les sept fonctions', ['fichesDuDocument', 'setParImpression', 'impressionDuSet', 'produitsDeLaFiche', 'visuelAdmisPourLaRegion', 'normaliserNumero', 'cardmarketUrl'].map(k => typeof regle[k]), Array(7).fill('function'));
    let leve = null; try { await R.regleEmbarquee({ importer: async () => ({}) }); } catch (e) { leve = e.message; }
    H.vrai('   un module sans la fonction demandée LÈVE en la nommant (jamais un repli sur une règle vide)', /fichesDuDocument|cardmarketUrl|produitsDeLaFiche/.test(leve || ''));
    const vrai = f => import(require('url').pathToFileURL(path.join(C.DOSSIER, f)).href);
    leve = null; try { await R.regleEmbarquee({ importer: async f => (f === 'impressionDuSet.mjs' ? {} : vrai(f)) }); } catch (e) { leve = e.message; }
    H.vrai('   sans impressionDuSet : LÈVE en la nommant', /impressionDuSet/.test(leve || ''));
    if (etat.etat !== 'site-absent') {
        const site = await require('../migrations/exporter-visuels').chargerRegle();
        const imps = [{ numero: '006', total: '100', rarete: 'Rare' }, { numero: '6' }, { numero: 'TG05', rarete: 'Ultra' }, { numero: null }];
        H.v('   fichesDuDocument : identique au site', regle.fichesDuDocument(imps), site.fichesDuDocument(imps));
        H.v('   normaliserNumero : identique au site', ['006', 6, ' tg05 ', null, '', undefined].map(regle.normaliserNumero), ['006', 6, ' tg05 ', null, '', undefined].map(site.normaliserNumero));
        const vis = [{ cleR2: 'a/1.webp' }, { cleR2: 'artofpkm/2.webp', langue: 'ja' }, { cleR2: 'b/3.webp', langue: 'en' }, { cleR2: 'c/4.webp', languePreuve: 'fichier source 734×1024' }, { cleR2: 'd/5.webp', languePreuve: 'fichier source 1×1' }];
        for (const reg of ['jp', 'intl', 'zh-hans', 'idth', 'ko']) H.v(`   visuelAdmisPourLaRegion(${reg}) : identique au site`, vis.map(v => regle.visuelAdmisPourLaRegion(v, reg)), vis.map(v => site.visuelAdmisPourLaRegion(v, reg)));
        const prod = [{ idProduct: 1, slug: 'Agatha-V1', slugSet: 'X' }, { idProduct: 2, slug: 'Agatha-V2', slugSet: 'X' }, { idProduct: 3, slug: 'Agatha-V3', slugSet: 'X' }];
        H.v('   produitsDeLaFiche : identique au site', [0, 1, 2].map(r => regle.produitsDeLaFiche(prod, r, ['210', '129', '186'], 'SV')), [0, 1, 2].map(r => site.produitsDeLaFiche(prod, r, ['210', '129', '186'], 'SV')));
        H.v('   cardmarketUrl : identique au site', regle.cardmarketUrl({ slug: 'Pikachu-V1-BS58', slugSet: 'Base-Set' }), site.cardmarketUrl({ slug: 'Pikachu-V1-BS58', slugSet: 'Base-Set' }));
    }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
