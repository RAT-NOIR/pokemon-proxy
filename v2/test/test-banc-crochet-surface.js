'use strict';
// B7b.1 tour 2 (M-3, M-4) — LE CROCHET DU BANC NE CONSERVE QUE POUR UNE SURFACE AUTORISÉE, ET EFFACER RESTE PERMIS DEPUIS TOUTE SURFACE DU MÊME PORTEUR.
// Défense en profondeur : la liste blanche du scanner (v2/scanner/routes.js) est la première garde ; ce banc appelle le crochet DIRECTEMENT, hors de cette liste, pour que l'interdiction tienne
// même si un futur chemin appelait traiterReponse / traiterIdentifier avec un corps non filtré. Aucune base, aucun réseau : le banc réel et le détecteur sont des FAUX qui comptent leurs appels.
// RM_CROCHET_ESSAI : chemin d'une COPIE du crochet (pour montrer que le banc tombe quand la garde manque) ; par défaut, le vrai module.
const H = require('./_harnais');
const { lireConfig } = require('../config');
const registre = require('../registre');
const crochet = require(process.env.RM_CROCHET_ESSAI || '../banc/crochet');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const attendre = ms => new Promise(r => setTimeout(r, ms));
const consentement = () => ({ version: cfg.banc.versionsTexte[0], le: new Date().toISOString(), jeton: 'jeton-de-banc-abcdefghij1234' });

(async () => {
    // `reponse` : une CONFIRMATION (choix d'un candidat) ; `abandon` : un effacement (aucune / ne-sait-pas). Le crochet passe les deux à banc.apresReponse, qui aiguille lui-même (routes.js).
    const appels = { verdict: 0, reponse: 0, abandon: 0, detection: 0 };
    registre.fournir('banc', {
        async apresVerdict() { appels.verdict++; },
        async apresReponse(o) { if (o.choix === 'aucune' || o.choix === 'ne-sait-pas') appels.abandon++; else appels.reponse++; },
        async apresAbandon() { appels.abandon++; }
    });
    const detection = async () => { appels.detection++; return { imageRedressee: Buffer.from('x'), detectionSure: true }; };
    const remise = () => { for (const k of Object.keys(appels)) appels[k] = 0; };
    // un porteur de type installation (aucune lecture de base dans la garde du jeton) ; seule la SURFACE varie
    const porteur = surface => ({ type: 'installation', id: 'i1', compte: null, installation: { jetonEmpreinte: 'acces-empreinte' }, surface, administrateur: false });
    const requete = (surface, corps) => ({ v2: { porteur: porteur(surface) }, body: corps, entree: { imageUrls: ['https://images1.vinted.net/x.webp'] } });
    const analyseFerme = { statut: 'identifiee', cartes: [{ statut: 'identifiee', carte: { idProduct: 895789 } }] };
    const analyseQuestion = { statut: 'a-trancher', cartes: [{ statut: 'a-trancher', carte: null, candidats: [{ idProduct: 1 }, { idProduct: 2 }] }] };
    const corps = { consentementBanc: consentement() };
    const SURFACES_REFUSEES = ['scanner', 'inconnue', undefined, null, '', 'Extension'];   // « Extension » : la comparaison est exacte, jamais approchée

    // ── (0) CONTRÔLE POSITIF : la surface « extension » conserve (sinon « ne conserve rien » ne dirait rien)
    crochet.apresIdentifier({ cfg, deps: { detection }, req: requete('extension', corps), scanId: 's1', analyse: analyseFerme });
    await attendre(200);
    H.v('0. surface « extension », consentement valide, verdict ferme : le détecteur est appelé et le banc reçoit apresVerdict', [appels.detection, appels.verdict], [1, 1]);
    remise();
    crochet.apresReponse({ cfg, req: requete('extension', { ...corps, choix: 'a' }), scanId: 's1', carte: 0, choix: 'a', idProduct: 895789 });
    await attendre(200);
    H.v('   … et une réponse par un candidat arrive à apresReponse', appels.reponse, 1);
    remise();

    // ── (1) M-3 : toute autre surface ne CONSERVE rien — ni par l'analyse, ni par la réponse d'un candidat
    for (const s of SURFACES_REFUSEES) {
        remise();
        crochet.apresIdentifier({ cfg, deps: { detection }, req: requete(s, corps), scanId: 's2', analyse: analyseFerme });
        crochet.apresIdentifier({ cfg, deps: { detection }, req: requete(s, corps), scanId: 's3', analyse: analyseQuestion });
        crochet.apresReponse({ cfg, req: requete(s, { ...corps, choix: 'a' }), scanId: 's2', carte: 0, choix: 'a', idProduct: 895789 });
        await attendre(200);
        H.v(`1. surface ${JSON.stringify(s)} avec un consentement valide : détecteur 0, apresVerdict 0, apresReponse 0 (3 appels du crochet, dénominateur 3)`, [appels.detection, appels.verdict, appels.reponse], [0, 0, 0]);
    }

    // ── (2) M-4 : un ABANDON efface, depuis toute surface du même porteur (effacer n'est jamais conserver) — et M-3 ne le bloque pas
    for (const s of ['extension', 'scanner', 'inconnue']) for (const choix of ['aucune', 'ne-sait-pas']) {
        remise();
        crochet.apresReponse({ cfg, req: requete(s, { choix }), scanId: 's2', carte: 0, choix, idProduct: null });
        await attendre(150);
        H.v(`2. abandon « ${choix} » depuis la surface « ${s} », sans consentement : apresAbandon appelé une fois, rien conservé`, [appels.abandon, appels.reponse, appels.verdict], [1, 0, 0]);
    }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
