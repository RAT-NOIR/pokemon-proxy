'use strict';
// B7b.1 Step 3 — LES VECTEURS DE L'EXTENSION (extension v2\src\fond\fausses\*, LECTURE SEULE) rejoués contre le schéma publié.
// Tout écart de FORME doit être ÉCRIT dans CONTRAT-API-V2.md §7.3 bis (route, statut, chemin JSON, ce que l'extension attend, ce que le serveur rend, qui doit changer) : jamais corrigé en silence.
// Le banc classe chaque écart observé par sa clé EXACTE « route statut chemin-normalisé » (jamais par un préfixe : un préfixe absorberait une faute neuve) ; une clé sans référence fait
// échouer le banc ; et chaque clé doit figurer sur UNE ligne du tableau 7.3 bis qui porte, ensemble, la route, le statut et le chemin. Le banc n'écrit rien dans `extension v2`.
const H = require('./_harnais');
const fs = require('fs'), path = require('path');
const A = require('./_contrat-reel-aide');
const { valider } = require('../openapi/valider');
const { SCHEMA, ref } = A;

const DOSSIER = process.env.RM_EXTENSION_FAUSSES || 'C:\\Users\\Yung\\Desktop\\extension v2\\src\\fond\\fausses';
const CONTRAT = fs.readFileSync(path.join(__dirname, '..', '..', 'CONTRAT-API-V2.md'), 'utf8');
const section73 = (() => { const i = CONTRAT.indexOf('#### 7.3 bis'), j = CONTRAT.indexOf('### 7.4'); return i >= 0 && j > i ? CONTRAT.slice(i, j) : ''; })();
const lignes73 = section73.split(/\r?\n/).filter(l => l.startsWith('|'));

const ANALYSES = ['identifiee.json', 'identifiee-impressions.json', 'a-trancher-2.json', 'a-trancher-3.json', 'lot.json', 'introuvable.json'];
const COUVERTS = [...ANALYSES, 'quota.json', 'reponses.json', 'lectures.json', 'reels.js'];
// Normalisation : les indices de tableau, l'identifiant de scan et le nom du choix des vecteurs ne sont pas des chemins du contrat.
const norm = c => c.replace(/\[\d+\]/g, '[]').replace(/\$\.fausse-[a-z]+-\d+/, '$.<scanId>').replace(/^(\$\.<scanId>\[\])\.(a|b|c|aucune|ne-sait-pas)\./, '$1.<choix>.');

// LA CLASSIFICATION : clé exacte -> référence de §7.3. Une clé absente d'ici est NOUVELLE et fait échouer le banc.
const E = (r, route, statut, chemins) => chemins.map(c => [`${route} ${statut} ${c}`, r]);
const CLASSES = new Map([
    // E1 (clés de `solde`) retiré : les vecteurs n'ont plus de `solde` du tout (DEMANDE-SERVEUR-EXTENSION §B5) ; le manque se classe sous E3.
    // E11 (`set.slug`) et E5 (`impressions`, `prixGuide.moyenne30`, `prixGuide.date` des impressions) retirés : l'extension a fermé ces écarts (son lot H, afbbe58) ; une clé qui reviendrait serait NOUVELLE et ferait échouer le banc.
    ...E('E12', 'POST /api/identifier', 200, ['$.analyse.cartes[].etat.declare']),      // §B7 : l'extension ne lit plus l'état déclaré
    ...E('E13', 'POST /api/identifier', 200, ['$.offre']),                               // OFFRE-QUOTA : l'objet `offre` (nom, restant, remiseAZero), absent des vecteurs de l'extension
    ...E('E2', 'POST /api/identifier', 200, ['$.facturation']),                          // §B5 : plus de `facturation` (sauf motif administrateur)
    ...E('E2', 'POST /api/identifier/reponse', 200, ['$.<scanId>[].<choix>.facturation']),
    ...E('E3', 'POST /api/identifier', 200, ['$.solde']),
    ...E('E4', 'POST /api/identifier', 200, ['$.question']),
    ...E('E6', 'POST /api/identifier', 200, ['$.analyse.cartes[].etat']),
    ...E('E7', 'POST /api/identifier', 429, ['$.facturation']),
    ...E('E8', 'POST /api/identifier', 200, ['$.analyse.cartes[].carte.visuel.url', '$.analyse.cartes[].carte.visuel.grande', '$.analyse.cartes[].candidats[].visuel.url'])
]);

