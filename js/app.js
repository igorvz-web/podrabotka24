(function (global) {
  'use strict';

  var P24 = global.P24 = global.P24 || {};
  var U = global.U;
  var Store = global.Store;
  var T = global.T;
  var API = global.API;

  var appEl = null, hostEl = null, navEl = null;
  var currentView = null, currentKey = null, backTo = 'feed';

  var TABS = [
    { key: 'feed', icon: 'feed', label: 'Лента' },
    { key: 'create', icon: 'plus', label: 'Создать' },
    { key: 'profile', icon: 'user', label: 'Профиль' }
  ];

  function applyTheme() {
    var root = document.documentElement;
    var bg = T.themeVar('bg_color');
    var sec = T.themeVar('secondary_bg_color');
    root.style.setProperty('--bg', bg);
    root.style.setProperty('--bg-sec', sec);
    root.style.setProperty('--card', bg);
    root.style.setProperty('--text', T.themeVar('text_color'));
    root.style.setProperty('--hint', T.themeVar('hint_color'));
    root.style.setProperty('--link', T.themeVar('link_color'));
    root.style.setProperty('--accent', T.themeVar('button_color'));
    root.style.setProperty('--accent-text', T.themeVar('button_text_color'));
    root.setAttribute('data-theme', T.dark ? 'dark' : 'light');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', bg);
  }

  function buildNav() {
    navEl = U.el('nav', { class: 'nav' });
    TABS.forEach(function (t) {
      var b = U.el('button', {
        dataset: { tab: t.key },
        onclick: function () { T.impact('light'); go(t.key); }
      }, [U.iconEl(t.icon), U.el('span', { text: t.label })]);
      navEl.appendChild(b);
    });
    return navEl;
  }

  function setNavActive(key) {
    if (!navEl) return;
    var btns = navEl.querySelectorAll('button');
    btns.forEach(function (b) { b.classList.toggle('active', b.dataset.tab === key); });
  }

  function cleanupCurrent() {
    if (!currentKey) return;
    if (currentKey === 'feed') P24.feed.cleanup();
    else if (currentKey === 'order') P24.order.cleanup();
    else if (currentKey === 'create') P24.create.cleanup();
    else if (currentKey === 'profile') P24.profile.cleanup();
    currentKey = null;
    currentView = null;
  }

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(global.location.search);
    return m ? decodeURIComponent(m[1] || '') : '';
  }

  function go(key, param, opts) {
    opts = opts || {};
    cleanupCurrent();
    hostEl.innerHTML = '';
    T.hideMainButton();

    var node = null;
    if (key === 'feed') node = P24.feed.render();
    else if (key === 'order') node = P24.order.render(param);
    else if (key === 'create') node = P24.create.render();
    else if (key === 'profile') node = P24.profile.render();

    if (!node) { key = 'feed'; node = P24.feed.render(); }

    currentKey = key;
    currentView = node;
    hostEl.appendChild(node);
    if (node.scrollTop) node.scrollTop = 0;

    setNavActive(key === 'order' ? backTo : key);

    if (key === 'order') {
      backTo = opts.back || 'feed';
      T.showBack(goBack);
    } else {
      backTo = 'feed';
      T.hideBack();
    }
  }

  function goBack() {
    go(backTo || 'feed');
  }

  P24.nav = {
    feed: function () { go('feed'); },
    order: function (id, opts) { go('order', id, opts); },
    create: function () { go('create'); },
    profile: function () { go('profile'); },
    goBack: goBack
  };

  function init() {
    T.init();
    applyTheme();

    appEl = document.getElementById('app');
    hostEl = U.el('div', { class: 'view-host' });
    appEl.appendChild(hostEl);
    appEl.appendChild(buildNav());

    var splash = document.getElementById('splash');
    var started = Date.now();
    Store.boot()
      .catch(function () { Store.bootLocal(); })
      .then(function () {
        var wait = Math.max(0, 500 - (Date.now() - started));
        setTimeout(function () {
          if (splash) splash.remove();
          appEl.hidden = false;

          /* Имя бота для ссылок «Поделиться» — с сервера (getMe). */
          if (T.isTg) {
            API.call('GET', '/api/bot/info').then(function (d) {
              if (d && d.username) T.botName = d.username;
            }).catch(function () {});
          }

          /* Редиплинк: t.me/бот?startapp=o_<id> или кнопка в уведомлении → открываем заказ. */
          var m = /^o_(\d+)$/.exec(T.startParam || qs('startapp') || '');
          if (m) go('order', Number(m[1]));
          else go('feed');

          /* Поллинг новых событий: тост + бейдж на колокольчике. */
          function pollNow() {
            if (document.hidden) return;
            Store.checkUpdates().then(function (fresh) {
              if (fresh && fresh.length) {
                U.toast('🔔 ' + fresh[0].text);
                T.notify('success');
              }
            });
          }
          setInterval(pollNow, 15000);
          document.addEventListener('visibilitychange', function () {
            if (!document.hidden) pollNow();
          });
        }, wait);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);