// ==UserScript==
// @name         Rat-Market — Relevé passif pokemon.com
// @namespace    rat-market
// @version      1.1
// @description  Bouton « Relever cette page » sur la base de cartes de pokemon.com que TU ouvres. Au clic seulement, envoie ce que la page AFFICHE au récepteur LOCAL (127.0.0.1). Ne navigue jamais, ne défile jamais, ne lit aucun cookie, ne télécharge aucune image.
// @match        https://www.pokemon.com/us/pokemon-tcg/pokemon-cards*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==

// ============================================================
// 1.0 — PASSIF PAR CONSTRUCTION (décision du testeur, 2026-10-17 : « méthode passive comme PikaQian, pages ouvertes par moi seulement, aucune navigation automatique,
// aucun cookie réutilisé »). Au chargement, ce script n'ajoute qu'un panneau à la page : aucune requête ne part. Au clic seulement, il relève ce que la page AFFICHE :
// l'adresse, le titre, le filtre d'extension visible, le compteur de résultats et la pagination tels qu'affichés, puis pour chaque image de la zone des résultats : nom, numéro,
// set, ADRESSE de l'image et alt. Le dom de pokemon.com n'est pas connu du dépôt : il relève AUSSI l'outerHTML de la zone des résultats (sans <script>, borné à HTML_MAX).
// Les images : seules leurs adresses partent — aucune n'est téléchargée ni lue. Le seul réseau est un POST vers le récepteur local (recepteur-pokemoncom.js).
//
// 1.1 (schéma 2) — d'après le premier relevé RÉEL (Guardians Rising, 2026-10-17) : la page n'a aucun compteur de résultats ; elle a une pagination « 1 of 15 » dans
// #cards-load-more, 12 cartes par page, et le numéro + le code du set de chaque carte vivent dans le LIEN (/series/<code>/<numéro>/), répétés dans le nom de fichier
// de l'image (témoin). Les deux concordent -> numero et set ; ils divergent ou l'un manque -> numero vide + numeroDoute, jamais une devinette. Le relevé porte aussi la
// liste des cases d'extension du formulaire (hors zone des résultats) et les select de la page, bornées.
// ============================================================
(function () {
    'use strict';
    // LE PORT du récepteur : la valeur de `--port` de recepteur-pokemoncom.js (défaut 8766).
    var PORT = 8766;
    var RECEPTEUR = 'http://127.0.0.1:' + PORT + '/releve';
    var CHEMIN_BASE = '/us/pokemon-tcg/pokemon-cards';
    var HTML_MAX = 400000;
    var CARTES_MAX = 1000;
    var ZONES = ['[class*="card-results"]', '[class*="results"]', 'main'];
    var SEL_NOM = 'h1, h2, h3, h4, h5, h6, [class*="name"]';
    var SEL_COMPTEUR = '[class*="count"], [class*="total"], [class*="result"]';
    var SEL_PAGINATION = '#cards-load-more, [class*="pagination"], nav[aria-label*="agination"]';
    var SEL_CHOISIS = '[aria-pressed="true"], [aria-selected="true"], [class*="selected"]';
    var SEL_CASES = 'input[type="checkbox"][name]';
    var RE_COMPTEUR = /\d[\d.,]*\s*(?:cards?|results?|cartes|résultats)\b/i;
    // le lien d'une carte : motif strict ancré sur ce chemin ; le numéro garde ses lettres (124a, SV001, TG01)
    var RE_LIEN_CARTE = /^\/us\/pokemon-tcg\/pokemon-cards\/series\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/?$/;
    // le témoin : le nom de fichier de l'image, <CODE>_<langue>_<numéro>.png
    var RE_IMAGE_CARTE = /^([A-Za-z0-9]+)_[A-Za-z]{2}_([A-Za-z0-9]+)\.(?:png|jpe?g|webp)$/i;
    var CASES_MAX = 500;
    var SELECTS_MAX = 30;
    var OPTIONS_MAX = 100;
    var LIBELLE_MAX = 200;

    // ===== UI =====
    var panneau = document.createElement('div');
    panneau.style.cssText =
        'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0d0d10;color:#eee;' +
        'font:13px system-ui,sans-serif;padding:12px 14px;border:1px solid #D4AF37;border-radius:10px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.4);width:300px';
    panneau.innerHTML =
        '<div style="font-weight:600;margin-bottom:2px">🐀 Relever cette page</div>' +
        '<div id="rm-sous" style="color:#888;font-size:11px;margin-bottom:8px">pokemon.com · relevé local, sans identifiant, sans image téléchargée</div>' +
        '<button id="rm-go" style="width:100%;padding:7px;background:#0c0c0e;color:#D4AF37;' +
        'border:1px solid #D4AF37;border-radius:6px;cursor:pointer;font-weight:600">Relever</button>' +
        '<div id="rm-msg" style="margin-top:8px;min-height:16px;color:#bbb;line-height:1.4;white-space:pre-wrap"></div>';
    document.body.appendChild(panneau);
    var bouton = panneau.querySelector('#rm-go');
    var msg = panneau.querySelector('#rm-msg');
    function dire(texte, couleur) { msg.style.color = couleur || '#bbb'; msg.textContent = texte; }
    dire('Rien n\'est envoyé avant ton clic. Affiche la page voulue, puis clique une fois.');

    // ===== Envoi au récepteur local =====
    function poster(objet) {
        return new Promise(function (resoudre, rejeter) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: RECEPTEUR,
                headers: { 'Content-Type': 'application/json', 'X-Rat-Market': 'rat-market-passif' },
                data: JSON.stringify(objet),
                anonymous: true,
                timeout: 30000,
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
    function texteDe(parent, selecteur) { var e = parent && parent.querySelector(selecteur); return e ? normaliser(e.textContent) : ''; }
    function bornee(t, max) { return normaliser(t).slice(0, max); }

    function zoneDesResultats() {
        for (var i = 0; i < ZONES.length; i++) { var z = document.querySelector(ZONES[i]); if (z) return { zone: z, repli: false }; }
        return { zone: document.body, repli: true };   // repli : MARQUÉ dans le relevé (zoneRepli), borné par lireHtml comme toute zone
    }
    function cheminDuLien(conteneur) {
        if (!conteneur) return '';
        var h = conteneur.getAttribute ? conteneur.getAttribute('href') : conteneur.href;
        if (!h && conteneur.querySelector) { var a = conteneur.querySelector('a[href]'); h = a ? (a.getAttribute ? a.getAttribute('href') : a.href) : ''; }
        if (!h) return '';
        try {
            var u = new URL(String(h), location.href);
            return u.origin === location.origin ? u.pathname : '';
        } catch (e) { return ''; }
    }
    // numéro + set : le lien ET le nom de fichier de l'image doivent dire la même chose (casse ignorée) ; sinon vide + doute, jamais une devinette
    function identifier(conteneur, img) {
        var lien = RE_LIEN_CARTE.exec(cheminDuLien(conteneur));
        var fichier = String(img.currentSrc || img.src || '').split('?')[0].split('#')[0].split('/').pop();
        var temoin = RE_IMAGE_CARTE.exec(fichier);
        if (lien && temoin && lien[1].toLowerCase() === temoin[1].toLowerCase() && lien[2].toLowerCase() === temoin[2].toLowerCase()) {
            return { numero: lien[2], set: lien[1], numeroDoute: false };
        }
        return { numero: '', set: '', numeroDoute: true };
    }
    function lireCartes(zone) {
        var sortie = [], imgs = zone.querySelectorAll('img');
        for (var i = 0; i < imgs.length && sortie.length < CARTES_MAX; i++) {
            var img = imgs[i];
            var conteneur = (img.closest && img.closest('a, li, article')) || null;
            var alt = bornee(img.alt, 300), nom = texteDe(conteneur, SEL_NOM) || alt;
            if (!nom) continue;
            var id = identifier(conteneur, img);
            sortie.push({ nom: nom.slice(0, 300), numero: id.numero, numeroDoute: id.numeroDoute, set: id.set, img: String(img.currentSrc || img.src || '').slice(0, 1000), alt: alt });
        }
        return sortie;
    }
    // la liste des extensions du formulaire : les cases nommées de la page, hors zone des résultats
    function libelleDe(c) {
        var lib = null;
        if (c.id && /^[A-Za-z0-9_-]+$/.test(c.id)) lib = document.querySelector('label[for="' + c.id + '"]');
        if (!lib && c.closest) lib = c.closest('label');
        return lib ? bornee(lib.textContent, LIBELLE_MAX) : '';
    }
    function lireExtensions(zone, repli) {
        var sortie = [], cases = document.querySelectorAll(SEL_CASES);
        for (var i = 0; i < cases.length && sortie.length < CASES_MAX; i++) {
            var c = cases[i];
            if (!repli && zone.contains && zone.contains(c)) continue;
            sortie.push({ 'case': bornee(c.name, LIBELLE_MAX), libelle: libelleDe(c), cochee: !!c.checked });
        }
        return sortie;
    }
    function lireSelects() {
        var sortie = [], selects = document.querySelectorAll('select');
        for (var i = 0; i < selects.length && sortie.length < SELECTS_MAX; i++) {
            var opts = selects[i].options || [], textes = [];
            for (var j = 0; j < opts.length && textes.length < OPTIONS_MAX; j++) textes.push(bornee(opts[j].textContent, LIBELLE_MAX));
            sortie.push({ nom: bornee(selects[i].name || selects[i].id || '', 100), options: textes });
        }
        return sortie;
    }
    function lireCompteur() {
        var items = document.querySelectorAll(SEL_COMPTEUR);
        for (var i = 0; i < items.length; i++) { var m = RE_COMPTEUR.exec(normaliser(items[i].textContent)); if (m) return m[0].slice(0, 300); }
        var b = RE_COMPTEUR.exec(normaliser(document.body && document.body.textContent));
        return b ? b[0].slice(0, 300) : '';
    }
    function lireFiltre() {
        var sortie = [], i, t;
        var selects = document.querySelectorAll('select');
        for (i = 0; i < selects.length; i++) {
            var o = selects[i].options && selects[i].options[selects[i].selectedIndex];
            t = o ? bornee(o.textContent, 200) : '';
            if (t && sortie.indexOf(t) < 0) sortie.push(t);
        }
        var choisis = document.querySelectorAll(SEL_CHOISIS);
        for (i = 0; i < choisis.length && sortie.length < 20; i++) { t = bornee(choisis[i].textContent, 200); if (t && sortie.indexOf(t) < 0) sortie.push(t); }
        return sortie.slice(0, 20);
    }
    function lireHtml(zone) {
        // balises fermées (</script >, casse quelconque), puis toute balise jamais refermée jusqu'à la fin
        var h = String(zone.outerHTML || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[\s\S]*$/i, '');
        return h.length > HTML_MAX ? { html: h.slice(0, HTML_MAX), htmlTronque: true } : { html: h, htmlTronque: false };
    }
    function releve() {
        var trouvee = zoneDesResultats(), zone = trouvee.zone, h = lireHtml(zone), pag = document.querySelector(SEL_PAGINATION);
        return {
            schema: 2,
            url: location.origin + location.pathname + location.search,
            titre: bornee(document.title, 300),
            filtre: lireFiltre(),
            compteur: lireCompteur(),
            pagination: pag ? bornee(pag.textContent, 500) : '',
            cartes: lireCartes(zone),
            extensions: lireExtensions(zone, trouvee.repli),
            selects: lireSelects(),
            html: h.html,
            htmlTronque: h.htmlTronque,
            zoneRepli: trouvee.repli
        };
    }

    function resume(j, corps) {
        var d = j.diagnostic || {};
        var pageLue = d.pageCourante > 0 && d.pagesTotal > 0;
        var ligne = '✅ ' + corps.cartes.length + ' cartes relevées' + (pageLue ? ' · page ' + d.pageCourante + ' sur ' + d.pagesTotal : ' · compteur « ' + (corps.compteur || '—') + ' »' + (corps.pagination ? ' · ' + corps.pagination : ''));
        var repli = (corps.zoneRepli ? '\nℹ️ zone des résultats non reconnue : relevé de toute la page (repli).' : '') +
            (d.numerosDoutes ? '\n⚠️ ' + d.numerosDoutes + ' numéro(s) douteux (lien et image en désaccord) : laissés vides.' : '') +
            (d.extensions ? '\nℹ️ ' + d.extensions + ' extensions du formulaire relevées.' : '');
        if (pageLue) {
            var suite = d.pageCourante < d.pagesTotal ? '\n➡️ Ouvre la page suivante toi-même, puis reclique.' : '';
            if (d.complet === false) return { texte: ligne + '\n⚠️ page incomplète : ' + d.cartes + ' cartes vues. Laisse la page finir de s\'afficher, puis reclique.' + suite + repli, couleur: '#e6a23c' };
            return { texte: ligne + '\n✅ page complète' + (d.sansImage ? ' · ' + d.sansImage + ' sans image' : '') + suite + repli, couleur: suite ? '#e6a23c' : '#67c23a' };
        }
        if (d.etat === 'pagine') return { texte: ligne + '\nℹ️ compteur = total (' + d.annonce + ') ; cette page montre ' + d.cartes + ' cartes — normal si paginé : relève chaque page.' + repli, couleur: '#e6a23c' };
        if (d.etat === 'incomplet') return { texte: ligne + '\n⚠️ page incomplète : le compteur annonce ' + d.annonce + ', ' + d.cartes + ' cartes vues, sans pagination visible. Affiche le reste toi-même (défile, « charger plus »), puis reclique : chaque clic écrit son propre fichier.' + repli, couleur: '#e6a23c' };
        if (d.complet === null || d.complet === undefined) return { texte: ligne + '\n⚠️ compteur non lu : impossible de dire si la page est complète.', couleur: '#e6a23c' };
        return { texte: ligne + '\n✅ page complète' + (d.sansNumero ? ' · ' + d.sansNumero + ' sans numéro' : '') + (d.sansImage ? ' · ' + d.sansImage + ' sans image' : ''), couleur: '#67c23a' };
    }

    // ===== Le clic =====
    bouton.addEventListener('click', function () {
        if (location.pathname.indexOf(CHEMIN_BASE) !== 0) {
            dire('Cette page n\'est pas la base de cartes (' + CHEMIN_BASE + ') : rien n\'est envoyé.', '#e6a23c');
            return;
        }
        bouton.disabled = true; bouton.style.opacity = '.6';
        dire('Envoi du relevé au récepteur local…');
        var corps = releve();
        poster(corps).then(function (rep) {
            bouton.disabled = false; bouton.style.opacity = '1';
            var j = rep.json;
            if (!(j && j.ok)) { dire('❌ Refusé (HTTP ' + rep.status + ') : ' + ((j && j.motif) || 'réponse illisible du récepteur'), '#f56c6c'); return; }
            var r = resume(j, corps);
            dire(r.texte, r.couleur);
        }, function (e) {
            bouton.disabled = false; bouton.style.opacity = '1';
            dire(e && e.reseau === 'delai'
                ? '❌ Le récepteur ne répond pas (délai dépassé) : vérifie qu\'il tourne, puis recommence.'
                : '❌ Le récepteur ne répond pas : lance-le (node recepteur-pokemoncom.js), puis recommence.', '#f56c6c');
        });
    });
})();
