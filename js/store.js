(function (global) {
  'use strict';

  /* Хранилище:
     - онлайн: REST API (FastAPI + SQLite), данные в кэше памяти;
     - офлайн-фолбэк: localStorage (демо без сервера).
     Все методы сохраняют прежнюю сигнатуру, мутации возвращают Promise. */
  var API = global.API;
  var P = 'p24_';
  var KEYS = {
    orders: P + 'orders',
    user: P + 'user',
    myResponses: P + 'myResponses',
    notifs: P + 'notifs',
    reports: P + 'reports',
    blocked: P + 'blocked'
  };

  var mem = {}; // кэш в памяти для офлайн-режима (переживает недоступный localStorage)

  var Store = {
    online: false,
    user: null,         // мой профиль (онлайн)
    orders: [],         // кэш заказов (онлайн)
    myResponses: [],    // мои отклики (онлайн)
    notifs: []          // уведомления (онлайн)
  };

  /* ---- Низкоуровневый офлайн-storage ---- */
  Store.load = function (key, def) {
    if (key in mem) return mem[key];
    try { var v = localStorage.getItem(key); if (v) { mem[key] = JSON.parse(v); return mem[key]; } } catch (e) {}
    return def;
  };
  Store.save = function (key, val) {
    mem[key] = val;
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  };
  Store.uid = function () { return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  /* ---- Бутстрап ---- */
  Store.boot = function () {
    try {
      if (!global.fetch) throw new Error('fetch недоступен — офлайн-режим');
      return API.auth().then(function (res) {
        Store.user = res.user;
        return Store.refreshAll();
      }).then(function () {
        Store.online = true;
        return Store;
      });
    } catch (e) {
      return Promise.reject(e);
    }
  };

  Store.bootLocal = function () {
    Store.online = false;
    Store.user = null;
    Store.orders = [];
    Store.myResponses = [];
    Store.notifs = [];
    Store.me(); // гарантируем создание локального профиля
    return Store;
  };

  Store.refreshAll = function () {
    return Promise.all([
      API.call('GET', '/api/me'),
      API.call('GET', '/api/orders')
    ]).then(function (r) {
      Store.user = r[0].user;
      Store.myResponses = r[0].myResponses || [];
      Store.notifs = r[0].notifications || [];
      _noteNotifs(Store.notifs);
      Store.orders = (r[1] || []).slice().sort(byTime);
      return Store;
    });
  };

  Store.refreshOrders = function () {
    if (!Store.online) return Promise.resolve(Store.orders);
    return API.call('GET', '/api/orders').then(function (list) {
      Store.orders = (list || []).slice().sort(byTime);
      return Store.orders;
    });
  };

  Store.refreshOrder = function (orderId) {
    if (!Store.online) return Promise.resolve(Store.getOrder(orderId));
    return API.call('GET', '/api/orders/' + encodeURIComponent(orderId)).then(function (o) {
      Store.upsertOrder(o);
      return o;
    });
  };

  function byTime(a, b) { return (b.created_at || 0) - (a.created_at || 0); }

  Store.upsertOrder = function (o) {
    if (!o) return;
    var found = false;
    for (var i = 0; i < Store.orders.length; i++) {
      if (Store.orders[i].id === o.id) { Store.orders[i] = o; found = true; break; }
    }
    if (!found) Store.orders.unshift(o);
    Store.orders.sort(byTime);
  };

  Store.applyUpdate = function (res) {
    if (res.order) Store.upsertOrder(res.order);
    if (res.myResponses) Store.myResponses = res.myResponses;
    if (res.notifications) {
      Store.notifs = res.notifications;
      _noteNotifs(res.notifications);
      emitNotifs();
    }
  };

  /* ---- Живые обновления (поллинг) ---- */
  var _lastNotifTime = 0;
  function _noteNotifs(arr) {
    if (!arr || !arr.length) return;
    var m = 0;
    arr.forEach(function (n) { if (n.time && n.time > m) m = n.time; });
    if (m > _lastNotifTime) _lastNotifTime = m;
  }
  function emitNotifs() {
    try { document.dispatchEvent(new Event('p24:notifs')); } catch (e) {}
  }

  /* Проверяет новые события на сервере; возвращает свежие непрочитанные уведомления. */
  Store.checkUpdates = function () {
    if (!Store.online) return Promise.resolve([]);
    return API.call('GET', '/api/me').then(function (r) {
      var prev = Store.notifs || [];
      var prevTimes = {};
      prev.forEach(function (n) { prevTimes[n.time] = true; });
      Store.user = r.user;
      Store.myResponses = r.myResponses || [];
      Store.notifs = r.notifications || [];
      _noteNotifs(Store.notifs);
      var fresh = Store.notifs.filter(function (n) { return !n.read && !prevTimes[n.time]; });
      if (fresh.length || prev.length !== Store.notifs.length) emitNotifs();
      return Store.refreshOrders().then(function () { return fresh; });
    }).catch(function () { return []; });
  };

  /* ---- Мой профиль ---- */
  Store.me = function () {
    if (Store.online) return Store.user;
    var u = Store.load(KEYS.user, null);
    if (!u) {
      var t = global.T.user || {};
      u = {
        id: t.id || 999001,
        name: [t.first_name, t.last_name].filter(Boolean).join(' ') || 'Гость',
        username: t.username || 'guest',
        photo: t.photo_url || '',
        phone: '',
        role: 'both',                    // worker | customer | both
        skills: ['разнорабочий'],
        rating: 4.8,
        ratingCount: 23,
        completedCount: 7,
        isAdmin: true                    // демо: можно тестировать модерацию
      };
      Store.save(KEYS.user, u);
    }
    u.blocked = Store._isBlocked(u.id);
    return u;
  };

  Store._isBlocked = function (id) {
    return Store.load(KEYS.blocked, []).some(function (b) { return b.id === id; });
  };
  Store.saveMe = function (u) {
    if (Store.online) {
      Store.user = u;
      API.call('PATCH', '/api/me', { role: u.role, skills: u.skills || [], phone: u.phone || '', name: u.name })
        .then(function (res) { if (res && res.user) Store.user = res.user; })
        .catch(function () {});
      return;
    }
    Store.save(KEYS.user, u);
  };
  Store.myId = function () { return Store.me().id; };

  /* ---- Заказы (чтение) ---- */
  Store.getOrders = function () {
    if (Store.online) return Store.orders;
    var arr = Store.load(KEYS.orders, null);
    if (!arr) { arr = seedOrders(); Store.save(KEYS.orders, arr); }
    return arr;
  };
  Store.getOrder = function (id) {
    var arr = Store.getOrders();
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  };
  Store.myOrders = function () {
    var id = Store.myId();
    return Store.getOrders().filter(function (o) { return o.authorId === id; });
  };
  /* Совместимость с офлайн-флоу; онлайн-мутации идут через отдельные методы */
  Store.updateOrder = function (order) {
    if (Store.online) { Store.upsertOrder(order); return order; }
    var arr = Store.getOrders();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === order.id) { arr[i] = order; break; }
    }
    Store.saveOrders(arr);
    return order;
  };
  Store.saveOrders = function (arr) { Store.save(KEYS.orders, arr); };

  /* ---- Мои отклики (офлайн-вспомогательное) ---- */
  Store.getMyResponses = function () {
    if (Store.online) return Store.myResponses;
    return Store.load(KEYS.myResponses, []);
  };
  Store.saveMyResponses = function (arr) { Store.save(KEYS.myResponses, arr); };
  Store.addMyResponse = function (r) {
    var arr = Store.getMyResponses();
    arr.unshift(r);
    Store.saveMyResponses(arr);
  };
  Store.removeMyResponse = function (orderId) {
    Store.saveMyResponses(Store.getMyResponses().filter(function (r) { return r.orderId !== orderId; }));
  };
  Store.setMyResponseStatus = function (orderId, status) {
    var arr = Store.getMyResponses();
    arr.forEach(function (r) { if (r.orderId === orderId) r.status = status; });
    Store.saveMyResponses(arr);
  };

  /* ---- Уведомления ---- */
  Store.getNotifs = function () {
    if (Store.online) return Store.notifs;
    return Store.load(KEYS.notifs, []);
  };
  Store.pushNotif = function (text) {
    if (Store.online) return; // онлайн: уведомления создаёт сервер
    var arr = Store.getNotifs();
    arr.unshift({ id: Store.uid(), text: text, time: Date.now(), read: false });
    if (arr.length > 50) arr.length = 50;
    Store.save(KEYS.notifs, arr);
  };
  Store.markNotifsRead = function () {
    var arr = Store.getNotifs();
    arr.forEach(function (n) { n.read = true; });
    if (Store.online) {
      API.call('POST', '/api/notifications/read', {})
        .then(function (res) {
          if (res && res.notifications) { Store.notifs = res.notifications; _noteNotifs(res.notifications); }
          emitNotifs();
        })
        .catch(function () {});
    } else {
      Store.save(KEYS.notifs, arr);
      emitNotifs();
    }
  };
  Store.unreadCount = function () {
    return Store.getNotifs().filter(function (n) { return !n.read; }).length;
  };

  /* ---- Мутации (онлайн: API; офлайн: localStorage) ---- */
  Store.addOrder = function (payload) {
    if (Store.online) {
      return API.call('POST', '/api/orders', payload).then(function (res) {
        Store.applyUpdate(res);
        return res.order;
      });
    }
    var o = payload;
    var arr = Store.getOrders();
    arr.unshift(o);
    Store.saveOrders(arr);
    return Promise.resolve(o);
  };

  Store.respond = function (orderId, message) {
    if (Store.online) {
      return API.call('POST', '/api/orders/' + encodeURIComponent(orderId) + '/respond', { message: message || '' })
        .then(function (res) { Store.applyUpdate(res); return res.order; });
    }
    var me = Store.me();
    var order = Store.getOrder(orderId);
    var r = {
      id: Store.uid(),
      userId: me.id,
      name: me.name,
      username: me.username,
      photo: me.photo,
      rating: me.rating,
      skills: (me.skills || []).slice(),
      message: message || '',
      status: 'new',
      created_at: Date.now()
    };
    order.responses.push(r);
    Store.updateOrder(order);
    Store.addMyResponse({ orderId: order.id, orderTitle: order.title, type: order.type, status: 'new', created_at: Date.now() });
    Store.pushNotif('Ваш отклик отправлен на «' + order.title + '»');
    return Promise.resolve(order);
  };

  Store.cancelRespond = function (orderId) {
    if (Store.online) {
      return API.call('POST', '/api/orders/' + encodeURIComponent(orderId) + '/cancel_respond', {})
        .then(function (res) { Store.applyUpdate(res); return res.order; });
    }
    var me = Store.myId();
    var order = Store.getOrder(orderId);
    order.responses = order.responses.filter(function (x) { return x.userId !== me; });
    Store.updateOrder(order);
    Store.removeMyResponse(orderId);
    return Promise.resolve(order);
  };

  Store.assignResponse = function (orderId, responseId) {
    if (Store.online) {
      return API.call('POST', '/api/orders/' + encodeURIComponent(orderId) + '/assign', { responseId: responseId })
        .then(function (res) { Store.applyUpdate(res); return res.order; });
    }
    var order = Store.getOrder(orderId);
    order.responses.forEach(function (x) { if (x.id === responseId) x.status = 'accepted'; });
    order.status = 'in_progress';
    Store.updateOrder(order);
    var r = order.responses.filter(function (x) { return x.id === responseId; })[0];
    Store.pushNotif('Исполнитель назначен: ' + (r ? r.name : '') + ' на заказ «' + order.title + '»');
    return Promise.resolve(order);
  };

  Store.rejectResponse = function (orderId, responseId) {
    if (Store.online) {
      return API.call('POST', '/api/orders/' + encodeURIComponent(orderId) + '/reject', { responseId: responseId })
        .then(function (res) { Store.applyUpdate(res); return res.order; });
    }
    var order = Store.getOrder(orderId);
    order.responses.forEach(function (x) { if (x.id === responseId) x.status = 'rejected'; });
    Store.updateOrder(order);
    return Promise.resolve(order);
  };

  Store.completeOrder = function (orderId) {
    if (Store.online) {
      return API.call('POST', '/api/orders/' + encodeURIComponent(orderId) + '/complete', {})
        .then(function (res) { Store.applyUpdate(res); return res.order; });
    }
    var order = Store.getOrder(orderId);
    order.status = 'done';
    Store.updateOrder(order);
    var me = Store.myId();
    var mine = order.responses.filter(function (x) { return x.userId === me; })[0];
    if (mine) Store.setMyResponseStatus(order.id, 'done');
    return Promise.resolve(order);
  };

  Store.addReview = function (orderId, rating, text) {
    if (Store.online) {
      return API.call('POST', '/api/orders/' + encodeURIComponent(orderId) + '/review', { rating: rating, text: text || '' })
        .then(function (res) { Store.applyUpdate(res); return res.order; });
    }
    var order = Store.getOrder(orderId);
    var me = Store.me();
    order.reviews = order.reviews || [];
    order.reviews.push({ userId: me.id, name: me.name, rating: rating, text: text || '', time: Date.now() });
    Store.updateOrder(order);
    return Promise.resolve(order);
  };

  /* ---- Жалобы и модерация ---- */
  Store.isAdmin = function () { return !!Store.me().isAdmin; };

  Store.reportOrder = function (orderId, reason, comment) {
    if (Store.online) {
      return API.call('POST', '/api/orders/' + encodeURIComponent(orderId) + '/report', { reason: reason, comment: comment || '' });
    }
    var arr = Store.load(KEYS.reports, []);
    arr.unshift({ id: Store.uid(), orderId: orderId, reason: reason, comment: comment || '', status: 'new', created_at: Date.now() });
    Store.save(KEYS.reports, arr);
    Store._autoBlockAuthor(orderId);
    return Promise.resolve({ ok: true });
  };

  Store._autoBlockAuthor = function (orderId) {
    var order = Store.getOrder(orderId);
    if (!order || Store._isBlocked(order.authorId)) return;
    var count = 0;
    var reports = Store.load(KEYS.reports, []);
    Store.getOrders().forEach(function (o) {
      if (o.authorId !== order.authorId) return;
      reports.forEach(function (r) { if (r.orderId === o.id && r.status === 'new') count++; });
    });
    if (count >= 3) {
      var blocked = Store.load(KEYS.blocked, []);
      if (!blocked.some(function (b) { return b.id === order.authorId; })) {
        blocked.push({ id: order.authorId, name: order.authorName || 'Пользователь', blockedAt: Date.now() });
        Store.save(KEYS.blocked, blocked);
      }
    }
  };

  Store.deleteOrder = function (orderId) {
    if (Store.online) {
      return API.call('DELETE', '/api/orders/' + encodeURIComponent(orderId)).then(function () {
        Store.orders = Store.orders.filter(function (o) { return o.id !== orderId; });
        Store.myResponses = Store.myResponses.filter(function (r) { return r.orderId !== orderId; });
        return true;
      });
    }
    Store.saveOrders(Store.getOrders().filter(function (o) { return o.id !== orderId; }));
    Store.removeMyResponse(orderId);
    return Promise.resolve(true);
  };

  Store.adminReports = function () {
    if (Store.online) {
      return API.call('GET', '/api/admin/reports').catch(function () { return []; });
    }
    return Promise.resolve(Store.load(KEYS.reports, []));
  };

  Store.resolveReport = function (reportId) {
    if (Store.online) {
      return API.call('POST', '/api/admin/reports/' + encodeURIComponent(reportId) + '/resolve', {})
        .then(function () { return true; });
    }
    var arr = Store.load(KEYS.reports, []);
    arr.forEach(function (r) { if (r.id === reportId) r.status = 'resolved'; });
    Store.save(KEYS.reports, arr);
    return Promise.resolve(true);
  };

  Store.blockedUsers = function () {
    if (Store.online) {
      return API.call('GET', '/api/admin/users/blocked').catch(function () { return []; });
    }
    return Promise.resolve(Store.load(KEYS.blocked, []));
  };

  Store.unblockUser = function (userId) {
    if (Store.online) {
      return API.call('POST', '/api/admin/users/' + encodeURIComponent(userId) + '/unblock', {})
        .then(function () { return true; });
    }
    var arr = Store.load(KEYS.blocked, []).filter(function (b) { return b.id !== userId; });
    Store.save(KEYS.blocked, arr);
    return Promise.resolve(true);
  };

  /* ---- Сид-данные (офлайн) ---- */
  function seedOrders() {
    var now = Date.now();
    var MIN = 60000;
    var auth = [
      { id: 101, name: 'СтройЛогистика', username: 'stroy_log', photo: '' },
      { id: 102, name: 'Анна', username: 'anna_move', photo: '' },
      { id: 103, name: 'Офис-Менеджер', username: 'office_mng', photo: '' },
      { id: 104, name: 'Пётр', username: 'petr_build', photo: '' },
      { id: 105, name: 'МебельПро', username: 'furniture_pro', photo: '' },
      { id: 106, name: 'Сергей', username: 'sergey_office', photo: '' },
      { id: 107, name: 'Ирина', username: 'irina_clean', photo: '' },
      { id: 108, name: 'Мария', username: 'maria_ikea', photo: '' },
      { id: 109, name: 'Дмитрий', username: 'dmitry_home', photo: '' },
      { id: 110, name: 'Владимир', username: 'vlad_dacha', photo: '' },
      { id: 111, name: 'Ольга', username: 'olga_win', photo: '' },
      { id: 112, name: 'Алексей', username: 'alex_move', photo: '' },
      { id: 113, name: 'Магазин «Вкусно»', username: 'shop_tasty', photo: '' }
    ];
    function A(i) { return auth[i - 1]; }

    var resp1 = [
      { id: 'r11', userId: 9001, name: 'Дмитрий К.', username: 'dmitry_k', photo: '', rating: 4.9, skills: ['грузчик', 'разнорабочий'], message: 'Готов выйти, есть опыт работы на складе.', status: 'new', created_at: now - 32 * MIN },
      { id: 'r12', userId: 9002, name: 'Артём', username: 'artem', photo: '', rating: 4.5, skills: ['грузчик'], message: 'Смогу приехать к указанному времени.', status: 'new', created_at: now - 20 * MIN },
      { id: 'r13', userId: 9003, name: 'Сергей В.', username: 'sergey_v', photo: '', rating: 5.0, skills: ['грузчик', 'такелаж'], message: 'Есть своя тележка и опыт такелажа.', status: 'new', created_at: now - 9 * MIN }
    ];
    var resp2 = [
      { id: 'r21', userId: 9004, name: 'Николай', username: 'nick_t', photo: '', rating: 4.7, skills: ['переезды', 'водитель'], message: 'Занимаюсь переездами 3 года, есть фургон.', status: 'new', created_at: now - 15 * MIN }
    ];

    function O(no, type, title, desc, address, price, people, urgent, minutesAgo, iso, authorIdx, showPhone, phone, status, responses, reviews) {
      var a = A(authorIdx);
      return {
        id: 'o_' + no,
        type: type,
        title: title,
        description: desc,
        address: address,
        price: price,
        peopleCount: people,
        urgent: !!urgent,
        showPhone: !!showPhone,
        phone: showPhone ? phone : '',
        datetime: iso,
        authorId: a.id,
        authorName: a.name,
        authorUsername: a.username,
        authorPhoto: a.photo,
        created_at: now - minutesAgo * MIN,
        status: status || 'open',
        responses: responses || [],
        reviews: reviews || []
      };
    }

    var base = 'Москва';
    var d = function (dayOffset, h, m) {
      var x = new Date(now + dayOffset * 86400000);
      x.setHours(h, m, 0, 0);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + 'T' + p(h) + ':' + p(m);
    };

    var today = 0, tomorrow = 1;

    return [
      O(1, 'Грузчики', 'Разгрузка фуры со стройматериалами', 'Нужно разгрузить 20-тонную фуру с мешками цемента и поддонами. Срочно, работа на 3–4 часа. Оплата по факту, работа оплачивается на месте.',
        base + ', ул. Складочная, 3, склад №5', 3000, 4, true, 12, d(today, 14, 0), 1, true, '+7 901 234-56-78', 'open', resp1),
      O(2, 'Переезды', 'Квартирный переезд, 2-комн.', 'Квартирный переезд с 5 этажа (лифт есть). Вещи: диван, шкаф, коробки. Нужен грузовой лифт — на месте.', base + ', пр-т Мира, 12, кв. 45', 6000, 2, false, 45, d(tomorrow, 9, 0), 2, false, '', 'open', resp2),
      O(3, 'Уборка', 'Генеральная уборка офиса 120 м²', 'Генеральная уборка офиса после ремонта: полы, окна, кухня. Инвентарь и химия наши.', base + ', Бизнес-центр «Атлант», офис 301', 4500, 2, false, 110, d(today, 18, 0), 3, false, '', 'open'),
      O(4, 'Разнорабочие', 'Подсобные работы на стройке', 'Подсобные работы: поднос материалов, уборка территории, помощь бригаде. Работа ежедневная по 8 часов, оплата ежедневно.', base + ', ул. Строителей, 7, корп. 2', 2500, 3, false, 150, d(today, 8, 0), 4, true, '+7 912 345-67-89', 'open'),
      O(5, 'Грузчики', 'Погрузка мебели на склад', 'Нужно погрузить мебель из квартиры в грузовик и выгрузить на складе. Объём — 1 машина.', base + ', ул. Садовая, 3, подъезд 1', 2000, 2, true, 210, d(today, 11, 0), 5, false, '', 'open'),
      O(6, 'Переезды', 'Офисный переезд, 30 рабочих мест', 'Переезд офиса из бизнес-центра в бизнес-центр. Столы, кресла, шкафы, техника в коробках. Два грузовика.', base + ', от «Москва-Сити» до «Сокол»', 15000, 4, false, 320, d(tomorrow, 10, 0), 6, true, '+7 923 456-78-90', 'open'),
      O(7, 'Уборка', 'Уборка после ремонта квартиры', 'Уборка после косметического ремонта: побелка, пыль, полы. Квартира 60 м².', base + ', ул. Ленина, 21, кв. 7', 4000, 1, false, 480, d(today, 16, 0), 7, false, '', 'open'),
      O(8, 'Разнорабочие', 'Сборка мебели (ИКЕА)', 'Собрать шкаф, комод и кухонный гарнитур. Инструкции есть, нужен набор отверток.', base + ', ул. Космонавтов, 15, кв. 88', 3000, 1, false, 640, d(today, 13, 0), 8, false, '', 'open'),
      O(9, 'Грузчики', 'Такелаж холодильника и стиральной машины', 'Нужно поднять холодильник и стиральную машину на 4 этаж без лифта и поставить на место.', base + ', ул. Чехова, 5, кв. 12', 1500, 1, true, 800, d(today, 15, 0), 9, true, '+7 934 567-89-01', 'open'),
      O(10, 'Другое', 'Помощь в выносе хлама с дачи', 'Помочь вынести старую мебель и хлам из дома на участок, погрузить в прицеп.', base + ', СНТ «Берёзка», уч. 32', 2000, 2, false, 1500, d(tomorrow, 12, 0), 10, false, '', 'open'),
      O(11, 'Уборка', 'Мойка окон в квартире', 'Помыть окна в 3-комнатной квартире, 8 окон + балкон.', base + ', ул. Пушкина, 8, кв. 3', 2500, 1, false, 2100, d(today, 17, 0), 11, false, '', 'open'),
      O(12, 'Переезды', 'Перевозка + грузчики, 1 грузовик', 'Переезд из хрущёвки в новостройку. Грузчик нужен на погрузку и выгрузку.', base + ', от ул. Первомайская, 14 до ул. Новая, 1', 8000, 3, false, 3000, d(2, 8, 0), 12, true, '+7 945 678-90-12', 'open'),
      O(13, 'Уборка', 'Мытьё витрин магазина', 'Помыть витрины и стеклянные двери магазина, 30 м² стекла. Вода есть.', base + ', ТЦ «Рио», 1 этаж', 3500, 1, false, 5000, d(-1, 10, 0), 13, false, '', 'done', [],
        [
          { userId: 113, name: 'Магазин «Вкусно»', rating: 4, text: 'Работали аккуратно, немного задержались.', time: now - 4400 * MIN },
          { userId: 9101, name: 'Олег', rating: 5, text: 'Заказчик приятный, всё оплатил вовремя.', time: now - 4300 * MIN }
        ])
    ];
  }

  global.Store = Store;
})(window);