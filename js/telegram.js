(function (global) {
  'use strict';

  /* Обёртка Telegram WebApp API с фолбэком для браузера (демо) */
  var T = {
    isTg: false,
    tg: null,
    user: null,
    initData: '',
    startParam: '',
    theme: {},
    dark: false,
    mainButton: null,
    backButton: null,
    haptic: null,
    botName: (typeof global.BOT_USERNAME === 'string' && global.BOT_USERNAME) ? global.BOT_USERNAME : 'podrabotka24_bot'
  };

  function isDarkHex(hex) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
    if (!m) return false;
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
  }

  var FALLBACK = {
    light: {
      bg_color: '#ffffff', secondary_bg_color: '#f1f1f1', text_color: '#000000',
      hint_color: '#8e8e93', link_color: '#2481cc', button_color: '#2481cc',
      button_text_color: '#ffffff', header_bg_color: '#ffffff'
    },
    dark: {
      bg_color: '#1c1c1e', secondary_bg_color: '#2c2c2e', text_color: '#ffffff',
      hint_color: '#98989f', link_color: '#4da3ff', button_color: '#3a9bff',
      button_text_color: '#ffffff', header_bg_color: '#1c1c1e'
    }
  };

  function themeVar(name) {
    var t = T.theme;
    var map = {
      bg_color: t.bg_color,
      secondary_bg_color: t.secondary_bg_color,
      text_color: t.text_color,
      hint_color: t.hint_color,
      link_color: t.link_color,
      button_color: t.button_color,
      button_text_color: t.button_text_color,
      header_bg_color: t.header_bg_color
    };
    if (map[name]) return map[name];
    return FALLBACK[T.dark ? 'dark' : 'light'][name];
  }

  function init() {
    var tg = global.Telegram && global.Telegram.WebApp ? global.Telegram.WebApp : null;

    if (tg && tg.initData) {
      T.isTg = true;
      T.tg = tg;
      T.initData = tg.initData || '';
      var u = tg.initDataUnsafe && tg.initDataUnsafe.user;
      T.user = u ? u : null;
      T.startParam = (tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
      T.theme = tg.themeParams || {};
      T.dark = tg.colorScheme === 'dark' || isDarkHex(T.theme.bg_color);
      T.mainButton = tg.MainButton;
      T.backButton = tg.BackButton;
      T.haptic = tg.HapticFeedback;
      try { tg.ready(); } catch (e) {}
      try { tg.expand(); } catch (e) {}
      try { if (tg.setHeaderColor) tg.setHeaderColor(T.theme.header_bg_color || 'bg_color'); } catch (e) {}
    } else {
      /* Фолбэк: обычный браузер, демо-пользователь */
      T.isTg = false;
      T.dark = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches;
      T.theme = {};
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem('p24_user')); } catch (e) {}
      if (saved && saved.id) {
        T.user = {
          id: saved.id,
          first_name: (saved.name || 'Иван').split(' ')[0] || 'Иван',
          last_name: (saved.name || '').split(' ').slice(1).join(' ') || 'Петров',
          username: saved.username || 'demo',
          photo_url: saved.photo || ''
        };
      } else {
        T.user = { id: 999001, first_name: 'Иван', last_name: 'Петров', username: 'demo_user', photo_url: '' };
      }
    }
    return T;
  }

  /* ---- API методов Telegram WebApp ---- */
  function expand() { try { T.tg.expand(); } catch (e) {} }
  function impact(style) { try { if (T.haptic) T.haptic.impactOccurred(style || 'light'); } catch (e) {} }
  function notify(type) { try { if (T.haptic) T.haptic.notificationOccurred(type || 'success'); } catch (e) {} }

  function setMainButton(opts) {
    if (!T.isTg || !T.mainButton) return;
    try {
      var mb = T.mainButton;
      if (opts.text !== undefined) mb.setText(opts.text);
      if (opts.color) mb.setColor(opts.color);
      if (opts.textColor) mb.setTextColor(opts.textColor);
      if (opts.onClick) {
        mb.offClick();
        mb.onClick(opts.onClick);
      }
      if (opts.enabled !== undefined) { opts.enabled ? mb.enable() : mb.disable(); }
      if (opts.visible !== undefined) { opts.visible ? mb.show() : mb.hide(); }
    } catch (e) {}
  }

  function hideMainButton() { if (T.isTg && T.mainButton) { try { T.mainButton.hide(); } catch (e) {} } }

  function showBack(cb) {
    if (!T.isTg || !T.backButton) return;
    try { T.backButton.offClick(); T.backButton.onClick(cb); T.backButton.show(); } catch (e) {}
  }

  function hideBack() { if (T.isTg && T.backButton) { try { T.backButton.hide(); T.backButton.offClick(); } catch (e) {} } }

  function openLink(url) {
    if (T.isTg) { try { T.tg.openLink(url); return; } catch (e) {} }
    global.open(url, '_blank');
  }

  function openTelegramLink(url) {
    if (T.isTg) { try { T.tg.openTelegramLink(url); return; } catch (e) {} }
    global.open(url, '_blank');
  }

  /* Проверка initData выполняется на бэкенде (прод): подпись HMAC-SHA256 по secret key бота.
     Здесь — заглушка для демо, без токена бота в браузере. */
  function verifyInitData() {
    return !T.initData || true; /* демо-режим: токен бота хранится только на сервере */
  }

  T.init = init;
  T.themeVar = themeVar;
  T.expand = expand;
  T.impact = impact;
  T.notify = notify;
  T.setMainButton = setMainButton;
  T.hideMainButton = hideMainButton;
  T.showBack = showBack;
  T.hideBack = hideBack;
  T.openLink = openLink;
  T.openTelegramLink = openTelegramLink;
  T.verifyInitData = verifyInitData;

  global.T = T;
})(window);