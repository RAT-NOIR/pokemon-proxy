// ==UserScript==
// @name         Rat-Market — Relevé passif pages de set
// @namespace    rat-market
// @version      1.0
// @description  Au clic seulement : lit les cartes déjà affichées sur la page de set ouverte par toi et les envoie au récepteur local de ton poste. Aucune requête, aucune navigation.
// @match        https://www.pokedata.io/set/McDonald's+Promos+2019
// @match        https://www.pokedata.io/set/McDonald%27s+Promos+2019
// @match        https://www.pokedata.io/set/McDonald's+Promos+2018
// @match        https://www.pokedata.io/set/McDonald%27s+Promos+2018
// @match        https://www.pokedata.io/set/Trick+or+Trade+2024
// @match        https://www.pokedata.io/set/Unseen+Forces
// @match        https://www.pokedata.io/set/Mcdonald's+Dragon+Discovery
// @match        https://www.pokedata.io/set/Mcdonald%27s+Dragon+Discovery
// @match        https://www.pokedata.io/set/McDonald's+Promos+2014
// @match        https://www.pokedata.io/set/McDonald%27s+Promos+2014
// @match        https://www.pokedata.io/set/McDonald's+Promos+2015
// @match        https://www.pokedata.io/set/McDonald%27s+Promos+2015
// @match        https://www.pokedata.io/set/Trick+or+Trade+2023
// @match        https://www.pokedata.io/set/McDonald's+Promos+2023
// @match        https://www.pokedata.io/set/McDonald%27s+Promos+2023
// @match        https://www.pokedata.io/set/McDonald's+Promos+2017
// @match        https://www.pokedata.io/set/McDonald%27s+Promos+2017
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==
// PASSIF : ce script ne charge rien, ne navigue pas, ne clique pas, ne défile pas. Tu ouvres la page, tu la fais défiler toi-même jusqu'en bas (pour que toutes les cartes soient affichées),
// puis tu cliques sur le bouton. Il envoie à http://127.0.0.1:8767/releve (recepteur-pokedata.js) SEULEMENT les adresses des images affichées, leur texte alternatif, leur numéro, le nom du set,
// et un RÉSUMÉ STRUCTUREL (chemins de balises et noms de classes, sans texte) pour régler les sélecteurs.
(function () {
    'use strict';
    var RECEPTEUR = 'http://127.0.0.1:8767/releve';
    var MOTIF_IMAGE = /^https:\/\/pokemoncardimages\.pokedata\.io\/images\/[^\/]+\/([A-Za-z0-9-]+)\.webp$/;

    // le nom du set se lit dans l'adresse de la page (« + » = espace, %27 = apostrophe) : les dix pages de la liste fermée n'ont pas d'autre encodage
    function nomDuSet() {
        return String(location.pathname).replace(/^\/set\//, '').replace(/\+/g, ' ').replace(/%27/g, "'");
    }
    // une vignette « …_240w.webp » devient l'adresse pleine taille
    function pleine(src) {
        return String(src || '').replace(/_240w(?=\.webp)/, '');
    }
    function etiquette(el) {
        var s = String(el.tagName).replace(/[^A-Za-z0-9]/g, '');
        if (typeof el.className === 'string' && el.className !== '') s = s + '.' + el.className.replace(/\s+/g, '.').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
        return s;
    }
    // résumé STRUCTUREL : du plus haut ancêtre (4 niveaux) jusqu'à l'image, balises et classes seulement
    function chemin(img) {
        var s = 'IMG[src,alt]';
        var el = img.parentElement;
        var n = 0;
        while (el && n < 4) {
            s = etiquette(el) + ' / ' + s;
            el = el.parentElement;
            n = n + 1;
        }
        return s.slice(0, 300);
    }

    function lire() {
        var vus = {};
        var cartes = [];
        var structure = [];
        var imgs = 0;
        Array.prototype.forEach.call(document.images, function (img) {
            var src = pleine(img.currentSrc || img.src);
            if (!MOTIF_IMAGE.test(src)) return;
            imgs = imgs + 1;
            if (vus[src]) return;
            vus[src] = true;
            cartes.push({ numero: src.replace(/^.*\/([A-Za-z0-9-]+)\.webp$/, '$1'), nom: String(img.alt || '').trim().slice(0, 200), img: src });
            var c = chemin(img);
            if (structure.length < 5 && structure.indexOf(c) < 0) structure.push(c);
        });
        return { schema: 1, set: nomDuSet(), url: location.origin + location.pathname, cartes: cartes, diag: { imgs: imgs, structure: structure, complet: false } };
    }

    function dire(texte) {
        bouton.textContent = texte;
    }
    function envoyer() {
        var releve = lire();
        if (releve.cartes.length === 0) {
            dire('Aucune carte affichée : fais défiler la page jusqu\'en bas, puis recommence.');
            return;
        }
        GM_xmlhttpRequest({
            method: 'POST',
            url: RECEPTEUR,
            data: JSON.stringify(releve),
            headers: { 'Content-Type': 'application/json', 'X-Rat-Market': 'releve-passif' },
            onload: function (r) { dire(r.status === 200 ? releve.cartes.length + ' carte(s) envoyée(s)' : 'Refusé (' + r.status + ')'); },
            onerror: function () { dire('Le récepteur local ne répond pas (recepteur-pokedata.js est-il lancé ?)'); }
        });
    }

    var bouton = document.createElement('button');
    bouton.textContent = 'Relever cette page';
    bouton.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;padding:10px 14px;background:#222;color:#fff;border:0;border-radius:6px;font:14px sans-serif;cursor:pointer';
    bouton.addEventListener('click', envoyer);
    document.body.appendChild(bouton);
})();
