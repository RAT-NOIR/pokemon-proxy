'use strict';
// B7b.1 Step 3 — LES VECTEURS DE L'EXTENSION (extension v2\src\fond\fausses\*.json, LECTURE SEULE) rejoués contre le schéma publié.
// Tout écart de FORME doit être ÉCRIT dans CONTRAT-API-V2.md §7.3 (ce que l'extension attend, ce que le serveur rend, qui doit changer) : jamais corrigé en silence d'un côté.
// Le banc classe chaque écart observé sous une référence E… et exige (1) qu'aucun écart ne reste sans référence, (2) que §7.3 porte cette référence. Il ne lit AUCUN secret,
// n'écrit rien dans `extension v2`, n'ouvre aucune base.
const H = require('./_harnais');
const fs = require('fs'), path = require('path');
const A = require('./_contrat-reel-aide');
const { valider } = require('../openapi/valider');
const { SCHEMA, ref } = A;

const DOSSIER = process.env.RM_EXTENSION_FAUSSES || 'C:\\Users\\Yung\\Desktop\\extension v2\\src\\fond\\fausses';
const CONTRAT = fs.readFileSync(path.join(__dirname, '..', '..', 'CONTRAT-API-V2.md'), 'utf8');
const section73 = (() => { const i = CONTRAT.indexOf('### 7.3'), j = CONTRAT.indexOf('## 8.'); return i >= 0 && j > i ? CONTRAT.slice(i, j) : ''; })();

// Les vecteurs et le schéma contre lequel chacun est jugé (route + statut que le serveur lui donnerait).
const ANALYSES = ['identifiee.json', 'identifiee-impressions.json', 'a-trancher-2.json', 'a-trancher-3.json', 'lot.json', 'introuvable.json'];
const norm = c => c.replace(/\[\d+\]/g, '[]').replace(/fausse-[a-z]+-\d+/, '<scanId>').replace(/(\[\])\.(a|b|c|aucune|ne-sait-pas)\./, '$1.<choix>.');
// La classification des écarts : (motif du chemin normalisé, nature) -> référence de §7.3. Un écart qui n'entre dans aucune classe est NOUVEAU.
const CLASSES = [
    { ref: 'E1', quand: e => /^\$\.solde\.(soldeGratuit|restantSemaine|soldeScans)$/.test(e.chemin) || /^\$\.solde\.(essai|abonnement)$/.test(e.chemin) || /^\$\.solde\.compte\.verifie$/.test(e.chemin) || /^\$\.solde\.compte$/.test(e.chemin) },
    { ref: 'E2', quand: e => /\.facturation\.(reserve)$/.test(e.chemin) || /\.facturation\.raisonNonRembourse$/.test(e.chemin) || /^\$\.facturation\.reserve$/.test(e.chemin) },
    { ref: 'E3', quand: e => e.chemin === '$.solde' },
    { ref: 'E4', quand: e => e.chemin === '$.question' },
    { ref: 'E5', quand: e => /prixGuide/.test(e.chemin) || /\.impressions$/.test(e.chemin) },
    { ref: 'E6', quand: e => /\.etat$/.test(e.chemin) || /\.etat\./.test(e.chemin) },
    { ref: 'E7', quand: e => /^\$\.facturation\.motif$/.test(e.chemin) || /^\$\.facturation$/.test(e.chemin) },
    { ref: 'E8', quand: e => /\.visuel(\.|$)/.test(e.chemin) },
    { ref: 'E9', quand: e => /\.liens\.cardmarket$/.test(e.chemin) || /\.variante$/.test(e.chemin) }
];
const classe = e => (CLASSES.find(c => c.quand(e)) || {}).ref || null;

