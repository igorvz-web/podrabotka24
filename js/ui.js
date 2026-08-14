(function (global) {
  'use strict';

  /* ---- SVG-иконки ---- */
  var ICONS = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.8"/><path d="M16 15.5a5 5 0 0 1 5.5 4.5"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    feed: '<svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h10"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
    geo: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    wrench: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.9 2.9-2.4-2.4z"/></svg>',
    ruble: '<svg viewBox="0 0 24 24"><path d="M7 4h7a4 4 0 0 1 0 8H7zM7 12h5M7 16h4"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.5-7-10a3.5 3.5 0 0 1 7-1.5A3.5 3.5 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"/></svg>',
    zap: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="#ffffff" stroke="none"><path d="M13.4 1.7 4.4 13.6h5.4l-1.7 8.7L17.6 10.4h-5.4z"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M6 21V3M6 4h13l-3 4.5L19 13H6"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
  };

  function icon(name) { return ICONS[name] || ''; }
  function iconEl(name, cls) { return el('span', { class: cls || '', html: icon(name) }); }

  /* ---- Создание элемента ---- */
  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v === undefined || v === null) continue;
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'value') n.value = v;
        else n.setAttribute(k, v);
      }
    }
    if (children !== undefined && children !== null) {
      var arr = Array.isArray(children) ? children : [children];
      arr.forEach(function (c) {
        if (c === undefined || c === null || c === false) return;
        n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  /* ---- Форматирование ---- */
  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  function fmtPrice(n) {
    n = Math.round(n || 0);
    return n.toLocaleString('ru-RU') + ' ₽';
  }

  function pad2(x) { return (x < 10 ? '0' : '') + x; }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    var tom = new Date(now); tom.setDate(now.getDate() + 1);
    var isTom = d.getFullYear() === tom.getFullYear() && d.getMonth() === tom.getMonth() && d.getDate() === tom.getDate();
    var time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (sameDay) return 'Сегодня, ' + time;
    if (isTom) return 'Завтра, ' + time;
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + time;
  }

  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'только что';
    var m = Math.floor(s / 60);
    if (m < 60) return plural(m, ['минуту', 'минуты', 'минут']) + ' назад';
    var h = Math.floor(m / 60);
    if (h < 24) return plural(h, ['час', 'часа', 'часов']) + ' назад';
    var d = Math.floor(h / 24);
    return plural(d, ['день', 'дня', 'дней']) + ' назад';
  }

  function plural(n, forms) {
    n = Math.abs(n) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function starsHTML(r, size) {
    r = Math.round((r || 0) * 2) / 2;
    var out = '';
    for (var i = 1; i <= 5; i++) {
      var full = r >= i;
      var half = !full && r >= i - 0.5;
      var cls = full || half ? '' : 'off';
      var f = ICONS.star;
      if (half) {
        f = '<svg viewBox="0 0 24 24"><defs><linearGradient id="hg"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs><path fill="url(#hg)" d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
      }
      out += '<span class="star ' + cls + '" style="' + (size ? 'font-size:' + size + 'px;' : '') + '">' + f + '</span>';
    }
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  /* ---- Toast ---- */
  function toast(msg) {
    var root = document.getElementById('toast-root');
    if (!root) return;
    var n = el('div', { class: 'toast', text: msg });
    root.appendChild(n);
    setTimeout(function () { n.classList.add('out'); }, 2200);
    setTimeout(function () { n.remove(); }, 2500);
  }

  /* ---- Modal (bottom sheet) ---- */
  function modal(opts) {
    var root = document.getElementById('modal-root');
    var sheet = el('div', { class: 'modal-sheet' });
    var overlay = el('div', { class: 'modal-overlay ' + (opts.center ? 'center' : '') });
    if (opts.title) sheet.appendChild(el('div', { class: 'modal-title', text: opts.title }));
    if (opts.sub) sheet.appendChild(el('div', { class: 'modal-sub', text: opts.sub }));
    if (opts.body) sheet.appendChild(opts.body);
    if (opts.buttons && opts.buttons.length) {
      var act = el('div', { class: 'modal-actions' });
      opts.buttons.forEach(function (b) {
        act.appendChild(el('button', {
          class: 'btn ' + (b.cls || 'ghost'),
          text: b.text,
          onclick: function () { close(); if (b.onClick) b.onClick(); }
        }));
      });
      sheet.appendChild(act);
    }
    overlay.appendChild(sheet);
    overlay.addEventListener('click', function (e) { if (e.target === overlay && !opts.locked) close(); });
    root.appendChild(overlay);

    function close() { overlay.remove(); }
    return { close: close, overlay: overlay };
  }

  function confirmBox(text, opts) {
    opts = opts || {};
    return modal({
      title: opts.title || 'Подтверждение',
      sub: text,
      buttons: [
        { text: opts.okText || 'Да', cls: opts.danger ? 'danger' : 'primary', onClick: opts.onOk },
        { text: 'Отмена', cls: 'ghost' }
      ]
    });
  }

  function textPrompt(opts) {
    var ta = el('textarea', { class: 'textarea', placeholder: opts.placeholder || '', rows: 3 });
    var wrap = el('div', {}, [ta]);
    return modal({
      title: opts.title || '',
      sub: opts.sub || '',
      body: wrap,
      buttons: [
        { text: opts.okText || 'Отправить', cls: 'primary', onClick: function () { opts.onOk(ta.value.trim()); } },
        { text: 'Отмена', cls: 'ghost' }
      ]
    });
  }

  function emptyState(ic, title, sub, extra) {
    var children = [icon(ic)];
    if (title) children.push(el('div', { class: 't', text: title }));
    if (sub) children.push(el('div', { class: 's', text: sub }));
    if (extra) children.push(extra);
    return el('div', { class: 'empty' }, children);
  }

  function spinner() { return el('div', { class: 'spinner' }); }

  global.U = {
    el: el,
    icon: icon,
    iconEl: iconEl,
    ICONS: ICONS,
    fmtPrice: fmtPrice,
    fmtDateTime: fmtDateTime,
    timeAgo: timeAgo,
    plural: plural,
    starsHTML: starsHTML,
    esc: esc,
    debounce: debounce,
    copyText: copyText,
    toast: toast,
    modal: modal,
    confirmBox: confirmBox,
    textPrompt: textPrompt,
    emptyState: emptyState,
    spinner: spinner
  };
})(window);