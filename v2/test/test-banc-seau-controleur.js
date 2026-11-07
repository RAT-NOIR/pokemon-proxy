'use strict';
// BANC-200 (tour 1, relecture 2 I2) — la LOGIQUE de la page de saisie (outils/banc-200/controleur.js), exécutée avec une fausse API et un faux écran : candidats masqués par défaut (aucun appel à /candidats sans demande),
// ordre par prix croissant, confirmation Entrée-Entrée, passage au scan suivant, « pas une carte » / « hors catalogue » avec confirmation.
const H = require('./_harnais');
const { creer, trierParPrix } = require('../../outils/banc-200/controleur');

const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.stack || e.message)), 'aucune'); } };

// une fausse API qui note ses appels et sert une liste de deux scans, étiquetés au fil des vérités reçues
function fabriquer({ jeton = true, candidats = null, resolution = null } = {}) {
    const appels = [];
    const scans = [{ scanId: 'a'.repeat(24), rang: 1, photos: 2, cartes: 1, etiquetees: 0 }, { scanId: 'b'.repeat(24), rang: 2, photos: 1, cartes: 1, etiquetees: 0 }];
    const api = async (methode, chemin, corps) => {
        appels.push({ methode, chemin, corps });
        if (chemin === '/_etat') return { statut: 200, json: { success: true, jeton } };
        if (chemin === '/api/banc/seau/courant') return { statut: 200, json: { success: true, seau: { id: '0123456789abcdef', nom: 'juge-200', type: 'juge', cible: 2, n: 2 } } };
        if (chemin.startsWith('/api/banc/seau/a-etiqueter')) { const p = scans.find(s => s.etiquetees < s.cartes); return { statut: 200, json: { success: true, scans: scans.map(s => ({ ...s })), prochain: p ? p.scanId : null } }; }
        if (chemin === '/api/banc/seau/candidats') return { statut: 200, json: { success: true, candidats: candidats || [] } };
        if (chemin === '/api/banc/resoudre-cardmarket') return resolution || { statut: 200, json: { success: true, idProduct: 777, nom: 'Pikachu', set: { nom: 'Jungle' }, numero: '60' } };
        if (chemin === '/api/banc/seau/verite') { scans.find(s => s.scanId === corps.scanId).etiquetees++; return { statut: 200, json: { success: true, rev: 1, candidatsVus: false } }; }
        return { statut: 404, json: null };
    };
    const ecran = { scan: null, attente: undefined, candidats: undefined, messages: [], vide: 0, session: null, progres: null, photo: null };
    const ui = {
        montrerPhotoSuffisante: v => { ecran.photo = v; },
        montrerScan: (s, carte) => { ecran.scan = { ...s, carte }; }, montrerAttente: a => { ecran.attente = a; }, montrerCandidats: l => { ecran.candidats = l; },
        dire: (t, c) => ecran.messages.push([t, c]), montrerVide: () => { ecran.vide++; ecran.scan = null; }, montrerSession: v => { ecran.session = v; }, montrerProgres: p => { ecran.progres = p; }
    };
    return { appels, ecran, ctrl: creer({ api, ui }) };
}
const nCandidats = appels => appels.filter(a => a.chemin === '/api/banc/seau/candidats').length;