(async () => {
    H.vrai(`le dossier des vecteurs de l'extension existe (${DOSSIER})`, fs.existsSync(DOSSIER));
    if (!fs.existsSync(DOSSIER)) return H.bilan();
    const presents = fs.readdirSync(DOSSIER).filter(f => fs.statSync(path.join(DOSSIER, f)).isFile()).sort();
    console.log(`   ${presents.length} fichiers : ${presents.join(', ')}`);
    H.v('tous les fichiers couverts par ce banc sont là', COUVERTS.filter(f => !presents.includes(f)), []);
    H.v('« aucun fichier non couvert » dit la vérité sur le dossier : tout fichier présent est couvert (rejoué, ou déclaré non couvert avec sa raison)', presents.filter(f => !COUVERTS.includes(f)), []);
    const lire = f => JSON.parse(fs.readFileSync(path.join(DOSSIER, f), 'utf8'));
    const observes = [];                                         // { fichier, route, statut, chemin, message }
    const verser = (fichier, route, statut, erreurs) => { for (const e of erreurs) observes.push({ fichier, route, statut, chemin: e.chemin, message: e.message }); };

    // La réponse d'analyse est jugée carte par carte contre la branche de SON statut (le oneOf des cartes n'indique que la PREMIÈRE faute), et l'enveloppe avec `cartes` vidé.
    const BRANCHE = { identifiee: 'CarteIdentifiee', 'a-trancher': 'CarteATrancher', introuvable: 'CarteIntrouvable' };
    function juger200(nom, j) {
        const cartes = (j.analyse && j.analyse.cartes) || [];
        const enveloppe = JSON.parse(JSON.stringify(j)); if (enveloppe.analyse) enveloppe.analyse.cartes = [];
        verser(nom, 'POST /api/identifier', 200, valider(enveloppe, ref('ReponseAnalyse'), SCHEMA).erreurs.filter(e => e.chemin !== '$.analyse.cartes'));
        cartes.forEach((c, i) => {
            const b = BRANCHE[c && c.statut];
            if (!b) return verser(nom, 'POST /api/identifier', 200, [{ chemin: `$.analyse.cartes[${i}].statut`, message: `statut « ${c && c.statut} » inconnu du contrat` }]);
            // `visuel` et `prixGuide` sont des « null ou objet » : le oneOf ne dit rien de la faute de l'objet, qui est donc jugé DIRECTEMENT (chemin d'origine conservé)
            const dessous = (v, chemin, sortie) => {
                if (Array.isArray(v)) return v.forEach((x, k) => dessous(x, `${chemin}[${k}]`, sortie));
                if (!v || typeof v !== 'object') return;
                for (const [k, x] of Object.entries(v)) {
                    if (x && typeof x === 'object' && !Array.isArray(x) && (k === 'visuel' || k === 'prixGuide'))
                        for (const e of valider(x, ref(k === 'visuel' ? 'Visuel' : 'PrixGuide'), SCHEMA).erreurs) sortie.push({ chemin: `${chemin}.${k}${e.chemin.slice(1)}`, message: e.message });
                    dessous(x, `${chemin}.${k}`, sortie);
                }
            };
            const propres = valider(c, ref(b), SCHEMA).erreurs.map(e => ({ chemin: `$.analyse.cartes[${i}]${e.chemin.slice(1)}`, message: e.message })).filter(e => !/\.(visuel|prixGuide)$/.test(e.chemin));
            const profondes = []; dessous(c, `$.analyse.cartes[${i}]`, profondes);
            verser(nom, 'POST /api/identifier', 200, [...propres, ...profondes]);
        });
    }
    for (const f of ANALYSES) juger200(f, lire(f));
    verser('quota.json', 'POST /api/identifier', 429, valider(lire('quota.json'), ref('ReponseErreur'), SCHEMA).erreurs);

    // ── reels.js (I5) : un module de DONNÉES ? Lu en texte, jamais importé : on refuse d'exécuter autre chose que des constructions d'objets.
    let reels = null;
    {
        const src = fs.readFileSync(path.join(DOSSIER, 'reels.js'), 'utf8');
        const interdits = src.replace(/\/\/.*$/gm, '').match(/\b(import|require|fetch|XMLHttpRequest|chrome|process|eval|Function|setTimeout|setInterval|localStorage|document|window|globalThis|Date|Math\.random)\b/g) || [];
        const exports_ = src.match(/^\s*export\s/gm) || [];
        const pur = interdits.length === 0 && exports_.length === 1 && /export const REELS\s*=/.test(src);
        console.log(`   reels.js : ${pur ? 'module de DONNÉES pur (aucun import, aucun appel système, un seul export REELS) — ses réponses sont rejouées' : 'NON couvert : ' + (interdits.join(', ') || 'forme inattendue')}`);
        H.vrai('reels.js : module de données pur (sinon il serait déclaré non couvert, avec sa raison)', pur);
        if (pur) reels = new Function(`${src.replace(/^\s*export const REELS/m, 'const REELS')}\nreturn REELS;`)();
    }
    if (reels) {
        const noms = Object.keys(reels);
        console.log(`   reels.js : ${noms.length} réponses rejouées (${noms.join(', ')})`);
        H.vrai('reels.js : le dénominateur est non nul', noms.length > 0);
        for (const k of noms) juger200(`reels.js:${k}`, reels[k]);
    }

    // ── reponses.json (I6) : validé EN ENTIER. Le corps complet que le serveur rendrait est RECONSTRUIT depuis les champs du vecteur (statut, raison, état visé, langues, facturation)
    //    et d'un produit VALIDE du serveur (la fausse publiée a-trancher-2), puis jugé contre ReponseQuestion : toute faute vient du vecteur, pas du produit.
    {
        const j = lire('reponses.json'), fausse = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi', 'fausses', f), 'utf8'));
        const modele2 = fausse('a-trancher-2.json'), modele3 = fausse('a-trancher-3.json'), soldeModele = modele2.solde, offreModele = modele2.offre; let n = 0;      // OFFRE-QUOTA : `offre` est servi par le serveur à côté du solde ; la reconstruction le prend de la fausse publiée (ce n'est pas un champ que reponses.json porte)
        let aTrancher = modele2.analyse.cartes[0];
        for (const [scan, parCarte] of Object.entries(j)) {
            if (scan.startsWith('_')) continue;
            // la fausse du serveur qui a AUTANT de candidats que le scénario en désigne (2 ou 3)
            const plusGrand = Math.max(...Object.values(parCarte).flatMap(pc => Object.values(pc).map(r => (r.candidat === undefined ? 0 : r.candidat))));
            aTrancher = (plusGrand >= 2 ? modele3 : modele2).analyse.cartes[0];
            for (const [carte, parChoix] of Object.entries(parCarte)) for (const [choix, r] of Object.entries(parChoix)) {
                n++;
                const index = Number(carte);
                let c;
                if (r.statut === 'identifiee') c = { index, statut: 'identifiee', carte: aTrancher.candidats[r.candidat], candidats: [], question: null, raison: null, etat: { estime: r.etatVise, confiance: 'moyenne', defauts: [], declare: null, retenu: r.etatVise }, prixLive: { idProduct: aTrancher.candidats[r.candidat].idProduct, langues: r.langues, reverseHolo: false, etatVise: r.etatVise }, zone: null };
                else if (r.statut === 'introuvable') c = { index, statut: 'introuvable', carte: null, candidats: [], question: null, raison: r.raison, etat: null, prixLive: null, zone: null };
                else if (r.statut === 'inchangee') c = { ...aTrancher, index };
                else { verser('reponses.json', 'POST /api/identifier/reponse', 200, [{ chemin: `$.${scan}[${carte}].${choix}.statut`, message: `statut de carte « ${r.statut} » hors du contrat` }]); continue; }
                const corps = { success: true, carte: c, facturation: r.facturation, solde: soldeModele, offre: offreModele };
                verser('reponses.json', 'POST /api/identifier/reponse', 200, valider(corps, ref('ReponseQuestion'), SCHEMA).erreurs.map(e => ({ chemin: `$.${scan}[${carte}].${choix}${e.chemin.slice(1)}`, message: e.message })));
            }
        }
        console.log(`   reponses.json : ${n} réponses RECONSTRUITES en entier (carte, facturation, solde) et jugées contre ReponseQuestion`);
        H.vrai('reponses.json : le dénominateur est non nul', n > 0);
        // le contrôle de reconstruction sait dire NON : une facturation correcte et un produit valide donnent un corps valide
        aTrancher = modele2.analyse.cartes[0];
        const saine = { success: true, carte: { index: 0, statut: 'identifiee', carte: aTrancher.candidats[0], candidats: [], question: null, raison: null, etat: { estime: 'EX', confiance: 'moyenne', defauts: [], declare: null, retenu: 'EX' }, prixLive: { idProduct: aTrancher.candidats[0].idProduct, langues: [1], reverseHolo: false, etatVise: 'EX' }, zone: null },
            facturation: { debite: 1, reserve: 0, rembourse: false, motif: 'question', raisonNonRembourse: null }, solde: soldeModele, offre: offreModele };
        H.v('contrôle : une réponse reconstruite SAINE passe ReponseQuestion', valider(saine, ref('ReponseQuestion'), SCHEMA).erreurs, []);
        H.vrai('contrôle : la même, sans raisonNonRembourse, est refusée', valider({ ...saine, facturation: { debite: 1, reserve: 0, rembourse: false, motif: 'question' } }, ref('ReponseQuestion'), SCHEMA).erreurs.length > 0);
    }
    // ── lectures.json : ce n'est PAS une réponse du serveur (grilles de la lecture live simulée) ; ses états et ses prix tiennent la liste fermée du contrat
    {
        const j = lire('lectures.json'); const etats = SCHEMA.components.schemas.EtatCarte.properties.estime.enum.filter(x => x !== null); let n = 0;
        for (const [id, grille] of Object.entries(j)) {
            if (id.startsWith('_')) continue; n++;
            const mauvais = Object.entries(grille).filter(([k, v]) => !etats.includes(k) || !(v === null || (typeof v === 'number' && v > 0)));
            verser('lectures.json', '(client seul)', 0, mauvais.map(([k]) => ({ chemin: `$.${id}.${k}`, message: 'état ou prix hors du contrat' })));
        }
        console.log(`   lectures.json : ${n} grilles (données de la lecture live simulée, jamais envoyées au serveur) : états ⊂ ${etats.join('/')}`);
        H.vrai('lectures.json : le dénominateur est non nul', n > 0);
    }

    // ── le tableau des écarts : un par clé EXACTE « route statut chemin »
    const fichierDe = f => f.replace(/^reels\.js:.*/, 'reels.js');
    const groupes = new Map();
    for (const o of observes) { const cle = `${o.route} ${o.statut} ${norm(o.chemin)}`; const g = groupes.get(cle) || { cle, ref: CLASSES.get(cle) || null, route: o.route, statut: o.statut, chemin: norm(o.chemin), fichiers: new Set(), message: o.message }; g.fichiers.add(fichierDe(o.fichier)); groupes.set(cle, g); }
    console.log(`   ${observes.length} écart(s) de forme observé(s) dans ${new Set(observes.map(o => fichierDe(o.fichier))).size} fichier(s), ${groupes.size} (route, statut, chemin) distinct(s)`);
    for (const g of [...groupes.values()].sort((a, b) => String(a.ref).localeCompare(String(b.ref)) || a.cle.localeCompare(b.cle))) console.log(`   ${g.ref || 'NOUVEAU'}  [${[...g.fichiers].join(', ')}] ${g.cle} : ${g.message.slice(0, 110)}`);
    H.v('écarts SANS référence exacte (un écart ne se corrige pas en silence ; une faute neuve n\'est jamais absorbée par un préfixe)', [...groupes.values()].filter(g => !g.ref).map(g => g.cle), []);
    // la classification ne contient pas de clé morte : chaque clé déclarée a été OBSERVÉE (un écart réparé côté extension retire sa ligne du tableau)
    H.v('clés de classification jamais observées (à retirer, avec leur ligne de §7.3 bis)', [...CLASSES.keys()].filter(k => !groupes.has(k)), []);
    // preuve de présence au §7.3 bis par LIGNE EXACTE : la route, le statut ET le chemin dans la même ligne de tableau
    const ligneDe = g => lignes73.some(l => l.includes('`' + g.route + '` ' + g.statut) && l.includes('`' + g.chemin + '`') && l.includes('| ' + g.ref + ' |'));
    console.log(`   §7.3 bis : ${lignes73.length} lignes de tableau, ${groupes.size} écarts à retrouver`);
    H.v('chaque (route, statut, chemin) mesuré a UNE ligne de §7.3 bis qui porte sa référence, sa route, son statut et son chemin', [...groupes.values()].filter(g => g.ref && !ligneDe(g)).map(g => g.cle), []);
    H.v('§7.3 bis ne porte aucune ligne d\'écart fantôme (une ligne E… dont la clé n\'est plus observée)', lignes73.filter(l => /^\| E\d+ \|/.test(l)).filter(l => ![...groupes.values()].some(g => ligneDe(g) && l.includes('`' + g.chemin + '`') && l.includes('`' + g.route + '` ' + g.statut))).map(l => l.slice(0, 90)), []);
    H.v('§7.3 bis dit « qui doit changer », « l\'extension attend » et « le serveur rend »', ['qui doit changer', 'l\'extension attend', 'le serveur rend'].filter(m => !section73.includes(m)), []);
    // le classeur sait dire NON : une faute neuve n'est rangée sous aucune référence, même sous un chemin déjà classé (pas de préfixe)
    H.v('le classeur ne range pas une faute neuve, même sous un chemin déjà classé', ['POST /api/identifier 200 $.solde.nouveau', 'POST /api/identifier 200 $.analyse.cartes[].carte.visuel.nouveau', 'POST /api/identifier 200 $.analyse.cartes[].etat.nouveau', 'POST /api/identifier 200 $.zzz'].map(k => CLASSES.get(k) || null), [null, null, null, null]);
    // contrôle positif : la fausse publiée du SERVEUR passe la même épreuve sans écart
    {
        const f = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi', 'fausses', 'identifiee.json'), 'utf8'));
        const avant = observes.length; juger200('(fausse du serveur)', f);
        H.v('contrôle : une fausse du SERVEUR (publiée) passe la même épreuve sans écart', observes.length - avant, 0);
        observes.length = avant;
    }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
