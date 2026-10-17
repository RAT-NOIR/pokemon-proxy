// ==UserScript==
// @name         Rat-Market — Relevé passif Collectorviper
// @namespace    rat-market
// @version      1.0
// @description  Bouton « Relever cette page » sur une page Collectorviper que TU ouvres. Au clic seulement, relève les images AFFICHÉES (pixels du canvas) et les envoie au récepteur LOCAL (127.0.0.1). Aucune requête vers un autre hôte, aucun défilement, aucun cookie.
// @match        https://collectorviper.livejournal.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==

// ============================================================
// ⚠️ SUPPOSITION : le @match ci-dessus (https://collectorviper.livejournal.com/*) n'a PAS été vérifié — aucune requête vers Collectorviper ni LiveJournal n'a été faite pour
// écrire ce lot. Le testeur le confirme en ouvrant la page ; si l'adresse réelle diffère, le @match ET HOTE_ATTENDU changent ensemble avec HOTE_PAGES de recepteur-collectorviper.js.
//
// 1.0 — PASSIF PAR CONSTRUCTION (décision du testeur, 2026-10-17 : « méthode passive acceptée, pages ouvertes par moi, userscript au clic »). LiveJournal User Agreement
// cl. 9.2.6 interdit les scripts automatiques qui collectent ; robots.txt demande 100 s entre deux requêtes. Ce script n'en fait donc AUCUNE : au chargement il n'ajoute qu'un
// panneau ; au clic il relève ce que la page AFFICHE déjà.
//
// LA LECTURE DES OCTETS — deux voies envisagées, UNE gardée (garde écrite par ce qu'elle AUTORISE) :
//   1. le canvas des pixels affichés (drawImage + toDataURL) : AUCUNE requête. Si l'image vient d'un autre hôte sans en-tête CORS, le canvas est « contaminé », toDataURL
//      lève, et l'image est relevée « illisible sans requête » (adresse, dimensions, légende : oui ; octets : non). On ne pose JAMAIS crossOrigin (cela ferait recharger l'image).
//   2. le cache du navigateur « sans réseau » : NON GARDÉE. Une lecture de cache n'est garantie sans réseau que pour une image de MÊME origine que la page (mode same-origin),
//      cas où le canvas n'est justement pas contaminé et où la voie 1 suffit ; pour une autre origine, aucun mode ne garantit l'absence de requête. Aucun appel réseau de page
//      n'existe dans ce script, et un banc le vérifie sur son texte.
// Le seul réseau est UN appel GM_xmlhttpRequest, vers http://127.0.0.1:<PORT>/releve (recepteur-collectorviper.js) ; @connect 127.0.0.1 seul.
//
// PROTOCOLE : un paquet par clic. Une requête par image LUE (type « image », octets PNG), puis une requête « page » qui déclare TOUTES les images (lue / illisible /
// sous-seuil, avec adresse, dimensions, alt, title, légende, intertitre). Une image sous SEUIL_LARGEUR (= LARGEUR_MIN de collecte-cartes/seuils-images.js) est relevée
// « sous-seuil », sans octets. Rien d'une image n'est lu avant le clic.
// ============================================================
(function () {
    'use strict';
    // LE PORT du récepteur : la valeur de `--port` de recepteur-collectorviper.js (défaut 8767).
    var PORT = 8767;
    var RECEPTEUR = 'http://127.0.0.1:' + PORT + '/releve';
    var HOTE_ATTENDU = 'collectorviper.livejournal.com';
    var SEUIL_LARGEUR = 350;                     // = LARGEUR_MIN de collecte-cartes/seuils-images.js (un banc le compare)
    var IMAGES_MAX = 300;                        // = IMAGES_MAX du récepteur
    var IMAGE_OCTETS_MAX = 6 * 1024 * 1024;      // octets PNG par image, = celui du récepteur
    var PREFIXE_PNG = 'data:image/png;base64,';

    // ===== UI =====
    var panneau = document.createElement('div');
    panneau.style.cssText =
        'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0d0d10;color:#eee;' +
        'font:13px system-ui,sans-serif;padding:12px 14px;border:1px solid #D4AF37;border-radius:10px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.4);width:320px';
    panneau.innerHTML =
        '<div style="font-weight:600;margin-bottom:2px">🐀 Relever cette page</div>' +
        '<div style="color:#888;font-size:11px;margin-bottom:8px">Collectorviper · relevé local, pixels affichés, aucune requête vers le site</div>' +
        '<button id="rm-go" style="width:100%;padding:7px;background:#0c0c0e;color:#D4AF37;' +
        'border:1px solid #D4AF37;border-radius:6px;cursor:pointer;font-weight:600">Relever</button>' +
        '<div id="rm-msg" style="margin-top:8px;min-height:16px;color:#bbb;line-height:1.4;white-space:pre-wrap"></div>';
    document.body.appendChild(panneau);
    var bouton = panneau.querySelector('#rm-go');
    var msg = panneau.querySelector('#rm-msg');
    function dire(texte, couleur) { msg.style.color = couleur || '#bbb'; msg.textContent = texte; }
    dire('Rien n\'est lu ni envoyé avant ton clic. Affiche la page voulue, laisse les images se charger, puis clique une fois.');

    // ===== Envoi au récepteur local =====
    function poster(objet) {
        return new Promise(function (resoudre, rejeter) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: RECEPTEUR,
                headers: { 'Content-Type': 'application/json', 'X-Rat-Market': 'rat-market-passif' },
                data: JSON.stringify(objet),
                anonymous: true,
                timeout: 60000,
                redirect: 'error',
                onload: function (r) {
                    var j = null;
                    try { j = JSON.parse(r.responseText); } catch (e) { j = null; }
                    resoudre({ status: r.status, json: j });
                },
                onerror: function () { rejeter({ reseau: 'erreur' }); },
                ontimeout: function () { rejeter({ reseau: 'delai' }); }
            });
        });
    }

    // ===== Le relevé : ce que la page AFFICHE =====
    function normaliser(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }
    function bornee(t, max) { return normaliser(t).slice(0, max); }
    function pluriel(n, mot) { return n + ' ' + mot + (n > 1 ? 's' : ''); }

    function paquetId() {
        var d = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''), h = '';
        for (var i = 0; i < 8; i++) h += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
        return d + '-' + h;
    }
    function legendeDe(img) {
        var fig = img.closest ? img.closest('figure') : null;
        if (fig) { var cap = fig.querySelector('figcaption'); if (cap && normaliser(cap.textContent)) return bornee(cap.textContent, 500); }
        var p = img.parentElement;
        for (var i = 0; p && i < 4; i++, p = p.parentElement) { var t = normaliser(p.textContent); if (t) return t.slice(0, 500); }
        return '';
    }
    function intertitreDe(img) {
        var noeud = img;
        for (var h = 0; noeud && h < 12; h++, noeud = noeud.parentElement) {
            var s = noeud.previousElementSibling;
            for (var n = 0; s && n < 200; n++, s = s.previousElementSibling) if (/^H[1-6]$/i.test(s.tagName || '')) return bornee(s.textContent, 300);
        }
        return '';
    }
    function adresseDe(img) {
        var a = String(img.currentSrc || img.src || '');
        return /^https:\/\/\S+$/.test(a) && a.length <= 2000 ? a : '';
    }
    // Lit UNE image : { etat, raison, donnees? }. Le canvas ne dessine que ce que la page a DÉJÀ chargé ; rien n'est rechargé, rien n'est demandé.
    function lire(img) {
        var w = img.naturalWidth | 0, h = img.naturalHeight | 0;
        if (!img.complete || !w || !h) return { etat: 'illisible', raison: 'image non chargée dans la page (rien n\'est forcé)', w: w, h: h };
        if (w < SEUIL_LARGEUR) return { etat: 'sous-seuil', raison: 'sous le seuil', w: w, h: h };
        try {
            var toile = document.createElement('canvas');
            toile.width = w; toile.height = h;
            toile.getContext('2d').drawImage(img, 0, 0);
            var url = toile.toDataURL('image/png');
            if (typeof url !== 'string' || url.indexOf(PREFIXE_PNG) !== 0) return { etat: 'illisible', raison: 'illisible sans requête', w: w, h: h };
            var b64 = url.slice(PREFIXE_PNG.length);
            if (b64.length * 3 / 4 > IMAGE_OCTETS_MAX) return { etat: 'illisible', raison: 'image trop volumineuse pour un envoi', w: w, h: h };
            return { etat: 'lue', raison: '', w: w, h: h, donnees: b64 };
        } catch (e) {
            return { etat: 'illisible', raison: 'illisible sans requête', w: w, h: h };   // canvas contaminé : aucune requête n'est tentée pour contourner
        }
    }
    function entreeDe(img, indice, lecture) {
        return {
            indice: indice, src: adresseDe(img), w: lecture.w, h: lecture.h,
            alt: bornee(img.alt, 300), title: bornee(img.title, 300), legende: legendeDe(img), intertitre: intertitreDe(img),
            etat: lecture.etat, raison: lecture.raison
        };
    }

    function resume(rep, vues, surplus) {
        var c = rep.json.comptes || {};
        var ligne = '✅ ' + pluriel(vues, 'image') + ' · ' + (c.lues || 0) + ' lue(s) · ' + pluriel(c.illisibles || 0, 'illisible') + ' · ' + (c.sousSeuil || 0) + ' sous le seuil' + (c.manquantes ? ' · ' + c.manquantes + ' manquante(s)' : '');
        var notes = [];
        if (c.illisibles) notes.push('ℹ️ Les illisibles n\'ont aucun octet : leur lecture aurait demandé une requête (sans requête impossible). Adresse, dimensions et légende sont relevées.');
        if (c.manquantes) notes.push('⚠️ ' + c.manquantes + ' image(s) déclarée(s) lues mais jamais reçues : reclique.');
        if (surplus) notes.push('⚠️ ' + surplus + ' image(s) au-delà de ' + IMAGES_MAX + ' non relevée(s) : le surplus n\'est pas lu.');
        return { texte: ligne + (notes.length ? '\n' + notes.join('\n') : ''), couleur: c.manquantes || surplus ? '#e6a23c' : '#67c23a' };
    }

    // ===== Le clic =====
    bouton.addEventListener('click', function () {
        if (location.hostname !== HOTE_ATTENDU) {
            dire('Cette page n\'est pas ' + HOTE_ATTENDU + ' : rien n\'est lu ni envoyé.', '#e6a23c');
            return;
        }
        var toutes = Array.prototype.slice.call(document.querySelectorAll('img'));
        if (!toutes.length) { dire('Aucune image sur cette page : rien n\'est envoyé.', '#e6a23c'); return; }
        var surplus = Math.max(0, toutes.length - IMAGES_MAX);
        var imgs = toutes.slice(0, IMAGES_MAX);
        var paquet = paquetId(), url = location.origin + location.pathname + location.search;
        bouton.disabled = true; bouton.style.opacity = '.6';
        var entrees = [];
        function fini() { bouton.disabled = false; bouton.style.opacity = '1'; }
        function panne(e) {
            fini();
            dire(e && e.reseau === 'delai'
                ? '❌ Le récepteur ne répond pas (délai dépassé) : vérifie qu\'il tourne, puis recommence.'
                : '❌ Le récepteur ne répond pas : lance-le (node recepteur-collectorviper.js), puis recommence.', '#f56c6c');
        }
        // une image après l'autre : chaque lecture suit la réponse du récepteur à la précédente
        var chaine = Promise.resolve();
        imgs.forEach(function (img, i) {
            chaine = chaine.then(function () {
                var indice = i + 1, lecture = lire(img), entree = entreeDe(img, indice, lecture);
                entrees.push(entree);
                dire('Relevé en cours : image ' + indice + ' sur ' + imgs.length + '…');
                if (lecture.etat !== 'lue') return null;
                return poster({ schema: 1, type: 'image', paquet: paquet, url: url, indice: indice, mime: 'image/png', donnees: lecture.donnees }).then(function (rep) {
                    if (!(rep.json && rep.json.ok)) {
                        entree.etat = 'illisible';
                        entree.raison = ('refusée par le récepteur : ' + ((rep.json && rep.json.motif) || 'HTTP ' + rep.status)).slice(0, 200);
                    }
                });
            });
        });
        chaine.then(function () {
            return poster({ schema: 1, type: 'page', paquet: paquet, url: url, titre: bornee(document.title, 300), images: entrees });
        }).then(function (rep) {
            fini();
            if (!(rep.json && rep.json.ok)) { dire('❌ Page refusée (HTTP ' + rep.status + ') : ' + ((rep.json && rep.json.motif) || 'réponse illisible du récepteur'), '#f56c6c'); return; }
            var r = resume(rep, imgs.length, surplus);
            dire(r.texte, r.couleur);
        }, panne);
    });
})();
