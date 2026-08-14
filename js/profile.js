(function (global) {
  'use strict';

  var P24 = global.P24 = global.P24 || {};
  var U = global.U;
  var Store = global.Store;
  var T = global.T;

  var SKILLS = ['грузчик', 'разнорабочий', 'сборка мебели', 'переезды', 'уборка', 'водитель'];
  var ROLES = [
    { key: 'worker', label: 'Ищу работу' },
    { key: 'customer', label: 'Ищу работников' },
    { key: 'both', label: 'И то и другое' }
  ];

  P24.profile = (function () {
    var view = null, contentEl = null;
    var tab = 'orders';

    function render() {
      view = U.el('div', { class: 'view anim' });
      view.appendChild(U.el('header', { class: 'topbar' }, [
        U.el('div', { class: 'logo', html: U.icon('zap') }),
        U.el('h1', { text: 'Профиль' })
      ]));

      contentEl = U.el('div', {});
      view.appendChild(contentEl);
      draw();
      return view;
    }

    function draw() {
      contentEl.innerHTML = '';
      var me = Store.me();

      /* Шапка */
      var av = U.el('div', { class: 'avatar' });
      if (me.photo) av.appendChild(U.el('img', { src: me.photo }));
      else av.textContent = (me.name || '?').charAt(0).toUpperCase();

      var head = U.el('div', { class: 'profile-head' }, [
        av,
        U.el('div', { class: 'p-name', text: me.name }),
        U.el('div', { class: 'p-user', text: me.username ? '@' + me.username : '' }),
        U.el('div', { class: 'profile-stats' }, [
          stat('⭐ ' + me.rating.toFixed(1), me.ratingCount + ' отзыв(а)'),
          stat(me.completedCount, 'выполнено')
        ])
      ]);
      contentEl.appendChild(head);

      /* Роль */
      var roleCard = U.el('div', { class: 'card', style: { margin: '0 14px 10px' } }, [
        U.el('div', { class: 'section-h', style: { margin: '0 0 10px' }, text: 'Кем вы хотите быть' }),
        U.el('div', { class: 'role-grid' })
      ]);
      var roleGrid = roleCard.querySelector('.role-grid');
      ROLES.forEach(function (r) {
        roleGrid.appendChild(U.el('button', {
          class: 'btn ' + (me.role === r.key ? 'primary' : 'ghost') + ' btn-sm',
          text: r.label,
          onclick: function () {
            T.impact('light');
            me.role = r.key;
            Store.saveMe(me);
            draw();
          }
        }));
      });
      contentEl.appendChild(roleCard);

      /* Навыки */
      var skillsCard = U.el('div', { class: 'card', style: { margin: '0 14px 10px' } }, [
        U.el('div', { class: 'section-h', style: { margin: '0 0 10px' }, text: 'Навыки' }),
        U.el('div', { class: 'skill-tags' })
      ]);
      var tagsEl = skillsCard.querySelector('.skill-tags');
      SKILLS.forEach(function (s) {
        var active = me.skills.indexOf(s) !== -1;
        tagsEl.appendChild(U.el('button', {
          class: 'skill-tag' + (active ? ' active' : ''),
          text: s,
          onclick: function () {
            T.impact('light');
            var i = me.skills.indexOf(s);
            if (i !== -1) me.skills.splice(i, 1);
            else me.skills.push(s);
            Store.saveMe(me);
            draw();
          }
        }));
      });
      contentEl.appendChild(skillsCard);

      /* Уведомления в Telegram */
      var pushCard = U.el('div', { class: 'card', style: { margin: '0 14px 10px' } }, [
        U.el('div', { class: 'section-h', style: { margin: '0 0 10px' }, text: 'Уведомления в Telegram' }),
        U.el('div', { class: 'role-grid' }, [
          U.el('button', {
            class: 'btn ' + (me.tgNotify ? 'primary' : 'ghost') + ' btn-sm',
            text: 'Включены',
            onclick: function () {
              T.impact('light');
              me.tgNotify = true;
              Store.saveMe(me);
              draw();
            }
          }),
          U.el('button', {
            class: 'btn ' + (me.tgNotify ? 'ghost' : 'primary') + ' btn-sm',
            text: 'Выключены',
            onclick: function () {
              T.impact('light');
              me.tgNotify = false;
              Store.saveMe(me);
              draw();
            }
          })
        ]),
        U.el('div', { class: 'report-meta', style: { marginTop: '8px' }, text: 'Отклики, назначение и завершение приходят в личку от бота, даже когда приложение закрыто' })
      ]);
      contentEl.appendChild(pushCard);

      /* Модерация (админ) */
      if (me.isAdmin) {
        var admCard = U.el('div', { class: 'card', style: { margin: '0 14px 10px' } }, [
          U.el('div', { class: 'section-h', style: { margin: '0 0 10px' }, text: 'Модерация' }),
          U.el('div', { class: 'admin-actions' }, [
            U.el('button', { class: 'btn ghost btn-sm', onclick: function () { openAdminReports(); } }, [
              U.el('span', { text: 'Жалобы на заказы' })
            ]),
            U.el('button', { class: 'btn ghost btn-sm', onclick: function () { openAdminBlocked(); } }, [
              U.el('span', { text: 'Заблокированные' })
            ])
          ])
        ]);
        contentEl.appendChild(admCard);
      }

      /* Вкладки */
      var tabs = U.el('div', { class: 'tabs' }, [
        tabBtn('orders', 'Мои заказы'),
        tabBtn('responses', 'Мои отклики')
      ]);
      contentEl.appendChild(tabs);

      contentEl.appendChild(tabContent());
    }

    function openAdminReports() {
      Store.adminReports().then(function (reports) {
        var body = U.el('div', {});
        if (!reports.length) {
          body.appendChild(U.emptyState('check', 'Жалоб нет', 'Пока всё спокойно'));
        } else {
          reports.forEach(function (r) {
            body.appendChild(U.el('div', { class: 'card report-card' }, [
              U.el('div', { class: 'report-head' }, [
                U.el('span', { class: 'report-reason-badge', text: r.reason }),
                U.el('span', { class: 'report-status ' + r.status, text: r.status === 'resolved' ? 'решено' : 'новая' })
              ]),
              U.el('div', { class: 'report-order', text: r.orderTitle }),
              r.comment ? U.el('div', { class: 'report-comment', text: r.comment }) : null,
              U.el('div', { class: 'report-meta', text: U.timeAgo(r.created_at) + ' · от ' + r.reporterName }),
              r.status !== 'resolved' ? U.el('div', { class: 'action-bar', style: { marginTop: '10px' } }, [
                U.el('button', { class: 'btn ghost btn-sm', onclick: function () {
                  if (adminModal) adminModal.close();
                  P24.nav.order(r.orderId);
                } }, [U.el('span', { text: 'Открыть заказ' })]),
                U.el('button', { class: 'btn success btn-sm', onclick: function () { resolveReport(r.id); } }, [U.el('span', { text: 'Разрешить' })])
              ]) : null
            ]));
          });
        }
        adminModal = U.modal({
          title: 'Жалобы на заказы',
          sub: 'Администратор',
          body: body,
          buttons: [{ text: 'Закрыть', cls: 'ghost' }]
        });
      });
    }

    function resolveReport(id) {
      Store.resolveReport(id).then(function () {
        if (adminModal) adminModal.close();
        U.toast('Жалоба помечена решённой');
        openAdminReports();
      }).catch(function (err) { U.toast(err.message || 'Не удалось обновить жалобу'); });
    }

    function openAdminBlocked() {
      Store.blockedUsers().then(function (users) {
        var body = U.el('div', {});
        if (!users.length) {
          body.appendChild(U.emptyState('check', 'Заблокированных нет', 'После 3 жалоб аккаунт блокируется автоматически'));
        } else {
          users.forEach(function (u) {
            body.appendChild(U.el('div', { class: 'card report-card' }, [
              U.el('div', { class: 'report-head' }, [
                U.el('span', { class: 'report-reason-badge', text: 'Заблокирован' }),
                U.el('span', { class: 'report-status new', text: 'блок' })
              ]),
              U.el('div', { class: 'report-order', text: u.name }),
              u.username ? U.el('div', { class: 'report-meta', text: '@' + u.username }) : null,
              U.el('div', { class: 'action-bar', style: { marginTop: '10px' } }, [
                U.el('button', { class: 'btn success btn-sm', onclick: function () { unblockUser(u.id, u.name); } }, [U.el('span', { text: 'Восстановить' })])
              ])
            ]));
          });
        }
        adminModal = U.modal({
          title: 'Заблокированные',
          sub: 'Восстановление доступа',
          body: body,
          buttons: [{ text: 'Закрыть', cls: 'ghost' }]
        });
      });
    }

    function unblockUser(id, name) {
      Store.unblockUser(id).then(function () {
        if (adminModal) adminModal.close();
        U.toast('«' + name + '» восстановлен');
        openAdminBlocked();
      }).catch(function (err) { U.toast(err.message || 'Не удалось восстановить'); });
    }

    var adminModal = null;

    function stat(num, lbl) {
      return U.el('div', { class: 'stat' }, [
        U.el('div', { class: 'num', text: num }),
        U.el('div', { class: 'lbl', text: lbl })
      ]);
    }

    function tabBtn(key, label) {
      return U.el('button', {
        class: tab === key ? 'active' : '',
        text: label,
        onclick: function () {
          T.impact('light');
          tab = key;
          draw();
        }
      });
    }

    function tabContent() {
      if (tab === 'orders') return myOrders();
      return myResponses();
    }

    function myOrders() {
      var list = Store.myOrders().sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      var wrap = U.el('div', { class: 'list' });
      if (!list.length) {
        wrap.appendChild(U.emptyState('plus', 'Вы ещё не создавали заказы', 'Нажмите «Создать» и опубликуйте первый заказ'));
        return wrap;
      }
      list.forEach(function (o) {
        wrap.appendChild(U.el('button', { class: 'mini-order', onclick: function () { T.impact('light'); P24.nav.order(o.id, { back: 'profile' }); } }, [
          U.el('span', { class: 'badge ' + (o.status === 'done' ? 'ok' : o.status === 'in_progress' ? 'soft' : ''), text: o.status === 'done' ? '✓' : o.status === 'in_progress' ? 'Работа' : 'Открыт' }),
          U.el('div', { class: 't' }, [
            U.el('div', { class: 'ti', text: o.title }),
            U.el('div', { class: 'su', text: o.price.toLocaleString('ru-RU') + ' ₽ · ' + o.responses.length + ' откл. · ' + U.timeAgo(o.created_at) })
          ]),
          U.el('span', { class: 'icon-btn', style: { width: '30px', height: '30px' } }, [U.iconEl('back', 'back-chev')])
        ]));
      });
      return wrap;
    }

    function myResponses() {
      var list = Store.getMyResponses().slice().sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      var wrap = U.el('div', { class: 'list' });
      if (!list.length) {
        wrap.appendChild(U.emptyState('send', 'Вы пока не откликались', 'Открывайте заказы в ленте и жмите «Откликнуться»'));
        return wrap;
      }
      var map = { new: { t: 'Отправлен', c: '' }, accepted: { t: 'Принят', c: 'ok' }, rejected: { t: 'Отклонён', c: 'warn' }, done: { t: 'Выполнен', c: 'ok' } };
      list.forEach(function (r) {
        var st = map[r.status] || map.new;
        wrap.appendChild(U.el('button', { class: 'mini-order', onclick: function () { T.impact('light'); P24.nav.order(r.orderId, { back: 'profile' }); } }, [
          U.el('span', { class: 'badge ' + st.c, text: st.t }),
          U.el('div', { class: 't' }, [
            U.el('div', { class: 'ti', text: r.orderTitle }),
            U.el('div', { class: 'su', text: (r.type || '') + ' · ' + U.timeAgo(r.created_at) })
          ]),
          U.el('span', { class: 'icon-btn', style: { width: '30px', height: '30px' } }, [U.iconEl('back', 'back-chev')])
        ]));
      });
      return wrap;
    }

    function cleanup() { view = null; contentEl = null; }

    return { render: render, cleanup: cleanup };
  })();
})(window);