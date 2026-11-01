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
    var detailDe = function (r) { return r.json && r.json.erreur ? (r.json.erreur.detail || r.json.erreur.message || r.json.erreur.code) : 'erreur ' + r.statut; };

    function creer(o) {
        var api = o.api, ui = o.ui;
        var etat = { seau: null, scans: [], scan: null, carte: 0, attente: null, occupe: false };
        function attendre(a) { etat.attente = a; ui.montrerAttente(a); }
        function afficher() {
            ui.montrerCandidats(null); attendre(null);
            if (!etat.scan) { ui.montrerVide(); return; }
            etat.carte = Math.min(etat.scan.etiquetees, Math.max(0, etat.scan.cartes - 1));
            ui.montrerScan(etat.scan, etat.carte);
        }
        function charger() {
            return api('GET', '/api/banc/seau/courant').then(function (r) {
                if (r.statut === 401) { ui.montrerSession(true); return null; }
                if (r.statut !== 200 || !r.json) { ui.dire('L\'API ne répond pas (' + r.statut + ').', 'erreur'); return null; }
                etat.seau = r.json.seau;
                return api('GET', '/api/banc/seau/a-etiqueter' + (etat.seau ? '?seau=' + etat.seau.id : ''));
            }).then(function (r) {
                if (!r) return;
                if (r.statut !== 200) { ui.dire('Liste indisponible : ' + detailDe(r), 'erreur'); return; }
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
                if (r.json && r.json.jeton) return charger();
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
                ui.dire('Résolution locale…', 'doux');
                return api('POST', '/api/banc/resoudre-cardmarket', { url: v }).then(function (r) {
                    if (r.statut === 200 && r.json && r.json.idProduct) { ui.dire('', 'doux'); attendre({ libelle: r.json.nom + ' — ' + r.json.set.nom + ' — n° ' + (r.json.numero || '?') + ' (' + r.json.idProduct + ')', corps: { idProduct: r.json.idProduct }, via: 'url' }); }
                    else if (r.statut === 404 && !(r.json && r.json.erreur)) ui.dire('La résolution d\'adresse n\'est pas allumée sur l\'API (saisissez l\'idProduct).', 'erreur');
                    else ui.dire('Adresse non résolue : ' + detailDe(r) + ' — saisissez l\'idProduct.', 'erreur');
                });
            }
            ui.dire('Une adresse Cardmarket (https://www.cardmarket.com/…) ou un idProduct.', 'erreur');
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
        return { demarrer: demarrer, charger: charger, entrer: entrer, confirmer: confirmer, annuler: function () { attendre(null); }, voirCandidats: voirCandidats, choisirCandidat: choisirCandidat, aucune: aucune, poserJeton: poserJeton, etat: function () { return etat; } };
    }
    return { creer: creer, trierParPrix: trierParPrix };
});