(async () => {
    await essayer('démarrage', async () => {
        const { appels, ecran, ctrl } = fabriquer();
        await ctrl.demarrer();
        H.v('1. au chargement : le premier scan est montré, carte 0, sans candidat', [ecran.scan && ecran.scan.rang, ecran.scan && ecran.scan.carte, ecran.candidats], [1, 0, null]);
        H.v('1. 🔑 AUCUN appel à /candidats sans demande (masqués par défaut)', nCandidats(appels), 0);
        H.v('1. le progrès est dit', [ecran.progres.fait, ecran.progres.total], [0, 2]);
        const sans = fabriquer({ jeton: false });
        await sans.ctrl.demarrer();
        H.v('1. sans jeton posé : la page demande le jeton et ne charge rien', [sans.ecran.session, sans.appels.map(a => a.chemin)], [true, ['/_etat']]);
    });

    await essayer('entrée-entrée', async () => {
        const { appels, ecran, ctrl } = fabriquer();
        await ctrl.demarrer();
        await ctrl.entrer('777');
        H.v('2. première Entrée sur un idProduct : une vérité en attente de confirmation, RIEN d\'écrit', [ecran.attente && ecran.attente.corps, appels.some(a => a.chemin === '/api/banc/seau/verite')], [{ idProduct: 777 }, false]);
        await ctrl.entrer('777');
        H.v('2. 🔑 seconde Entrée SANS réponse à « la photo suffit-elle ? » : refusée, rien d\'écrit, la confirmation reste en attente, message d\'erreur', [appels.some(a => a.chemin === '/api/banc/seau/verite'), !!ecran.attente, ecran.messages[ecran.messages.length - 1][1]], [false, true, 'erreur']);
        ctrl.photoSuffisante(false);
        await ctrl.entrer('777');
        const v = appels.find(a => a.chemin === '/api/banc/seau/verite');
        H.v('2. seconde Entrée : la vérité est écrite (scan, carte, idProduct, via, photoSuffisante)', v && v.corps, { scanId: 'a'.repeat(24), carte: 0, via: 'idProduct', photoSuffisante: false, idProduct: 777 });
        H.v('2. passage AUTOMATIQUE au scan suivant (rang 2), confirmation effacée', [ecran.scan && ecran.scan.rang, ecran.attente], [2, null]);
        H.v('2. 🔑 la réponse est EFFACÉE au scan suivant (aucune réponse héritée)', [ctrl.etat().photoSuffisante, ecran.photo], [null, null]);
        await ctrl.entrer('https://www.cardmarket.com/fr/Pokemon/Products/Singles/Jungle/Pikachu-V1-JU60');
        ctrl.photoSuffisante(true);
        H.v('2. une adresse Cardmarket : résolue par l\'API (local), vérité en attente, via url', [appels.filter(a => a.chemin === '/api/banc/resoudre-cardmarket').length, ecran.attente && ecran.attente.via, ecran.attente && ecran.attente.corps], [1, 'url', { idProduct: 777 }]);
        await ctrl.entrer('');
        H.v('2. la seconde vérité porte photoSuffisante vrai', appels.filter(a => a.chemin === '/api/banc/seau/verite')[1].corps.photoSuffisante, true);
        H.v('2. Entrée sur un champ vide avec confirmation en attente : confirme', appels.filter(a => a.chemin === '/api/banc/seau/verite').length, 2);
        H.v('2. dernier scan étiqueté : la page dit qu\'il n\'y en a plus', [ecran.vide, ecran.scan], [1, null]);
        H.v('2. 🔑 pas un seul appel à /candidats pendant tout le parcours', nCandidats(appels), 0);
    });

    await essayer('texte invalide', async () => {
        const { appels, ecran, ctrl } = fabriquer({ resolution: { statut: 404, json: { success: false, erreur: { code: 'CODE_INVALIDE', detail: 'produit-inconnu' } } } });
        await ctrl.demarrer();
        const avant0 = appels.length;
        await ctrl.entrer('bonjour');
        H.v('3. un texte qui n\'est ni adresse ni idProduct : refusé, aucune attente, aucun appel', [ecran.attente, appels.length - avant0, ecran.messages[ecran.messages.length - 1][1]], [null, 0, 'erreur']);
        const avant = appels.length;
        await ctrl.entrer('https://www.cardmarket.com/fr/Pokemon/Products/Singles/X/Y');
        H.v('3. une adresse inconnue : message d\'erreur, aucune vérité en attente', [ecran.attente, ecran.messages[ecran.messages.length - 1][1], appels.length - avant], [null, 'erreur', 1]);
    });

    await essayer('candidats', async () => {
        const liste = [
            { idProduct: 3, nom: 'C', set: { nom: 'S' }, numero: '3', prix: { trend: 40, low: 39 } }, { idProduct: 1, nom: 'A', set: { nom: 'S' }, numero: '1', prix: null },
            { idProduct: 2, nom: 'B', set: { nom: 'S' }, numero: '2', prix: { trend: null, low: 3.5 } }, { idProduct: 4, nom: 'D', set: { nom: 'S' }, numero: '4', prix: { trend: 12, low: 11 } }];
        H.v('4. trierParPrix : croissant (tendance, à défaut le plus bas), prix inconnu en dernier', trierParPrix(liste).map(c => c.idProduct), [2, 4, 3, 1]);
        const { appels, ecran, ctrl } = fabriquer({ candidats: liste });
        await ctrl.demarrer();
        await ctrl.voirCandidats();
        H.v('4. sur demande : UN appel, liste montrée triée par prix croissant', [nCandidats(appels), ecran.candidats.map(c => c.idProduct)], [1, [2, 4, 3, 1]]);
        H.v('4. l\'appel porte le scan et la carte', appels.find(a => a.chemin === '/api/banc/seau/candidats').corps, { scanId: 'a'.repeat(24), carte: 0 });
        ctrl.choisirCandidat(ecran.candidats[1]);
        H.v('4. choisir un candidat : en attente, via candidat, RIEN d\'écrit', [ecran.attente.via, ecran.attente.corps, appels.some(a => a.chemin === '/api/banc/seau/verite')], ['candidat', { idProduct: 4 }, false]);
        ctrl.photoSuffisante(true);
        await ctrl.confirmer();
        H.v('4. confirmer : écrite via candidat', appels.find(a => a.chemin === '/api/banc/seau/verite').corps.via, 'candidat');
        H.v('4. le scan suivant n\'affiche plus les candidats du précédent', [ecran.candidats, ecran.scan.rang], [null, 2]);
    });

    await essayer('aucune carte', async () => {
        const { appels, ecran, ctrl } = fabriquer();
        await ctrl.demarrer();
        ctrl.aucune('pas-une-carte');
        H.v('5. « pas une carte » demande une CONFIRMATION (rien d\'écrit)', [ecran.attente && ecran.attente.corps, appels.some(a => a.chemin === '/api/banc/seau/verite')], [{ aucune: 'pas-une-carte' }, false]);
        ctrl.annuler();
        H.v('5. annuler efface l\'attente', ecran.attente, null);
        ctrl.aucune('hors-catalogue');
        ctrl.photoSuffisante(true); ctrl.photoSuffisante(false);
        await ctrl.confirmer();
        const v = appels.find(a => a.chemin === '/api/banc/seau/verite');
        H.v('5. confirmée : aucune écrite, via manuel, la DERNIÈRE réponse photoSuffisante (modifiable avant clôture)', v.corps, { scanId: 'a'.repeat(24), carte: 0, via: 'manuel', photoSuffisante: false, aucune: 'hors-catalogue' });
    });

    await essayer('photo suffisante', async () => {
        const { ecran, ctrl } = fabriquer();
        await ctrl.demarrer();
        H.v('6. au chargement : aucune réponse (ni oui ni non), rien de pré-rempli', [ctrl.etat().photoSuffisante, ecran.photo], [null, null]);
        ctrl.photoSuffisante(true);
        H.v('6. répondre oui : l\'écran le montre', [ctrl.etat().photoSuffisante, ecran.photo], [true, true]);
        ctrl.photoSuffisante('peut-être');
        H.v('6. une valeur qui n\'est ni oui ni non est ignorée', ctrl.etat().photoSuffisante, true);
    });

    // JUGE RAPIDE : le mode « 5 candidats mélangés + autre » (opt-in : le comportement classique ci-dessus ne bouge pas)
    await essayer('mode cinq', async () => {
        const cinq = [3, 1, 5, 2, 4].map(id => ({ idProduct: id, nom: 'N' + id, set: { nom: 'S' }, numero: String(id), visuel: null, version: null }));
        const appels = [], vus = [];
        const scans = [{ scanId: 'a'.repeat(24), rang: 1, photos: 1, cartes: 1, etiquetees: 0 }];
        const api = async (m, chemin, corps) => {
            appels.push({ chemin, corps });
            if (chemin === '/_etat') return { statut: 200, json: { jeton: true } };
            if (chemin === '/api/banc/seau/courant') return { statut: 200, json: { seau: { id: '0123456789abcdef', nom: 'j', type: 'juge', cible: 1, n: 1 } } };
            if (chemin.startsWith('/api/banc/seau/a-etiqueter')) { const p = scans.find(s => s.etiquetees < s.cartes); return { statut: 200, json: { scans: scans.map(s => ({ ...s })), prochain: p ? p.scanId : null } }; }
            if (chemin === '/api/banc/seau/candidats-5') return { statut: 200, json: { mode: 'candidats-5', candidats: cinq } };
            if (chemin === '/api/banc/seau/verite') { scans[0].etiquetees++; return { statut: 200, json: { rev: 1 } }; }
            if (chemin === '/api/banc/resoudre-cardmarket') return { statut: 200, json: { idProduct: 9, nom: 'X', set: { nom: 'S' }, numero: '9' } };
            return { statut: 404, json: null };
        };
        const ui = { montrerPhotoSuffisante() {}, montrerScan() {}, montrerAttente() {}, montrerCandidats() {}, dire() {}, montrerVide() {}, montrerSession() {}, montrerProgres() {}, montrerCinq: l => vus.push(l && l.map(c => c.idProduct)) };
        const ctrl = creer({ api, ui, modeCinq: true });
        await ctrl.demarrer();
        H.v('7. au scan : les 5 sont demandés tout seuls et montrés TELS QUE SERVIS (aucun retri, aucun prix)', [appels.filter(a => a.chemin === '/api/banc/seau/candidats-5').length, vus[vus.length - 1]], [1, [3, 1, 5, 2, 4]]);
        H.v('7. l\'appel porte le scan et la carte', appels.find(a => a.chemin === '/api/banc/seau/candidats-5').corps, { scanId: 'a'.repeat(24), carte: 0 });
        await ctrl.choisirCinq(cinq[2]);
        H.v('7. un clic SANS réponse « photo suffisante » : rien d\'écrit', appels.some(a => a.chemin === '/api/banc/seau/verite'), false);
        ctrl.photoSuffisante(true);
        await ctrl.confirmer();
        H.v('7. 🔑 après la réponse : vérité écrite, via candidat5, mode candidats-5, aucun ordre envoyé par le client', appels.find(a => a.chemin === '/api/banc/seau/verite').corps, { scanId: 'a'.repeat(24), carte: 0, via: 'candidat5', photoSuffisante: true, idProduct: 5, mode: 'candidats-5' });
        scans[0].etiquetees = 0; await ctrl.charger();
        ctrl.photoSuffisante(false);
        await ctrl.entrer('https://www.cardmarket.com/fr/Pokemon/Products/Singles/S/X');
        await ctrl.entrer('');
        const v2 = appels.filter(a => a.chemin === '/api/banc/seau/verite')[1];
        H.v('7. « Autre » (saisie actuelle) : via url, mode candidats-5 (les 5 ont été montrés)', [v2.corps.via, v2.corps.mode, v2.corps.idProduct], ['url', 'candidats-5', 9]);
        // les 5 indisponibles : la saisie reste possible, mode saisie
        const appels2 = [];
        const api2 = async (m, chemin, corps) => { appels2.push({ chemin, corps }); if (chemin === '/api/banc/seau/candidats-5') return { statut: 503, json: null }; return api(m, chemin, corps); };
        const ctrl2 = creer({ api: api2, ui, modeCinq: true });
        scans[0].etiquetees = 0; await ctrl2.demarrer(); ctrl2.photoSuffisante(true);
        await ctrl2.entrer('123'); await ctrl2.entrer('');
        H.v('7. les 5 indisponibles : la saisie marche, mode « saisie » déclaré', appels2.find(a => a.chemin === '/api/banc/seau/verite').corps.mode, 'saisie');
    });

    H.bilan();
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
