'use strict';
// BANC-200 — la page de saisie à l'aveugle. Aucun candidat n'est demandé tant que l'éditeur ne le demande pas ; tout texte venu de l'API passe par textContent, et par rien d'autre.
(function () {
    var csrf = document.querySelector('meta[name="rm-csrf"]').content;
    var $ = function (id) { return document.getElementById(id); };
    var etat = { seau: null, scans: [], scan: null, carte: 0, photo: 0, attente: null, occupe: false };

    function api(methode, chemin, corps) {
        var o = { method: methode, headers: {} };
        if (methode !== 'GET') { o.headers['content-type'] = 'application/json'; o.headers['x-rm-csrf'] = csrf; o.body = JSON.stringify(corps || {}); }
        return fetch(chemin, o).then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { /* non JSON */ } return { statut: r.status, json: j }; }); });
    }
    function dire(texte, classe) { var m = $('message'); m.textContent = texte || ''; m.className = classe || 'doux'; }
    function detailDe(r) { return r.json && r.json.erreur ? (r.json.erreur.detail || r.json.erreur.message || r.json.erreur.code) : 'erreur ' + r.statut; }

    function montrerAttente(a) {
        etat.attente = a; $('attente').hidden = !a;
        $('libelle').textContent = a ? a.libelle : '';
        if (a) $('confirmer').focus();
    }
    function afficherPhoto() {
        var s = etat.scan; if (!s) return;
        var vue = $('vue'); vue.textContent = '';
        var img = document.createElement('img'); img.alt = 'photo ' + (etat.photo + 1);
        img.src = '/api/banc/seau/photo?scanId=' + s.scanId + '&photo=' + etat.photo; vue.appendChild(img);
        var bar = $('vignettes'); bar.textContent = '';
        for (var i = 0; i < s.photos; i++) (function (i) {
            var b = document.createElement('button'); b.type = 'button'; b.className = i === etat.photo ? 'actif' : '';
            var im = document.createElement('img'); im.alt = 'photo ' + (i + 1); im.src = '/api/banc/seau/photo?scanId=' + s.scanId + '&photo=' + i; b.appendChild(im);
            b.addEventListener('click', function () { etat.photo = i; afficherPhoto(); });
            bar.appendChild(b);
        })(i);
    }
    function afficherScan() {
        var s = etat.scan;
        $('zoneCandidats').hidden = true; $('candidats').textContent = ''; montrerAttente(null); $('entree').value = ''; dire('');
        if (!s) { $('vue').textContent = ''; var v = document.createElement('span'); v.className = 'doux'; v.textContent = 'Plus aucun scan à étiqueter dans ce seau.'; $('vue').appendChild(v); $('vignettes').textContent = ''; $('saisie').hidden = true; return; }
        $('saisie').hidden = false;
        etat.carte = s.etiquetees; etat.photo = 0;
        $('rang').textContent = '#' + s.rang;
        $('carteNum').textContent = s.cartes > 1 ? '— carte ' + (etat.carte + 1) + ' sur ' + s.cartes : '';
        afficherPhoto(); $('entree').focus();
    }
    function charger() {
        return api('GET', '/api/banc/seau/courant').then(function (r) {
            if (r.statut === 401) { $('session').hidden = false; $('vue').textContent = 'Jeton refusé ou absent.'; return null; }
            if (r.statut !== 200 || !r.json) { $('vue').textContent = 'L\'API ne répond pas (' + r.statut + ').'; return null; }
            etat.seau = r.json.seau;
            if (!etat.seau) { $('seau').textContent = 'Aucun seau ouvert (le dernier est utilisé pour la liste).'; }
            return api('GET', '/api/banc/seau/a-etiqueter' + (etat.seau ? '?seau=' + etat.seau.id : ''));
        }).then(function (r) {
            if (!r) return;
            if (r.statut !== 200) { $('vue').textContent = 'Liste indisponible : ' + detailDe(r); return; }
            etat.scans = r.json.scans;
            var fait = etat.scans.reduce(function (n, s) { return n + Math.min(s.etiquetees, s.cartes); }, 0), total = etat.scans.reduce(function (n, s) { return n + s.cartes; }, 0);
            if (etat.seau) $('seau').textContent = etat.seau.nom + ' (' + etat.seau.type + ', ' + etat.seau.n + '/' + etat.seau.cible + ')';
            $('progres').textContent = 'vérités : ' + fait + '/' + total;
            etat.scan = etat.scans.filter(function (s) { return s.scanId === r.json.prochain; })[0] || null;
            afficherScan();
        });
    }
    function enregistrer(corps, via) {
        if (etat.occupe) return Promise.resolve();
        etat.occupe = true;
        var o = Object.assign({ scanId: etat.scan.scanId, carte: etat.carte, via: via }, corps);
        return api('POST', '/api/banc/seau/verite', o).then(function (r) {
            etat.occupe = false;
            if (r.statut !== 200) { dire('Refusé : ' + detailDe(r), 'erreur'); montrerAttente(null); return; }
            return charger();
        });
    }
    function resoudre() {
        var v = $('entree').value.trim(); if (!v) return;
        if (/^\d{1,10}$/.test(v)) { montrerAttente({ libelle: 'idProduct ' + v + ' (vérifié au catalogue à l\'enregistrement)', corps: { idProduct: Number(v) }, via: 'idProduct' }); return; }
        if (/^https:\/\/www\.cardmarket\.com\//.test(v)) {
            dire('Résolution locale…');
            api('POST', '/api/banc/resoudre-cardmarket', { url: v }).then(function (r) {
                if (r.statut === 200 && r.json && r.json.idProduct) { dire(''); montrerAttente({ libelle: r.json.nom + ' — ' + r.json.set.nom + ' — n° ' + (r.json.numero || '?') + ' (' + r.json.idProduct + ')', corps: { idProduct: r.json.idProduct }, via: 'url' }); }
                else if (r.statut === 404 && !(r.json && r.json.erreur)) dire('La résolution d\'adresse n\'est pas allumée sur l\'API (saisissez l\'idProduct).', 'erreur');
                else dire('Adresse non résolue : ' + detailDe(r) + ' — saisissez l\'idProduct.', 'erreur');
            });
            return;
        }
        dire('Une adresse Cardmarket (https://www.cardmarket.com/…) ou un idProduct.', 'erreur');
    }
    function voirCandidats() {
        if (!etat.scan) return;
        api('POST', '/api/banc/seau/candidats', { scanId: etat.scan.scanId, carte: etat.carte }).then(function (r) {
            if (r.statut !== 200) { dire('Candidats indisponibles : ' + detailDe(r), 'erreur'); return; }
            var z = $('candidats'); z.textContent = '';
            if (!r.json.candidats.length) z.textContent = 'Aucun candidat.';
            r.json.candidats.forEach(function (c) {
                var b = document.createElement('button'); b.type = 'button'; b.className = 'act';
                var prix = c.prix && (c.prix.trend !== null || c.prix.low !== null) ? (c.prix.trend !== null ? c.prix.trend : c.prix.low).toFixed(2) + ' €' : 'prix ?';
                b.textContent = prix + ' — ' + c.nom + ' — ' + c.set.nom + ' n° ' + (c.numero || '?') + (c.version ? ' (' + c.version + ')' : '');
                b.addEventListener('click', function () { montrerAttente({ libelle: c.nom + ' — ' + c.set.nom + ' — n° ' + (c.numero || '?') + ' (' + c.idProduct + ')', corps: { idProduct: c.idProduct }, via: 'candidat' }); });
                z.appendChild(b);
            });
            $('zoneCandidats').hidden = false;
        });
    }

    $('entree').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (etat.attente) enregistrer(etat.attente.corps, etat.attente.via); else resoudre(); } });
    $('confirmer').addEventListener('click', function () { if (etat.attente) enregistrer(etat.attente.corps, etat.attente.via); });
    $('annuler').addEventListener('click', function () { montrerAttente(null); $('entree').focus(); });
    $('voir').addEventListener('click', voirCandidats);
    $('pasCarte').addEventListener('click', function () { if (etat.scan) enregistrer({ aucune: 'pas-une-carte' }, 'idProduct'); });
    $('horsCatalogue').addEventListener('click', function () { if (etat.scan) enregistrer({ aucune: 'hors-catalogue' }, 'idProduct'); });
    $('poser').addEventListener('click', function () {
        var j = $('jeton').value; $('jeton').value = '';
        api('POST', '/_session', { jeton: j }).then(function (r) { if (r.statut === 200) { $('session').hidden = true; charger(); } else dire('Jeton refusé.', 'erreur'); });
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { montrerAttente(null); $('entree').focus(); return; }
        if (!e.altKey) return;
        var k = e.key.toLowerCase();
        if (k >= '1' && k <= '8' && etat.scan && Number(k) <= etat.scan.photos) { e.preventDefault(); etat.photo = Number(k) - 1; afficherPhoto(); }
        else if (k === 'c') { e.preventDefault(); voirCandidats(); }
        else if (k === 'n' && etat.scan) { e.preventDefault(); enregistrer({ aucune: 'pas-une-carte' }, 'idProduct'); }
        else if (k === 'h' && etat.scan) { e.preventDefault(); enregistrer({ aucune: 'hors-catalogue' }, 'idProduct'); }
    });

    api('GET', '/_etat').then(function (r) { if (r.json && r.json.jeton) return charger(); $('session').hidden = false; $('vue').textContent = 'Posez le jeton pour commencer.'; });
})();
