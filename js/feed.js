(function (global) {
  'use strict';

  var P24 = global.P24 = global.P24 || {};
  var U = global.U;
  var Store = global.Store;
  var T = global.T;

  var TYPES = ['Все', 'Грузчики', 'Разнорабочие', 'Переезды', 'Уборка', 'Другое'];

  P24.feed = (function () {
    var view = null, listEl = null, ptrEl = null, sentinelEl = null, endEl = null;
    var obs = null;
    var searchInput = null;
    var pull = { startY: 0, active: false, dist: 0, refreshing: false, attached: false };

    var state = { query: '', type: 'Все', sort: 'new', page: 0, pageSize: 8 };

    function getVisible() {
      var q = state.query.trim().toLowerCase();
      var list = Store.getOrders().filter(function (o) {
        if (state.type !== 'Все' && o.type !== state.type) return false;
        if (state.sort === 'urgent' && !o.urgent) return false;
        if (q && (o.title + ' ' + (o.description || '')).toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (state.sort === 'priceDesc') return (b.price || 0) - (a.price || 0);
        return (b.created_at || 0) - (a.created_at || 0);
      });
      return list;
    }

    function orderCard(o) {
      var badges = [U.el('span', { class: 'badge', text: o.type })];
      if (o.urgent) badges.push(U.el('span', { class: 'badge warn', text: 'Срочно' }));
      if (o.status !== 'open') {
        badges.push(U.el('span', { class: 'badge ' + (o.status === 'done' ? 'ok' : 'soft'), text: o.status === 'done' ? 'Завершён' : 'В работе' }));
      }
      return U.el('button', {
        class: 'card order-card', onclick: function () { T.impact('light'); P24.nav.order(o.id); }
      }, [
        U.el('div', { class: 'order-top' }, badges),
        U.el('div', { class: 'order-title', text: o.title }),
        U.el('p', { class: 'order-desc', text: o.description }),
        U.el('div', { class: 'order-meta' }, [
          U.el('div', { class: 'row' }, [U.iconEl('pin'), U.el('span', { text: o.address })]),
          U.el('div', { class: 'row' }, [U.iconEl('clock'), U.el('span', { text: U.fmtDateTime(o.datetime) })]),
          U.el('div', { class: 'row' }, [U.el('span', { text: 'Опубликовано ' + U.timeAgo(o.created_at), style: { fontSize: '11px', color: 'var(--hint)' } })])
        ]),
        U.el('div', { class: 'order-foot' }, [
          U.el('div', { class: 'price', html: U.esc(o.price.toLocaleString('ru-RU')) + ' <span class="cur">₽</span>' }),
          U.el('span', { class: 'responses-count' }, [U.iconEl('users'), U.el('span', { text: o.responses.length })])
        ])
      ]);
    }

    function startObs() {
      stopObs();
      if (!sentinelEl || typeof IntersectionObserver === 'undefined') return;
      obs = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) loadMore();
      }, { root: view, rootMargin: '120px', threshold: 0 });
      obs.observe(sentinelEl);
    }

    function stopObs() { if (obs) { try { obs.disconnect(); } catch (e) {} obs = null; } }

    function renderList() {
      listEl.innerHTML = '';
      var all = getVisible();
      var slice = all.slice(0, (state.page + 1) * state.pageSize);
      if (!slice.length) {
        listEl.appendChild(emptySearchState());
      } else {
        slice.forEach(function (o) { listEl.appendChild(orderCard(o)); });
      }
      updateEnd(all);
      startObs();
    }

    function updateEnd(total) {
      var shown = (state.page + 1) * state.pageSize;
      if (shown >= total) {
        endEl.style.display = 'block';
        endEl.textContent = total ? 'Все заказы показаны' : '';
      } else {
        endEl.style.display = 'none';
      }
    }

    function emptySearchState() {
      if (state.query) {
        return U.emptyState('search', 'Ничего не найдено', 'Попробуйте изменить запрос или фильтр');
      }
      return U.emptyState('feed', 'Заказов пока нет', 'Создайте первый заказ — кнопка «+» внизу');
    }

    function loadMore() {
      var all = getVisible();
      if ((state.page + 1) * state.pageSize >= all.length) { updateEnd(all); return; }
      state.page++;
      var slice = all.slice((state.page) * state.pageSize, (state.page + 1) * state.pageSize);
      slice.forEach(function (o) { listEl.appendChild(orderCard(o)); });
      updateEnd(all);
    }

    function reset() { state.page = 0; renderList(); }

    async function reloadFeed(silent) {
      await Store.refreshOrders();
      reset();
      if (!silent) U.toast('Лента обновлена');
    }

    /* ---- Pull-to-refresh ---- */
    function attachPtr() {
      if (pull.attached || !view) return;
      pull.attached = true;
      view.addEventListener('touchstart', function (e) {
        if (view.scrollTop <= 0 && !pull.refreshing) {
          pull.startY = e.touches[0].clientY;
          pull.active = true;
          pull.dist = 0;
        }
      }, { passive: true });
      view.addEventListener('touchmove', function (e) {
        if (!pull.active) return;
        var dy = e.touches[0].clientY - pull.startY;
        if (dy > 0 && view.scrollTop <= 0) {
          pull.dist = Math.min(dy * 0.5, 72);
          ptrEl.style.height = pull.dist + 'px';
          ptrEl.innerHTML = pull.dist >= 60 ? 'Отпустите для обновления' : '<div class="spinner"></div>';
          e.preventDefault();
        } else if (dy <= 0) {
          pull.dist = 0;
          ptrEl.style.height = '0px';
        }
      }, { passive: false });
      view.addEventListener('touchend', function () {
        if (!pull.active) return;
        pull.active = false;
        if (pull.dist >= 60 && !pull.refreshing) {
          pull.refreshing = true;
          ptrEl.style.height = '44px';
          ptrEl.innerHTML = '<div class="spinner"></div>';
          setTimeout(function () {
            reloadFeed(true);
            ptrEl.style.height = '0px';
            ptrEl.innerHTML = '';
            pull.refreshing = false;
            U.toast('Лента обновлена');
            T.notify('success');
          }, 450);
        } else {
          ptrEl.style.height = '0px';
          ptrEl.innerHTML = '';
        }
      }, { passive: true });
    }

    /* ---- Notifications modal ---- */
    function openNotifs() {
      var notifs = Store.getNotifs();
      var body = U.el('div', {});
      if (!notifs.length) {
        body.appendChild(U.el('div', { class: 'empty', html: U.icon('bell') + '<div class="t">Уведомлений нет</div><div class="s">Отклики и события появятся здесь</div>' }));
      } else {
        notifs.forEach(function (n) {
          body.appendChild(U.el('div', { class: 'notif-item' + (n.read ? '' : ' unread') }, [
            U.el('div', { class: 'ic', text: '🔔' }),
            U.el('div', { class: 'tx' }, [
              U.el('div', { text: n.text }),
              U.el('div', { class: 'tm', text: U.timeAgo(n.time) })
            ])
          ]));
        });
      }
      U.modal({ title: 'Уведомления', sub: 'События ваших заказов и откликов', body: body, buttons: [{ text: 'Понятно', cls: 'ghost' }] });
      Store.markNotifsRead();
      renderTopbarBell();
    }

    var bellEl = null;
    function renderTopbarBell() {
      if (!bellEl) return;
      var n = Store.unreadCount();
      bellEl.innerHTML = '';
      bellEl.appendChild(U.iconEl('bell'));
      if (n) bellEl.appendChild(U.el('span', { class: 'badge-dot', text: n > 9 ? '9+' : n }));
    }
    document.addEventListener('p24:notifs', function () { renderTopbarBell(); });

    /* ---- Hero banner ---- */
    function buildHero() {
      var orders = Store.getOrders();
      var open = orders.filter(function (o) { return o.status === 'open'; }).length;
      var urgent = orders.filter(function (o) { return o.status === 'open' && o.urgent; }).length;
      return U.el('div', { class: 'hero' }, [
        U.el('div', { class: 'hero-label', text: 'Подработка 24' }),
        U.el('div', { class: 'hero-title', text: 'Найди подработку за минуту' }),
        U.el('div', { class: 'hero-sub', text: 'Свежие заказы рядом — без листания чатов' }),
        U.el('div', { class: 'hero-stats' }, [
          U.el('div', { class: 'hero-stat' }, [U.el('b', { text: open }), U.el('span', { text: 'открытых заказов' })]),
          U.el('div', { class: 'hero-stat' }, [U.el('b', { text: urgent }), U.el('span', { text: 'срочных' })])
        ])
      ]);
    }

    function render() {
      state.page = 0;
      view = U.el('div', { class: 'view anim' });

      var topbar = U.el('header', { class: 'topbar' }, [
        U.el('div', { class: 'logo', html: U.icon('zap') }),
        U.el('div', { class: 'title-wrap' }, [
          U.el('h1', { text: 'Подработка 24' }),
          U.el('div', { class: 'topbar-sub', text: 'Грузчики · Разнорабочие · Переезды' })
        ]),
        (bellEl = U.el('button', {
          class: 'icon-btn', onclick: function () { T.impact('light'); openNotifs(); }
        }))
      ]);
      renderTopbarBell();
      view.appendChild(topbar);
      if (Store.me().blocked) {
        view.appendChild(U.el('div', { class: 'card blocked-banner' }, [
          U.el('div', { class: 'blocked-banner-icon', html: U.icon('flag') }),
          U.el('div', {}, [
            U.el('b', { text: 'Ваш аккаунт заблокирован' }),
            U.el('p', { text: 'Вы не можете создавать заказы и откликаться. Обратитесь к администратору.' })
          ])
        ]));
      }
      view.appendChild(buildHero());

      var searchRow = U.el('div', { class: 'search-row' }, [
        U.el('div', { class: 'search-box' }, [
          U.iconEl('search'),
          (searchInput = U.el('input', { type: 'text', placeholder: 'Поиск: грузчик, переезд, уборка…', value: state.query })),
          U.el('button', { class: 'search-clear', text: '✕', onclick: function () { if (searchInput) { searchInput.value = ''; state.query = ''; reset(); } } })
        ])
      ]);
      searchInput.addEventListener('input', U.debounce(function () {
        state.query = searchInput.value;
        reset();
      }, 200));
      view.appendChild(searchRow);

      var chips = U.el('div', { class: 'chips-row' });
      TYPES.forEach(function (t) {
        chips.appendChild(U.el('button', {
          class: 'chip' + (state.type === t ? ' active' : ''),
          text: t,
          onclick: function () {
            T.impact('light');
            state.type = t;
            chips.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('active', c.textContent === t); });
            reset();
          }
        }));
      });
      view.appendChild(chips);

      var sortRow = U.el('div', { class: 'sort-row' }, [
        U.el('span', { class: 'lbl', text: 'Показ:' }),
        U.el('div', { class: 'seg' }, [
          segBtn('Новые', 'new'),
          segBtn('Дороже', 'priceDesc'),
          segBtn('Срочно', 'urgent')
        ])
      ]);
      view.appendChild(sortRow);

      var listWrap = U.el('div', { class: 'ptr-wrap' });
      ptrEl = U.el('div', { class: 'ptr-indicator' });
      listEl = U.el('div', { class: 'list' });
      sentinelEl = U.el('div', { class: 'load-more-sentinel' });
      endEl = U.el('div', { class: 'end-note' });
      listWrap.appendChild(ptrEl);
      listWrap.appendChild(listEl);
      listWrap.appendChild(sentinelEl);
      listWrap.appendChild(endEl);
      view.appendChild(listWrap);

      renderList();
      attachPtr();
      return view;
    }

    function segBtn(label, key) {
      return U.el('button', {
        class: state.sort === key ? 'active' : '',
        text: label,
        onclick: function () {
          T.impact('light');
          state.sort = key;
          var seg = this.parentNode;
          seg.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
          this.classList.add('active');
          reset();
        }
      });
    }

    function cleanup() {
      stopObs();
      pull.attached = false;
      view = null; listEl = null; ptrEl = null; sentinelEl = null; endEl = null;
      searchInput = null; bellEl = null;
    }

    return { render: render, cleanup: cleanup, reload: reloadFeed, state: state };
  })();
})(window);