(async () => {
    H.vrai(`le dossier des vecteurs de l'extension existe (${DOSSIER})`, fs.existsSync(DOSSIER));
    if (!fs.existsSync(DOSSIER)) return H.bilan();
    const presents = fs.readdirSync(DOSSIER).filter(f => f.endsWith('.json')).sort();
    console.log(`   ${presents.length} fichiers de vecteurs : ${presents.join(', ')}`);
    H.v('les 9 fichiers de vecteurs attendus sont là', [...ANALYSES, 'quota.json', 'reponses.json', 'lectures.json'].filter(f => !presents.includes(f)), []);
    H.v('aucun fichier de vecteur non couvert par ce banc', presents.filter(f => ![...ANALYSES, 'quota.json', 'reponses.json', 'lectures.json'].includes(f)), []);
    const lire = f => JSON.parse(fs.readFileSync(path.join(DOSSIER, f), 'utf8'));
    const observes = [];                                         // { fichier, route, statut, chemin, message, ref }
    const verser = (fichier, route, statut, erreurs) => { for (const e of erreurs) observes.push({ fichier, route, statut, chemin: e.chemin, message: e.message, ref: classe(e) }); };

    // 1. les six réponses d'analyse : contre ce que POST /api/identifier documente pour un 200
    // (jugées contre ReponseAnalyse DIRECTEMENT : la racine du 200 est un oneOf [analyse | erreur] qui masquerait le chemin exact de chaque écart)
    // Le oneOf des cartes n'indique que la PREMIÈRE faute de la branche la plus proche : chaque carte est donc jugée directement contre la branche de SON statut (toutes ses fautes),
    // et la réponse est jugée une fois avec `cartes` vidé (le reste de l'enveloppe).
    const BRANCHE = { identifiee: 'CarteIdentifiee', 'a-trancher': 'CarteATrancher', introuvable: 'CarteIntrouvable' };
    for (const f of ANALYSES) {
        const j = lire(f), cartes = (j.analyse && j.analyse.cartes) || [];
        const enveloppe = JSON.parse(JSON.stringify(j)); if (enveloppe.analyse) enveloppe.analyse.cartes = [];
        verser(f, 'POST /api/identifier', 200, valider(enveloppe, ref('ReponseAnalyse'), SCHEMA).erreurs.filter(e => e.chemin !== '$.analyse.cartes'));
        cartes.forEach((c, i) => {
            const b = BRANCHE[c && c.statut];
            if (!b) return verser(f, 'POST /api/identifier', 200, [{ chemin: `$.analyse.cartes[${i}].statut`, message: `statut « ${c && c.statut} » inconnu du contrat` }]);
            // `visuel` et `prixGuide` sont des « null ou objet » : le oneOf ne dit rien de la faute de l'objet, qui est donc jugé DIRECTEMENT (chemin d'origine conservé)
            const dansNul = e => /type attendu null, reçu object$/.test(e.message) && /\.(visuel|prixGuide)(\[\d+\])?$/.test(e.chemin.replace(/ .*/, ''));
            const dessous = (v, chemin, sortie) => {
                if (Array.isArray(v)) return v.forEach((x, k) => dessous(x, `${chemin}[${k}]`, sortie));
                if (!v || typeof v !== 'object') return;
                for (const [k, x] of Object.entries(v)) {
                    if (x && typeof x === 'object' && !Array.isArray(x) && (k === 'visuel' || k === 'prixGuide'))
                        for (const e of valider(x, ref(k === 'visuel' ? 'Visuel' : 'PrixGuide'), SCHEMA).erreurs) sortie.push({ chemin: `${chemin}.${k}${e.chemin.slice(1)}`, message: e.message });
                    dessous(x, `${chemin}.${k}`, sortie);
                }
            };
            const propres = valider(c, ref(b), SCHEMA).erreurs.map(e => ({ chemin: `$.analyse.cartes[${i}]${e.chemin.slice(1)}`, message: e.message })).filter(e => !dansNul(e) && !/\.(visuel|prixGuide)$/.test(e.chemin));
            const profondes = []; dessous(c, `$.analyse.cartes[${i}]`, profondes);
            // un oneOf de carte qui masque la faute d'un sous-objet est remplacé par les fautes DÉTAILLÉES (sinon une faute n'apparaît que dans le message du oneOf)
            verser(f, 'POST /api/identifier', 200, [...propres, ...profondes]);
        });
    }
    // 2. le refus : contre le 429 de POST /api/identifier (QUOTA), c'est-à-dire ReponseErreur
    verser('quota.json', 'POST /api/identifier', 429, valider(lire('quota.json'), ref('ReponseErreur'), SCHEMA).erreurs);
    // 3. les réponses à une question : { success, carte, facturation, solde } -> chaque `facturation` du vecteur contre Facturation, chaque statut/raison contre les listes du contrat
    {
        const j = lire('reponses.json'); let n = 0;
        const statutsCarte = new Set(['identifiee', 'a-trancher', 'introuvable']);
        const raisons = new Set(SCHEMA.components.schemas.CarteIntrouvable.properties.raison.enum.filter(x => x !== null));
        for (const [scan, parCarte] of Object.entries(j)) {
            if (scan.startsWith('_')) continue;
            for (const [carte, parChoix] of Object.entries(parCarte)) for (const [choix, r] of Object.entries(parChoix)) {
                n++;
                const ou = `$.${scan}[${carte}].${choix}`;
                const fac = valider(r.facturation, ref('Facturation'), SCHEMA).erreurs.map(e => ({ chemin: `${ou}.facturation${e.chemin.slice(1)}`, message: e.message }));
                verser('reponses.json', 'POST /api/identifier/reponse', 200, fac);
                if (r.statut !== 'inchangee' && !statutsCarte.has(r.statut)) verser('reponses.json', 'POST /api/identifier/reponse', 200, [{ chemin: `${ou}.statut`, message: `statut de carte « ${r.statut} » hors du contrat` }]);
                if (r.raison !== undefined && !raisons.has(r.raison)) verser('reponses.json', 'POST /api/identifier/reponse', 200, [{ chemin: `${ou}.raison`, message: `raison « ${r.raison} » hors du contrat` }]);
                if (r.etatVise !== undefined && !SCHEMA.components.schemas.EtatCarte.properties.estime.enum.includes(r.etatVise)) verser('reponses.json', 'POST /api/identifier/reponse', 200, [{ chemin: `${ou}.etatVise`, message: `état « ${r.etatVise} » hors du contrat` }]);
            }
        }
        console.log(`   reponses.json : ${n} réponses simulées jugées`);
        H.vrai('reponses.json : le dénominateur est non nul', n > 0);
    }
    // 4. les grilles de la lecture live : ce n'est PAS une réponse du serveur (le serveur ne reçoit que prixLive/prixLiveEtat) ; on vérifie que ses états sont ceux du contrat
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

    // ── le tableau des écarts : un par (référence, chemin normalisé)
    const groupes = new Map();
    for (const o of observes) { const k = `${o.ref || '??'}|${norm(o.chemin)}|${o.message}`; const g = groupes.get(k) || { ...o, chemin: norm(o.chemin), fichiers: new Set() }; g.fichiers.add(o.fichier); groupes.set(k, g); }
    console.log(`   ${observes.length} écart(s) de forme observé(s) dans ${new Set(observes.map(o => o.fichier)).size} fichier(s), ${groupes.size} distinct(s)`);
    for (const g of [...groupes.values()].sort((a, b) => String(a.ref).localeCompare(String(b.ref)))) console.log(`   ${g.ref || 'NOUVEAU'}  ${g.fichiers.size > 1 ? '[' + g.fichiers.size + ' fichiers] ' : '[' + [...g.fichiers][0] + '] '}${g.route} ${g.statut} ${g.chemin} : ${g.message.slice(0, 150)}`);
    H.v('écarts SANS référence dans CONTRAT-API-V2.md §7.3 (un écart ne se corrige pas en silence)', [...groupes.values()].filter(g => !g.ref).map(g => `${[...g.fichiers].join(',')} ${g.chemin} : ${g.message.slice(0, 100)}`), []);
    const refs = [...new Set([...groupes.values()].map(g => g.ref).filter(Boolean))].sort();
    H.v(`les références observées (${refs.join(', ')}) figurent toutes dans §7.3`, refs.filter(r => !new RegExp(`\\|\\s*${r}\\s*\\|`).test(section73)), []);
    // §7.3 doit porter, pour chaque écart, son CHEMIN JSON exact (et la route) : le tableau 7.3 bis est écrit à partir de cette mesure
    const chemins = [...new Set([...groupes.values()].filter(g => g.route.startsWith('POST')).map(g => `${g.route} ${g.statut} ${g.chemin}`))].sort();
    H.vrai(`dénominateur : ${chemins.length} (route, statut, chemin JSON) distincts mesurés`, chemins.length > 0);
    H.v('chaque (route, statut, chemin JSON) mesuré est écrit tel quel dans §7.3 bis', chemins.filter(c => !section73.includes(c.split(' ').slice(3).join(' ')) || !section73.includes(c.split(' ').slice(0, 2).join(' '))), []);
    H.v('§7.3 bis dit « qui doit changer » (colonne) et nomme l\'extension et le serveur', ['qui doit changer', 'l\'extension attend', 'le serveur rend'].filter(m => !section73.includes(m)), []);
    // le classeur sait dire NON : un écart d'une forme inconnue n'a aucune référence (il fait échouer le banc, il n'est jamais rangé sous une référence voisine)
    H.v('le classeur ne range pas un écart inconnu sous une référence', [classe({ chemin: '$.analyse.cartes[0].carte.nouveauChamp' }), classe({ chemin: '$.zzz' })], [null, null]);
    // la propriété inverse sur les vecteurs : un vecteur CONFORME au serveur est accepté (la fausse publiée du serveur, jugée par la même fonction)
    {
        const f = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi', 'fausses', 'identifiee.json'), 'utf8'));
        H.v('contrôle : une fausse du SERVEUR (publiée) passe la même épreuve sans écart', A.juger('POST /api/identifier', 200, f, JSON.stringify(f), { 'content-type': 'application/json' }).length, 0);
    }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
