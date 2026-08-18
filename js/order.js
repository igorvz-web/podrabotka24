(function (global) {
  'use strict';

  var P24 = global.P24 = global.P24 || {};
  var U = global.U;
  var Store = global.Store;
  var T = global.T;

  P24.order = (function () {
    var view = null, contentEl = null;
    var order = null;

    function back() { P24.nav.goBack(); }

    function render(orderId) {
      order = Store.getOrder(orderId);
      if (!order) { P24.nav.feed(); return null; }

      view = U.el('div', { class: 'view no-nav anim' });
      var topbar = U.el('header', { class: 'topbar' }, [
        U.el('button', { class: 'icon-btn', onclick: function () { T.impact('light'); back(); } }, [U.iconEl('back')]),
        U.el('h1', { text: 'Заказ' }),
        U.el('button', { class: 'icon-btn', onclick: function () { T.impact('light'); share(); } }, [U.iconEl('share')])
      ]);
      view.appendChild(topbar);

      contentEl = U.el('div', { class: 'detail' });
      view.appendChild(contentEl);
      draw();

      /* Перезагружаем заказ с сервера — чтобы не оставаться с устаревшим
         статусом, если его изменил другой пользователь (завершил, назначил и т.п.). */
      var showId = order.id;
      Store.refreshOrder(showId).then(function (fresh) {
        if (fresh && order && order.id === showId) { order = fresh; draw(); }
      }).catch(function () {});
      return view;
    }

    function draw() {
      order = Store.getOrder(order.id);
      contentEl.innerHTML = '';
      contentEl.appendChild(detailCard());
      contentEl.appendChild(authorCard());

      if (isAuthor()) {
        contentEl.appendChild(responsesSection());
        contentEl.appendChild(reviewsSection('executor'));
      } else {
        contentEl.appendChild(actionSection());
        contentEl.appendChild(reviewsSection('author'));
      }
      contentEl.appendChild(moderationSection());
      contentEl.appendChild(promoSection());
      contentEl.appendChild(similarSection());
    }

    function isAuthor() { return order.authorId === Store.myId(); }

    function myResponse() {
      var me = Store.myId();
      for (var i = 0; i < order.responses.length; i++) if (order.responses[i].userId === me) return order.responses[i];
      return null;
    }

    function detailCard() {
      var badges = [U.el('span', { class: 'badge', text: order.type })];
      if (order.urgent) badges.push(U.el('span', { class: 'badge warn', text: 'Срочно' }));
      if (order.status !== 'open') {
        badges.push(U.el('span', { class: 'badge ' + (order.status === 'done' ? 'ok' : 'soft'), text: order.status === 'done' ? 'Завершён' : 'В работе' }));
      }

      var meta = [
        cell('Оплата', order.price.toLocaleString('ru-RU') + ' ₽', 'ruble'),
        cell('Человек', order.peopleCount + ' ' + U.plural(order.peopleCount, ['человек', 'человека', 'человек']), 'users'),
        cell('Город', order.city || '—', 'geo'),
        U.el('div', { class: 'meta-cell full' }, [
          U.el('div', { class: 'k', text: 'Адрес' }),
          U.el('div', { class: 'v' }, [U.iconEl('pin'), U.el('span', { text: order.address })])
        ]),
        U.el('div', { class: 'meta-cell full' }, [
          U.el('div', { class: 'k', text: 'Время работы' }),
          U.el('div', { class: 'v' }, [U.iconEl('clock'), U.el('span', { text: U.fmtDateTime(order.datetime) })])
        ])
      ];

      return U.el('div', { class: 'card' }, [
        U.el('div', { class: 'order-top' }, badges),
        U.el('div', { class: 'detail-title', text: order.title }),
        U.el('p', { class: 'detail-desc', text: order.description }),
        U.el('div', { class: 'meta-grid' }, meta),
        U.el('div', { class: 'responses-count', style: { marginTop: '12px' } }, [U.iconEl('users'), U.el('span', { text: 'Откликов: ' + order.responses.length })])
      ]);
    }

    function cell(k, v, ic) {
      return U.el('div', { class: 'meta-cell' }, [
        U.el('div', { class: 'k', text: k }),
        U.el('div', { class: 'v' }, [U.iconEl(ic), U.el('span', { text: v })])
      ]);
    }

    function authorCard() {
      var c = U.el('div', { class: 'card' }, [
        U.el('div', { class: 'section-h', text: 'Заказчик' })
      ]);
      var av = U.el('div', { class: 'avatar' });
      if (order.authorPhoto) av.appendChild(U.el('img', { src: order.authorPhoto }));
      else av.textContent = (order.authorName || '?').charAt(0).toUpperCase();

      var right;
      if (!isAuthor()) {
        right = U.el('a', {
          class: 'author-link',
          text: 'Написать',
          onclick: function (e) {
            e.preventDefault();
            T.impact('light');
            if (order.authorUsername) T.openTelegramLink('https://t.me/' + order.authorUsername);
            else U.toast('Недоступно в демо-режиме');
          }
        });
      } else {
        right = U.el('span', { class: 'author-link', text: 'Это вы' });
      }

      var body = U.el('div', { class: 'author-card' }, [
        av,
        U.el('div', {}, [
          U.el('div', { class: 'author-name', text: order.authorName }),
          U.el('div', { class: 'author-user', text: order.authorUsername ? '@' + order.authorUsername : '' })
        ]),
        right
      ]);
      c.appendChild(body);

      if (order.showPhone && order.phone) {
        c.appendChild(U.el('div', { class: 'action-bar' }, [
          U.el('a', { class: 'btn ghost btn-sm', href: 'tel:' + order.phone.replace(/[^+\d]/g, ''), onclick: function () { T.impact('light'); } }, [
            U.iconEl('phone'), U.el('span', { text: 'Позвонить' })
          ])
        ]));
      }
      return c;
    }

    /* ---- Отклики (я — заказчик) ---- */
    function responsesSection() {
      var wrap = U.el('div', {});
      wrap.appendChild(U.el('div', { class: 'section-h', text: 'Отклики (' + order.responses.length + ')' }));

      if (order.status === 'done') {
        wrap.appendChild(U.el('div', { class: 'card' }, [U.el('div', { class: 'detail-desc', text: 'Заказ завершён. Отклики закрыты.' })]));
        return wrap;
      }
      if (!order.responses.length) {
        wrap.appendChild(U.el('div', { class: 'card' }, [U.el('div', { class: 'detail-desc', text: 'Пока никто не откликнулся. Поделитесь заказом в Telegram.' })]));
        return wrap;
      }

      order.responses.slice().sort(function (a, b) { return b.created_at - a.created_at; }).forEach(function (r) {
        var av = U.el('div', { class: 'avatar' });
        if (r.photo) av.appendChild(U.el('img', { src: r.photo }));
        else av.textContent = (r.name || '?').charAt(0).toUpperCase();

        var card = U.el('div', { class: 'card response-card' }, [
          av,
          U.el('div', { class: 'response-main' }, [
            U.el('div', { class: 'response-head' }, [
              U.el('span', { class: 'name', text: r.name }),
              U.el('span', { html: U.starsHTML(r.rating) }),
              U.el('span', { class: 'rating-num', text: r.rating ? r.rating.toFixed(1) : '' })
            ]),
            r.skills && r.skills.length ? U.el('div', {}, r.skills.map(function (s) { return U.el('span', { class: 'skill-chip', text: s }); })) : null,
            r.message ? U.el('div', { class: 'resp-msg', text: r.message }) : null,
            statusBadge(r.status),
            r.status === 'new' ? U.el('div', { class: 'resp-actions' }, [
              U.el('button', { class: 'btn success btn-sm', onclick: function () { assign(r); } }, [U.iconEl('check'), U.el('span', { text: 'Назначить' })]),
              U.el('button', { class: 'btn danger btn-sm', onclick: function () { reject(r); } }, [U.el('span', { text: 'Отклонить' })])
            ]) : null
          ])
        ]);
        wrap.appendChild(card);
      });

      if (order.status === 'in_progress') {
        wrap.appendChild(U.el('div', { class: 'action-bar' }, [
          U.el('button', { class: 'btn success', onclick: function () { completeAsAuthor(); } }, [U.iconEl('check'), U.el('span', { text: 'Завершить заказ' })])
        ]));
      }
      return wrap;
    }

    function statusBadge(st) {
      var map = { new: null, accepted: 'Назначен', rejected: 'Отклонён' };
      if (!map[st]) return null;
      return U.el('div', { class: 'resp-msg', style: { fontWeight: '700', color: st === 'accepted' ? 'var(--success)' : 'var(--danger)' }, text: map[st] });
    }

    async function assign(r) {
      try {
        order = await Store.assignResponse(order.id, r.id);
        U.toast('Исполнитель назначен');
        T.notify('success');
      } catch (err) {
        U.toast(err.message || 'Не удалось назначить исполнителя');
        T.notify('error');
      }
      draw();
    }

    async function reject(r) {
      try {
        order = await Store.rejectResponse(order.id, r.id);
        U.toast('Отклик отклонён');
        T.impact('light');
      } catch (err) {
        U.toast(err.message || 'Не удалось отклонить отклик');
        T.notify('error');
      }
      draw();
    }

    /* ---- Отклик (я — исполнитель) ---- */
    function actionSection() {
      var wrap = U.el('div', {});
      var me = Store.me();
      var r = myResponse();

      if (order.status === 'done') {
        wrap.appendChild(U.el('div', { class: 'card' }, [U.el('div', { class: 'detail-desc', text: 'Этот заказ завершён.' })]));
        return wrap;
      }

      if (!r) {
        wrap.appendChild(U.el('div', { class: 'action-bar' }, [
          U.el('button', { class: 'btn primary', onclick: function () { openRespondModal(); } }, [U.iconEl('send'), U.el('span', { text: 'Откликнуться' })]),
          U.el('button', { class: 'btn ghost', onclick: function () { share(); } }, [U.iconEl('share'), U.el('span', { text: 'Поделиться' })])
        ]));
      } else {
        var statusLine;
        if (r.status === 'accepted') {
          statusLine = U.el('div', { class: 'card', style: { background: 'var(--success-bg)', borderColor: 'transparent' } }, [U.el('div', { class: 'detail-desc', text: '🎉 Заказчик назначил вас исполнителем!' })]);
        } else if (r.status === 'rejected') {
          statusLine = U.el('div', { class: 'card', style: { background: 'var(--danger-bg)', borderColor: 'transparent' } }, [U.el('div', { class: 'detail-desc', text: 'Заказчик отклонил ваш отклик.' })]);
        } else {
          statusLine = U.el('div', { class: 'card', style: { background: 'var(--bg-sec)' } }, [U.el('div', { class: 'detail-desc', text: '✓ Вы откликнулись. Заказчик получит уведомление.' })]);
        }
        wrap.appendChild(statusLine);
        if (order.status !== 'done' && r.status === 'new') {
          wrap.appendChild(U.el('div', { class: 'action-bar' }, [
            U.el('button', { class: 'btn ghost', onclick: function () { cancelResponse(); } }, [U.el('span', { text: 'Отменить отклик' })]),
            U.el('button', { class: 'btn ghost', onclick: function () { share(); } }, [U.iconEl('share'), U.el('span', { text: 'Поделиться' })])
          ]));
        }
      }

      if (order.status === 'in_progress' && r && r.status === 'accepted') {
        wrap.appendChild(U.el('div', { class: 'action-bar' }, [
          U.el('button', { class: 'btn success', onclick: function () { completeAsWorker(); } }, [U.iconEl('check'), U.el('span', { text: 'Заказ выполнен' })])
        ]));
      }

      return wrap;
    }

    function openRespondModal() {
      U.textPrompt({
        title: 'Откликнуться на заказ',
        sub: 'Сообщение заказчику (необязательно)',
        placeholder: 'Например: готов выйти, есть опыт…',
        okText: 'Отправить отклик',
        onOk: function (msg) { if (msg !== false) doRespond(msg); }
      });
    }

    async function doRespond(msg) {
      try {
        if (Store.me().blocked) { U.toast('Ваш аккаунт заблокирован модерацией'); T.notify('error'); return; }
        order = await Store.respond(order.id, msg || '');
        U.toast('Отклик отправлен');
        T.notify('success');
      } catch (err) {
        U.toast(err.message || 'Не удалось отправить отклик');
        T.notify('error');
      }
      draw();
    }

    async function cancelResponse() {
      try {
        order = await Store.cancelRespond(order.id);
        U.toast('Отклик отменён');
        T.impact('light');
      } catch (err) {
        U.toast(err.message || 'Не удалось отменить отклик');
        T.notify('error');
      }
      draw();
    }

    function completeError(err) {
      U.toast(err.message || 'Не удалось завершить заказ');
      T.notify('error');
      Store.refreshOrder(order.id).then(function (fresh) {
        if (fresh) { order = fresh; draw(); }
      }).catch(function () {});
    }

    async function completeAsAuthor() {
      try {
        order = await Store.completeOrder(order.id);
        U.toast('Заказ завершён');
        T.notify('success');
        draw();
        openReview();
      } catch (err) {
        completeError(err);
      }
    }

    async function completeAsWorker() {
      try {
        order = await Store.completeOrder(order.id);
        U.toast('Заказ выполнен!');
        T.notify('success');
        draw();
        openReview();
      } catch (err) {
        completeError(err);
      }
    }

    /* ---- Отзывы ---- */
    function reviewsSection(role) {
      var wrap = U.el('div', {});
      var reviews = order.reviews || [];
      var me = Store.myId();
      var reviewed = reviews.some(function (rv) { return rv.userId === me; });

      if (order.status === 'done') {
        wrap.appendChild(U.el('div', { class: 'section-h', text: 'Отзывы' }));
        if (!reviews.length) {
          wrap.appendChild(U.el('div', { class: 'card' }, [U.el('div', { class: 'detail-desc', text: 'Отзывов пока нет.' })]));
        }
        reviews.forEach(function (rv) {
          wrap.appendChild(U.el('div', { class: 'card review-card' }, [
            U.el('div', { class: 'review-head' }, [
              U.el('div', { class: 'avatar', style: { width: '30px', height: '30px', fontSize: '13px' }, text: (rv.name || '?').charAt(0).toUpperCase() }),
              U.el('div', {}, [
                U.el('div', { style: { fontSize: '13px', fontWeight: '700' }, text: rv.name }),
                U.el('div', { class: 'review-head' }, [U.el('span', { html: U.starsHTML(rv.rating) })])
              ])
            ]),
            rv.text ? U.el('div', { class: 'review-text', text: rv.text }) : null
          ]));
        });

        if (!reviewed) {
          var targetName = role === 'executor' ? acceptedUserName() : order.authorName;
          wrap.appendChild(U.el('div', { class: 'action-bar' }, [
            U.el('button', { class: 'btn primary', onclick: function () { openReview(); } }, [
              U.el('span', { text: 'Оценить ' + targetName })
            ])
          ]));
        }
      }
      return wrap;
    }

    function acceptedUserName() {
      for (var i = 0; i < order.responses.length; i++) {
        if (order.responses[i].status === 'accepted') return order.responses[i].name;
      }
      return 'исполнителя';
    }

    function openReview() {
      var chosen = 5;
      var text = '';
      var picker = U.el('div', { class: 'rate-picker' });
      var btns = [];
      for (var i = 1; i <= 5; i++) {
        (function (n) {
          btns.push(U.el('button', { text: '★', onclick: function () { chosen = n; btns.forEach(function (b, k) { b.classList.toggle('on', k < n); }); } }));
        })(i);
      }
      btns.forEach(function (b, k) { if (k < chosen) b.classList.add('on'); picker.appendChild(b); });
      var ta = U.el('textarea', { class: 'textarea', placeholder: 'Ваш отзыв…', rows: 3 });
      ta.addEventListener('input', function () { text = ta.value; });

      U.modal({
        title: 'Оценить исполнителя',
        sub: 'Как прошла работа?',
        body: U.el('div', {}, [picker, ta]),
        buttons: [
          { text: 'Отправить', cls: 'primary', onClick: function () {
            Store.addReview(order.id, chosen, text.trim()).then(function (saved) {
              if (saved) order = saved;
              U.toast('Спасибо за отзыв!');
              T.notify('success');
              draw();
            }).catch(function (err) { U.toast(err.message || 'Не удалось отправить отзыв'); });
          } }
        ]
      });
    }

    /* ---- Жалоба и удаление ---- */
    function moderationSection() {
      var wrap = U.el('div', {});
      var me = Store.me();
      var isAuthor = order.authorId === me.id;
      var isAdmin = me.isAdmin;

      if (!isAuthor) {
        wrap.appendChild(U.el('div', { class: 'action-bar', style: { marginTop: '14px' } }, [
          U.el('button', { class: 'btn ghost', onclick: function () { openReportModal(); } }, [
            U.iconEl('flag'), U.el('span', { text: 'Пожаловаться' })
          ])
        ]));
      }

      var canDelete = (isAuthor && order.status === 'open') || isAdmin;
      if (canDelete) {
        wrap.appendChild(U.el('div', { class: 'action-bar', style: { marginTop: '10px' } }, [
          U.el('button', { class: 'btn danger', onclick: function () { confirmDelete(); } }, [
            U.iconEl('trash'), U.el('span', { text: (isAdmin && !isAuthor) ? 'Удалить заказ (админ)' : 'Удалить заказ' })
          ])
        ]));
      }
      return wrap;
    }

    /* ---- Продвижение заказа (Telegram Stars) ---- */
    function promoSection() {
      var wrap = U.el('div', {});
      var me = Store.me();
      if (order.authorId !== me.id || order.status !== 'open') return wrap;
      var boosted = order.boostedUntil && order.boostedUntil > Date.now();
      wrap.appendChild(U.el('div', { class: 'card', style: { margin: '0 14px 10px' } }, [
        U.el('div', { class: 'section-h', style: { margin: '0 0 8px' }, text: 'Продвижение' }),
        boosted
          ? U.el('div', { class: 'detail-desc', text: '🚀 Заказ поднят в ленте на 24 часа' })
          : U.el('div', { class: 'action-bar' }, [
            U.el('button', { class: 'btn primary', onclick: function () { boost(); } }, [U.iconEl('zap'), U.el('span', { text: 'Поднять заказ' })])
          ])
      ]));
      return wrap;
    }

    function boost() {
      Store.boostOrder(order.id).then(function (res) {
        if (!T.openInvoice(res.url, function (status) {
          if (status === 'paid') {
            U.toast('Заказ поднят в ленте на 24 часа!');
            T.notify('success');
            Store.refreshOrder(order.id).then(function (fresh) {
              if (fresh) { order = fresh; draw(); }
            }).catch(function () {});
          } else {
            U.toast('Оплата не прошла');
          }
        })) {
          U.toast('Продвижение доступно только в Telegram');
        }
      }).catch(function (err) { U.toast(err.message || 'Не удалось создать инвойс'); });
    }

    var REPORT_REASONS = ['Мошенничество', 'Спам', 'Оскорбления', 'Недостоверная информация', 'Другое'];

    function openReportModal() {
      var chosen = REPORT_REASONS[0];
      var body = U.el('div', {});
      REPORT_REASONS.forEach(function (r) {
        body.appendChild(U.el('button', {
          class: 'report-reason' + (r === chosen ? ' active' : ''),
          text: r,
          onclick: function () {
            chosen = r;
            body.querySelectorAll('.report-reason').forEach(function (b) { b.classList.toggle('active', b.textContent === r); });
          }
        }));
      });
      var ta = U.el('textarea', { class: 'textarea', placeholder: 'Комментарий (необязательно)', rows: 3 });
      body.appendChild(ta);
      U.modal({
        title: 'Пожаловаться на заказ',
        sub: 'Администратор рассмотрит жалобу',
        body: body,
        buttons: [
          { text: 'Отправить жалобу', cls: 'primary', onClick: function () {
            Store.reportOrder(order.id, chosen, ta.value.trim()).then(function () {
              U.toast('Жалоба отправлена. Спасибо!');
              T.notify('success');
            }).catch(function (err) { U.toast(err.message || 'Не удалось отправить жалобу'); });
          } },
          { text: 'Отмена', cls: 'ghost' }
        ]
      });
    }

    function confirmDelete() {
      U.confirmBox('Удалить заказ «' + order.title + '»? Действие необратимо.', {
        title: 'Удаление заказа',
        okText: 'Удалить',
        danger: true,
        onOk: function () {
          Store.deleteOrder(order.id).then(function () {
            U.toast('Заказ удалён');
            T.notify('success');
            P24.nav.feed();
          }).catch(function (err) { U.toast(err.message || 'Не удалось удалить заказ'); });
        }
      });
    }

    /* ---- Похожие заказы ---- */
    function similarSection() {
      var wrap = U.el('div', {});
      var sim = Store.getOrders().filter(function (o) {
        return o.id !== order.id && o.type === order.type && o.status === 'open';
      }).sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); }).slice(0, 3);

      if (!sim.length) return wrap;
      wrap.appendChild(U.el('div', { class: 'section-h', text: 'Похожие заказы' }));
      sim.forEach(function (o) {
        wrap.appendChild(U.el('button', { class: 'card order-card', onclick: function () { T.impact('light'); P24.nav.order(o.id); } }, [
          U.el('div', { class: 'order-top' }, [U.el('span', { class: 'badge', text: o.type })]),
          U.el('div', { class: 'order-title', text: o.title }),
          U.el('div', { class: 'order-foot' }, [
            U.el('div', { class: 'price', html: U.esc(o.price.toLocaleString('ru-RU')) + ' <span class="cur">₽</span>' }),
            U.el('span', { class: 'responses-count' }, [U.iconEl('users'), U.el('span', { text: o.responses.length })])
          ])
        ]));
      });
      return wrap;
    }

    /* ---- Поделиться ---- */
    function share() {
      var text = '💰 ' + order.price.toLocaleString('ru-RU') + ' ₽ — ' + order.title + '\n📍 ' + order.address + '\n🕐 ' + U.fmtDateTime(order.datetime) + '\n\n⚡ Подработка 24';
      var url = 'https://t.me/' + T.botName + '?startapp=' + order.id;
      var full = text + '\n' + url;

      function copyIt() {
        if (T.tg && T.tg.setClipboardText) {
          try { T.tg.setClipboardText(full); } catch (e) {}
        } else {
          U.copyText(full);
        }
        U.toast('Ссылка скопирована — вставьте в чат');
        T.impact('medium');
      }

      /* iOS в вебвью Telegram: системная шторка «кому отправить», приложение живо.
         Android WebView: Web Share API недоступен — копируем в буфер (окно выбора
         чата Telegram на Android закрывает вебвью, поэтому его не используем). */
      if (navigator.share) {
        navigator.share({ title: order.title, text: text, url: url }).catch(function () { copyIt(); });
      } else {
        copyIt();
      }
    }

    function cleanup() { view = null; contentEl = null; order = null; }

    return { render: render, cleanup: cleanup };
  })();
})(window);