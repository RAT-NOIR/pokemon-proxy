// ==UserScript==
// @name         Rat-Market — Relevé passif pokemon.com
// @namespace    rat-market
// @version      1.0
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
    var SEL_NUMERO = '[class*="number"]';
    var SEL_SET = '[class*="set"], [class*="expansion"]';
    var SEL_COMPTEUR = '[class*="count"], [class*="total"], [class*="result"]';
    var SEL_PAGINATION = '[class*="pagination"], nav[aria-label*="agination"]';
    var SEL_CHOISIS = '[aria-pressed="true"], [aria-selected="true"], [class*="selected"]';
    var RE_COMPTEUR = /\d[\d.,]*\s*(?:cards?|results?|cartes|résultats)\b/i;
    var RE_NUMERO = /\b\d{1,3}\s*\/\s*\d{1,3}\b/;

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
    function lireCartes(zone) {
        var sortie = [], imgs = zone.querySelectorAll('img');
        for (var i = 0; i < imgs.length && sortie.length < CARTES_MAX; i++) {
            var img = imgs[i];
            var conteneur = (img.closest && img.closest('a, li, article')) || null;
            var alt = bornee(img.alt, 300), nom = texteDe(conteneur, SEL_NOM) || alt;
            if (!nom) continue;
            var numero = texteDe(conteneur, SEL_NUMERO);
            if (!numero && conteneur) { var n = RE_NUMERO.exec(normaliser(conteneur.textContent)); numero = n ? normaliser(n[0]) : ''; }
            sortie.push({ nom: nom.slice(0, 300), numero: numero.slice(0, 300), set: texteDe(conteneur, SEL_SET).slice(0, 300), img: String(img.currentSrc || img.src || '').slice(0, 1000), alt: alt });
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
            schema: 1,
            url: location.origin + location.pathname + location.search,
            titre: bornee(document.title, 300),
            filtre: lireFiltre(),
            compteur: lireCompteur(),
            pagination: pag ? bornee(pag.textContent, 500) : '',
            cartes: lireCartes(zone),
            html: h.html,
            htmlTronque: h.htmlTronque,
            zoneRepli: trouvee.repli
        };
    }

    function resume(j, corps) {
        var d = j.diagnostic || {};
        var ligne = '✅ ' + corps.cartes.length + ' cartes relevées · compteur « ' + (corps.compteur || '—') + ' »' + (corps.pagination ? ' · ' + corps.pagination : '');
        var repli = corps.zoneRepli ? '\nℹ️ zone des résultats non reconnue : relevé de toute la page (repli).' : '';
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
