'use strict';
// BANC-200 — la LOGIQUE de la page de saisie à l'aveugle, sans DOM : `creer({ api, ui })` reçoit une fonction d'appel et un « écran » (montrerScan, montrerAttente, montrerCandidats, dire, montrerVide, montrerSession, montrerProgres).
// Dans le navigateur, app.js lui branche le vrai DOM ; les bancs (test-banc-seau-controleur.js) lui branchent une fausse API et un faux écran.
// Règles portées ici : les candidats ne sont JAMAIS demandés tant que l'éditeur ne le demande pas ; ils s'affichent par prix croissant (le prix inconnu en dernier) ; une vérité s'écrit à la CONFIRMATION (Entrée, Entrée), jamais à la première
// saisie ; « pas une carte » et « hors catalogue » demandent la même confirmation ; la vérité écrite, la page passe seule au scan suivant.
(function (racine, fabrique) {
    if (typeof module === 'object' && module.exports) module.exports = fabrique(); else racine.RMControleur = fabrique();
})(this, function () {
    var prixDe = function (c) { var p = c && c.prix; var v = p && (typeof p.trend === 'number' ? p.trend : typeof p.low === 'number' ? p.low : null); return v === null || v === undefined ? Infinity : v; };
    function trierParPrix(liste) { return liste.slice().sort(function (a, b) { var d = prixDe(a) - prixDe(b); return d === 0 || d !== d ? a.idProduct - b.idProduct : d; }); }
    // Jamais de code brut dans la page : toute réponse d'erreur de l'API est dite en FRANÇAIS (par le détail connu, sinon par le statut HTTP).
    var PHRASES = {
        'juge-scelle': 'Le juge est scellé : plus aucune vérité ne s\'y écrit.',
        'seau-scelle': 'Le seau est scellé : plus rien ne s\'y écrit.',
        'scan-introuvable': 'ce scan n\'est plus disponible pour le compte de la page',
        'seau-id': 'aucun seau n\'est désigné'
    };
    var detailDe = function (r) {
        var d = r && r.json && r.json.erreur && r.json.erreur.detail;
        if (d && PHRASES[d]) return PHRASES[d];
        var s = r ? r.statut : 0;
        if (s === 401) return 'la connexion à l\'essai est refusée';
        if (s === 429) return 'trop de demandes : patientez quelques secondes';
        if (s === 404 || s === 422) return 'rien de connu ne correspond';
        if (s === 409) return 'l\'état du seau ne le permet pas';
        if (s === 400) return 'demande refusée par l\'API';
        if (s >= 500 || !s) return 'l\'API ne répond pas pour l\'instant, réessayez dans un instant';
        return 'refus de l\'API';
    };
    var PHRASE_SANS_SEAU = 'Aucun seau ouvert : l\'agent API le déclare, rien à faire de votre côté';
    function pluriel(n, un, plusieurs) { return n > 1 ? plusieurs : un; }
    function phraseAutres(n) { return 'Ce seau contient ' + n + ' ' + pluriel(n, 'scan fait', 'scans faits') + ' avec un autre compte que celui de la page (' + pluriel(n, 'il n\'est pas listé', 'ils ne sont pas listés') + '). L\'extension qui scanne doit être liée au compte de mesure : liez votre extension avec le bouton « Lier mon extension » ci-dessus (une seule fois).'; }
    var PHRASE_LIEN = 'Dans l\'extension (build de test), ouvrez Mon compte → Lier, tapez ce code. À faire une seule fois.';

    function creer(o) {
        var api = o.api, ui = o.ui;
        var etat = { seau: null, scans: [], scan: null, carte: 0, attente: null, occupe: false, lanceur: false, resolution: false, autres: 0 };
        var attendreMs = o.attendre || function (f, ms) { setTimeout(f, ms); };            // injectable : un banc n'attend pas pour de vrai
        function connexion(c) { if (ui.montrerConnexion) ui.montrerConnexion(c); }
        var PHRASE_EXPIREE = 'Connexion à l\'essai impossible (jeton refusé) — attendez une minute puis double-cliquez de nouveau sur « Juge Rat-Market » ; si ça persiste, prévenez l\'agent API';
        function vider() { if (ui.vider) ui.vider(); }
        function attendre(a) { etat.attente = a; ui.montrerAttente(a); }
        function phraseVide() {
            var s = etat.seau;
            if (s && s.etat === 'scelle') return (s.type === 'juge' ? 'Le juge' : 'Le seau « ' + s.nom + ' »') + ' est scellé : ' + s.n + '/' + s.cible + ', merci';
            if (etat.autres > 0 && etat.scans.length === 0) return phraseAutres(etat.autres);
            return 'Plus aucun scan à étiqueter dans ce seau.' + (etat.autres > 0 ? ' ' + phraseAutres(etat.autres) : '');
        }
        function afficher() {
            ui.montrerCandidats(null); attendre(null);
            if (ui.montrerAvis) ui.montrerAvis(etat.scan && etat.autres > 0 ? phraseAutres(etat.autres) : '');
            if (!etat.scan) { ui.montrerVide(phraseVide()); return; }
            etat.carte = Math.min(etat.scan.etiquetees, Math.max(0, etat.scan.cartes - 1));
            ui.montrerScan(etat.scan, etat.carte);
        }
        function charger() {
            return api('GET', '/api/banc/seau/courant').then(function (r) {
                if (r.statut === 401) {
                    if (etat.lanceur) { connexion({ etat: 'echec', message: PHRASE_EXPIREE }); return null; }       // piloté par le lanceur : jamais de champ « jeton » à remplir
                    ui.montrerSession(true); return null;
                }
                if (r.statut !== 200 || !r.json) { ui.dire('L\'API ne répond pas pour l\'instant, réessayez dans un instant.', 'erreur'); return null; }
                etat.seau = r.json.seau;
                return api('GET', '/api/banc/seau/a-etiqueter' + (etat.seau ? '?seau=' + etat.seau.id : ''));
            }).then(function (r) {
                if (!r) return;
                if (r.statut === 400 && r.json && r.json.erreur && r.json.erreur.detail === 'seau-id') {      // aucun seau n'a jamais été déclaré
                    etat.seau = null; etat.scans = []; etat.scan = null; etat.autres = 0;
                    ui.montrerProgres({ fait: 0, total: 0, seau: null }); ui.montrerCandidats(null); attendre(null); if (ui.montrerAvis) ui.montrerAvis('');
                    ui.montrerVide(PHRASE_SANS_SEAU); return;
                }
                if (r.statut !== 200) { ui.dire('Liste indisponible : ' + detailDe(r), 'erreur'); return; }
                if (r.json.seau) etat.seau = r.json.seau;                      // un seau scellé n'est plus « courant » : la liste dit lequel
                etat.autres = r.json.autresComptes || 0;
                etat.scans = r.json.scans;
                var fait = 0, total = 0;
                etat.scans.forEach(function (s) { fait += Math.min(s.etiquetees, s.cartes); total += s.cartes; });
                ui.montrerProgres({ fait: fait, total: total, seau: etat.seau });
                etat.scan = etat.scans.filter(function (s) { return s.scanId === r.json.prochain; })[0] || null;
                afficher();
            });
        }
        function demarrer() {
            return api('GET', '/_etat').then(function (r) {
                var j = r.json || {};
                if (j.lanceur) {                                      // le lanceur se connecte à l'essai en arrière-plan : la page suit son état, sans jamais demander de jeton
                    etat.lanceur = true;
                    var c = j.connexion || { etat: 'en-cours' };
                    connexion(c);
                    if (c.etat === 'ok' && j.jeton) return charger();
                    if (c.etat === 'echec') return null;
                    return new Promise(function (fin) { attendreMs(function () { fin(demarrer()); }, 2000); });
                }
                if (j.jeton) return charger();
                ui.montrerSession(true);
            });
        }
        function confirmer() {
            if (!etat.attente || !etat.scan || etat.occupe) return Promise.resolve();
            etat.occupe = true;
            var corps = { scanId: etat.scan.scanId, carte: etat.carte, via: etat.attente.via };
            Object.keys(etat.attente.corps).forEach(function (k) { corps[k] = etat.attente.corps[k]; });
            return api('POST', '/api/banc/seau/verite', corps).then(function (r) {
                etat.occupe = false;
                if (r.statut !== 200) { ui.dire('Refusé : ' + detailDe(r), 'erreur'); attendre(null); return; }
                return charger();
            });
        }
        function entrer(valeur) {
            if (etat.attente) return confirmer();                       // la seconde Entrée confirme, quoi que le champ contienne
            var v = String(valeur || '').trim();
            if (!v) return Promise.resolve();
            if (/^\d{1,10}$/.test(v)) { attendre({ libelle: 'idProduct ' + v + ' (vérifié au catalogue à l\'enregistrement)', corps: { idProduct: Number(v) }, via: 'idProduct' }); return Promise.resolve(); }
            if (/^https:\/\/www\.cardmarket\.com\//.test(v)) {
                            // deux Entrées rapprochées : la résolution en cours n'est pas relancée
                if (etat.resolution) return Promise.resolve();
                etat.resolution = true;
                ui.dire('Résolution locale…', 'doux');
                return api('POST', '/api/banc/resoudre-cardmarket', { url: v }).then(function (r) {
                    etat.resolution = false;
                    if (r.statut === 200 && r.json && r.json.idProduct) { ui.dire('', 'doux'); attendre({ libelle: r.json.nom + ' — ' + r.json.set.nom + ' — n° ' + (r.json.numero || '?') + ' (' + r.json.idProduct + ')', corps: { idProduct: r.json.idProduct }, via: 'url' }); }
                    else if (r.statut === 404 && !(r.json && r.json.erreur)) { ui.dire('La résolution d\'adresse n\'est pas allumée sur l\'API (saisissez l\'idProduct).', 'erreur'); vider(); }
                    else { ui.dire('Adresse non résolue : ' + detailDe(r) + ' — collez une autre adresse ou saisissez l\'idProduct.', 'erreur'); vider(); }
                }, function (e) { etat.resolution = false; throw e; });
            }
            ui.dire('Une adresse Cardmarket (https://www.cardmarket.com/…) ou un idProduct.', 'erreur'); vider();
            return Promise.resolve();
        }
        function voirCandidats() {
            if (!etat.scan) return Promise.resolve();
            return api('POST', '/api/banc/seau/candidats', { scanId: etat.scan.scanId, carte: etat.carte }).then(function (r) {
                if (r.statut !== 200) { ui.dire('Candidats indisponibles : ' + detailDe(r), 'erreur'); return; }
                ui.montrerCandidats(trierParPrix(r.json.candidats));
            });
        }
        function choisirCandidat(c) {
            attendre({ libelle: c.nom + ' — ' + c.set.nom + ' — n° ' + (c.numero || '?') + ' (' + c.idProduct + ')', corps: { idProduct: c.idProduct }, via: 'candidat' });
        }
        function aucune(type) {
            if (!etat.scan) return;
            attendre({ libelle: type === 'pas-une-carte' ? 'Pas une carte' : 'Hors catalogue', corps: { aucune: type }, via: 'manuel' });
        }
        function poserJeton(jeton) {
            return api('POST', '/_session', { jeton: jeton }).then(function (r) { if (r.statut === 200) { ui.montrerSession(false); return charger(); } ui.dire('Jeton refusé.', 'erreur'); });
        }
        // « Lier mon extension » : le serveur local demande un code NEUF pour le compte de mesure (POST /_lier) ; la page l'affiche en grand puis surveille l'arrivée de scans du porteur (= extension liée) pour le retirer
        function surveiller(n) {
            if (!etat.codeAffiche || n >= 120) return;                                  // 120 × 5 s = 10 minutes, la validité du code
            attendreMs(function () {
                if (!etat.codeAffiche) return;
                charger().then(function () {
                    if (etat.scans.length > 0) { etat.codeAffiche = false; if (ui.cacherCode) ui.cacherCode(); return; }
                    surveiller(n + 1);
                });
            }, 5000);
        }
        function lier() {
            return api('POST', '/_lier', {}).then(function (r) {
                if (r.statut !== 200 || !r.json || !r.json.code) { ui.dire((r.json && r.json.erreur && r.json.erreur.message) || 'Le code de liaison n\'a pas pu être demandé : ' + detailDe(r), 'erreur'); return; }
                var t = r.json.expire ? Date.parse(r.json.expire) : NaN, minutes = isNaN(t) ? null : Math.max(1, Math.round((t - Date.now()) / 60000));
                etat.codeAffiche = true;
                if (ui.montrerCode) ui.montrerCode({ code: r.json.code, minutes: minutes, phrase: PHRASE_LIEN });
                surveiller(0);
            });
        }
        function arreter() { return api('POST', '/_arreter', {}).then(function () { if (ui.montrerArret) ui.montrerArret(); }, function () { if (ui.montrerArret) ui.montrerArret(); }); }
        return { lier: lier, arreter: arreter, demarrer: demarrer, charger: charger, entrer: entrer, confirmer: confirmer, annuler: function () { attendre(null); }, voirCandidats: voirCandidats, choisirCandidat: choisirCandidat, aucune: aucune, poserJeton: poserJeton, etat: function () { return etat; } };
    }
    return { creer: creer, trierParPrix: trierParPrix };
});
