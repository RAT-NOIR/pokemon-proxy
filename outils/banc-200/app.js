'use strict';
// BANC-200 — le branchement de la page au DOM. Toute la logique est dans controleur.js (testée sans navigateur) ; ici, seulement l'écran. Tout texte venu de l'API passe par textContent, et par rien d'autre.
(function () {
    var csrf = document.querySelector('meta[name="rm-csrf"]').content;
    var $ = function (id) { return document.getElementById(id); };
    var scanCourant = null, photoCourante = 0;

    function api(methode, chemin, corps) {
        var o = { method: methode, headers: {} };
        if (methode !== 'GET') { o.headers['content-type'] = 'application/json'; o.headers['x-rm-csrf'] = csrf; o.body = JSON.stringify(corps || {}); }
        return fetch(chemin, o).then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { /* non JSON */ } return { statut: r.status, json: j }; }); });
    }
    function afficherPhoto() {
        var s = scanCourant; if (!s) return;
        var vue = $('vue'); vue.textContent = '';
        var img = document.createElement('img'); img.alt = 'photo ' + (photoCourante + 1);
        img.src = '/api/banc/seau/photo?scanId=' + s.scanId + '&photo=' + photoCourante; vue.appendChild(img);
        var bar = $('vignettes'); bar.textContent = '';
        for (var i = 0; i < s.photos; i++) (function (i) {
            var b = document.createElement('button'); b.type = 'button'; b.className = i === photoCourante ? 'actif' : '';
            var im = document.createElement('img'); im.alt = 'photo ' + (i + 1); im.src = '/api/banc/seau/photo?scanId=' + s.scanId + '&photo=' + i; b.appendChild(im);
            b.addEventListener('click', function () { photoCourante = i; afficherPhoto(); });
            bar.appendChild(b);
        })(i);
    }
    var ctrl;
    var ui = {
        montrerSession: function (v) { if (!$('session')) return; $('session').hidden = !v; if (v) $('vue').textContent = 'Posez le jeton pour commencer.'; },     // piloté par le lanceur, le champ n'existe pas dans la page
        montrerConnexion: function (c) {
            var z = $('connexion'), vue = $('vue'); $('arreter').hidden = false; $('lier').hidden = c.etat !== 'ok';
            if (c.etat === 'ok') { z.textContent = 'connecté à l\'essai'; z.className = 'bon'; vue.textContent = ''; return; }
            if (c.etat === 'echec') {
                z.textContent = 'non connecté'; z.className = 'erreur'; vue.textContent = '';
                var g = document.createElement('div'); g.className = 'grave'; g.textContent = c.message || 'Connexion à l\'essai impossible.'; vue.appendChild(g); return;
            }
            z.textContent = 'connexion à l\'essai…'; z.className = 'doux'; vue.textContent = 'Connexion à l\'essai en cours (jusqu\'à une minute si le service dormait)…';
        },
        montrerProgres: function (p) {
            $('progres').textContent = 'vérités : ' + p.fait + '/' + p.total;
            $('compteur').textContent = p.seau ? p.seau.n + '/' + p.seau.cible : '';
            $('seau').textContent = p.seau ? p.seau.nom + ' (' + p.seau.type + ', ' + p.seau.n + '/' + p.seau.cible + (p.seau.etat === 'scelle' ? ', scellé' : '') + ')' : 'Aucun seau ouvert';
        },
        montrerScan: function (s, carte) {
            scanCourant = s; photoCourante = 0; $('saisie').hidden = false; $('entree').value = ''; ui.dire('', 'doux');
            $('rang').textContent = '#' + s.rang; $('carteNum').textContent = s.cartes > 1 ? '— carte ' + (carte + 1) + ' sur ' + s.cartes : '';
            afficherPhoto(); $('entree').focus();
        },
        montrerVide: function (texte) {
            scanCourant = null; $('saisie').hidden = true; $('vignettes').textContent = ''; $('vue').textContent = '';
            var v = document.createElement('div'); v.className = 'grave'; v.textContent = texte || 'Plus aucun scan à étiqueter dans ce seau.'; $('vue').appendChild(v);
        },
        montrerCode: function (c) {
            $('codeLiaison').textContent = c.code; $('phraseLiaison').textContent = c.phrase;
            $('validiteLiaison').textContent = c.minutes ? 'Valable environ ' + c.minutes + ' minute' + (c.minutes > 1 ? 's' : '') + ', une seule fois.' : 'Valable quelques minutes, une seule fois.';
            $('lien').hidden = false;
        },
        cacherCode: function () { $('codeLiaison').textContent = ''; $('lien').hidden = true; ui.dire('Extension liée : les scans arrivent.', 'bon'); },
        montrerAvis: function (texte) { $('avis').textContent = texte || ''; $('avis').hidden = !texte; },
        vider: function () { var e = $('entree'); e.value = ''; e.focus(); e.select(); },
        montrerArret: function () {
            scanCourant = null; $('saisie').hidden = true; $('arreter').hidden = true; $('connexion').textContent = 'arrêté'; $('vignettes').textContent = ''; $('vue').textContent = '';
            var v = document.createElement('div'); v.className = 'grave'; v.textContent = 'Le juge est arrêté. Vous pouvez fermer cet onglet ; pour reprendre, double-cliquez sur « Juge Rat-Market ».'; $('vue').appendChild(v);
        },
        montrerAttente: function (a) { $('attente').hidden = !a; $('libelle').textContent = a ? a.libelle : ''; if (a) $('confirmer').focus(); else $('entree').focus(); },
        montrerCandidats: function (liste) {
            var z = $('candidats'); z.textContent = '';
            if (!liste) { $('zoneCandidats').hidden = true; return; }
            if (!liste.length) z.textContent = 'Aucun candidat.';
            liste.forEach(function (c) {
                var b = document.createElement('button'); b.type = 'button'; b.className = 'act';
                var v = c.prix && (typeof c.prix.trend === 'number' ? c.prix.trend : typeof c.prix.low === 'number' ? c.prix.low : null);
                b.textContent = (v === null ? 'prix ?' : v.toFixed(2) + ' €') + ' — ' + c.nom + ' — ' + c.set.nom + ' n° ' + (c.numero || '?') + (c.version ? ' (' + c.version + ')' : '');
                b.addEventListener('click', function () { ctrl.choisirCandidat(c); });
                z.appendChild(b);
            });
            $('zoneCandidats').hidden = false;
        },
        dire: function (texte, classe) { var m = $('message'); m.textContent = texte || ''; m.className = classe || 'doux'; }
    };
    ctrl = RMControleur.creer({ api: api, ui: ui });

    $('entree').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ctrl.entrer($('entree').value); } });
    $('confirmer').addEventListener('click', function () { ctrl.confirmer(); });
    $('annuler').addEventListener('click', function () { ctrl.annuler(); });
    $('voir').addEventListener('click', function () { ctrl.voirCandidats(); });
    $('pasCarte').addEventListener('click', function () { ctrl.aucune('pas-une-carte'); });
    $('horsCatalogue').addEventListener('click', function () { ctrl.aucune('hors-catalogue'); });
    $('lier').addEventListener('click', function () { ctrl.lier(); });
    $('arreter').addEventListener('click', function () { if (window.confirm('Arrêter le juge ? Il faudra le relancer par le raccourci.')) ctrl.arreter(); });
    if ($('poser'))$('poser').addEventListener('click', function () { var j = $('jeton').value; $('jeton').value = ''; ctrl.poserJeton(j); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { ctrl.annuler(); return; }
        if (!e.altKey) return;
        var k = e.key.toLowerCase();
        if (k >= '1' && k <= '8' && scanCourant && Number(k) <= scanCourant.photos) { e.preventDefault(); photoCourante = Number(k) - 1; afficherPhoto(); }
        else if (k === 'c') { e.preventDefault(); ctrl.voirCandidats(); }
        else if (k === 'n') { e.preventDefault(); ctrl.aucune('pas-une-carte'); }
        else if (k === 'h') { e.preventDefault(); ctrl.aucune('hors-catalogue'); }
    });
    ctrl.demarrer();
})();
