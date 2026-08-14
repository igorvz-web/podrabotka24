(function (global) {
  'use strict';

  var P24 = global.P24 = global.P24 || {};
  var U = global.U;
  var Store = global.Store;
  var T = global.T;

  P24.create = (function () {
    var view = null, formEl = null;
    var f = {};   // поля формы
    var people = 1;

    var CITIES = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Нижний Новгород', 'Ростов-на-Дону', 'Самара', 'Уфа', 'Красноярск'];

    function defaultCity() {
      var c = null;
      try { c = localStorage.getItem('p24_city'); } catch (e) {}
      return (c && c !== 'Все города') ? c : 'Москва';
    }

    function defaultDateTime() {
      var d = new Date(Date.now() + 3 * 3600000);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function render() {
      view = U.el('div', { class: 'view anim' });
      view.appendChild(U.el('header', { class: 'topbar' }, [
        U.el('div', { class: 'logo', html: U.icon('zap') }),
        U.el('h1', { text: 'Создать заказ' })
      ]));

      formEl = U.el('div', { class: 'form' });
      view.appendChild(formEl);

      field('type', 'select', 'Тип работы *', ['Водитель', 'Грузчики', 'Разнорабочие', 'Переезды', 'Уборка', 'Другое']);
      field('city', 'city', 'Город *');
      field('title', 'input', 'Заголовок *', null, 'Например: разгрузка фуры, переезд квартиры');
      field('desc', 'textarea', 'Описание', null, 'Подробности: объём работ, что нужно привезти, особенности…');
      field('address', 'address', 'Адрес *', null, 'Город, улица, дом');
      field('price', 'number', 'Оплата (₽) *', null, 'Сумма в рублях, без пробелов');
      field('datetime', 'datetime', 'Дата и время *');
      field('people', 'people', 'Сколько человек нужно');
      field('urgent', 'urgent', null);
      field('phone', 'input', 'Номер телефона (по желанию)', null, 'Покажем кнопку «Позвонить»');

      formEl.appendChild(U.el('button', {
        class: 'btn primary',
        style: T.isTg ? { display: 'none' } : { margin: '6px 0 20px' },
        onclick: publish
      }, [U.iconEl('send'), U.el('span', { text: 'Опубликовать заказ' })]));

      if (T.isTg) {
        T.setMainButton({ text: 'Опубликовать', visible: true, enabled: isValid(), onClick: publish });
      }
      onInput();
      return view;
    }

    function field(key, kind, label, options, ph) {
      var wrap = U.el('div', { class: 'field' });
      if (label) wrap.appendChild(U.el('label', { text: label }));
      var input = null;

      if (kind === 'select') {
        input = U.el('select', { class: 'control' });
        options.forEach(function (o) { input.appendChild(U.el('option', { value: o, text: o })); });
        input.addEventListener('change', onInput);
      } else if (kind === 'city') {
        var sel = U.el('select', { class: 'control' });
        CITIES.forEach(function (c) { sel.appendChild(U.el('option', { value: c, text: c })); });
        sel.appendChild(U.el('option', { value: '__custom', text: 'Свой город…' }));
        var custom = U.el('input', { class: 'control', type: 'text', placeholder: 'Название города', autocomplete: 'off', style: { display: 'none', marginTop: '8px' } });
        sel.value = defaultCity();
        if (CITIES.indexOf(sel.value) === -1) sel.value = '__custom';
        if (sel.value === '__custom') { custom.style.display = ''; custom.value = defaultCity(); }
        sel.addEventListener('change', function () {
          var customMode = sel.value === '__custom';
          custom.style.display = customMode ? '' : 'none';
          if (customMode) custom.focus();
          onInput();
        });
        custom.addEventListener('input', onInput);
        input = U.el('div', {}, [sel, custom]);
        f.citySel = sel;
        f.cityCustom = custom;
      } else if (kind === 'textarea') {
        input = U.el('textarea', { class: 'control', placeholder: ph || '', rows: 3 });
        input.addEventListener('input', onInput);
      } else if (kind === 'people') {
        var valEl = U.el('div', { class: 'val', text: people });
        var minus = U.el('button', { text: '−', onclick: function () { if (people > 1) { people--; valEl.textContent = people; } } });
        var plus = U.el('button', { text: '+', onclick: function () { if (people < 10) { people++; valEl.textContent = people; } } });
        input = U.el('div', { class: 'stepper' }, [minus, valEl, plus]);
      } else if (kind === 'urgent') {
        var cb = U.el('input', { type: 'checkbox' });
        cb.addEventListener('change', onInput);
        input = U.el('div', { class: 'checkbox-row' }, [
          cb,
          U.el('div', { class: 'txt' }, [
            U.el('div', { text: 'Срочно' }),
            U.el('div', { class: 'sub', text: 'Пометить заказ меткой «Срочно»' })
          ])
        ]);
        f.urgentCb = cb;
      } else if (kind === 'address') {
        var txt = U.el('input', { class: 'control', placeholder: ph || '', autocomplete: 'off' });
        txt.addEventListener('input', onInput);
        var geoBtn = U.el('button', {
          class: 'geo-btn',
          type: 'button',
          onclick: function () { geolocate(txt, geoBtn); }
        }, [U.iconEl('geo'), U.el('span', { text: 'Моё местоположение' })]);
        input = U.el('div', { class: 'input-row' }, [txt, geoBtn]);
        f.addressInput = txt;
      } else if (kind === 'datetime') {
        input = U.el('input', { class: 'control', type: 'datetime-local', value: defaultDateTime() });
        input.addEventListener('input', onInput);
      } else if (kind === 'number') {
        input = U.el('input', { class: 'control', type: 'number', inputmode: 'numeric', min: '0', placeholder: ph || '' });
        input.addEventListener('input', onInput);
      } else {
        input = U.el('input', { class: 'control', type: 'text', placeholder: ph || '', autocomplete: 'off' });
        input.addEventListener('input', onInput);
      }

      f[key] = input;
      wrap.appendChild(input);
      formEl.appendChild(wrap);
      return wrap;
    }

    function geolocate(txt, btn) {
      if (!navigator.geolocation) { U.toast('Геолокация недоступна'); return; }
      btn.disabled = true;
      btn.querySelector('span').textContent = 'Определяем…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lon = pos.coords.longitude;
        var done = function (addr) {
          txt.value = addr;
          btn.disabled = false;
          btn.querySelector('span').textContent = 'Моё местоположение';
          onInput();
          T.notify('success');
        };
        fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lon + '&accept-language=ru')
          .then(function (r) { return r.json(); })
          .then(function (j) { done((j && j.display_name) || lat.toFixed(5) + ', ' + lon.toFixed(5)); })
          .catch(function () { done(lat.toFixed(5) + ', ' + lon.toFixed(5)); });
      }, function () {
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Моё местоположение';
        txt.value = '55.7558, 37.6173';
        U.toast('Геолокация отключена — подставлены координаты');
        onInput();
      }, { timeout: 8000 });
    }

    function onInput() {
      if (T.isTg) T.setMainButton({ enabled: isValid() });
      if (formEl) {
        var btn = formEl.querySelector('.btn.primary');
        if (btn) btn.disabled = !isValid();
      }
    }

    function isValid() { return validate().ok; }

    function validate() {
      var title = ((f.title && f.title.value) || '').trim();
      var price = parseFloat(((f.price && f.price.value) || '').replace(',', '.'));
      var address = ((f.addressInput && f.addressInput.value) || '').trim();
      var dt = f.datetime && f.datetime.value;
      var city = (f.citySel && f.citySel.value === '__custom')
        ? ((f.cityCustom && f.cityCustom.value) || '').trim()
        : ((f.citySel && f.citySel.value) || '').trim();

      if (title.length < 5) return { ok: false, msg: 'Заголовок должен быть не короче 5 символов' };
      if (!city) return { ok: false, msg: 'Укажите город' };
      if (!(price > 0)) return { ok: false, msg: 'Укажите оплату больше 0 ₽' };
      if (!address) return { ok: false, msg: 'Укажите адрес' };
      if (!dt) return { ok: false, msg: 'Укажите дату и время' };
      if (new Date(dt).getTime() < Date.now() - 60000) return { ok: false, msg: 'Время не может быть в прошлом' };
      return { ok: true };
    }

    async function publish() {
      if (Store.me().blocked) { U.toast('Ваш аккаунт заблокирован модерацией'); T.notify('error'); return; }
      var v = validate();
      if (!v.ok) { U.toast(v.msg); T.notify('error'); return; }

      var phone = (f.phone && f.phone.value || '').trim();
      var city = f.citySel.value === '__custom'
        ? f.cityCustom.value.trim()
        : f.citySel.value;
      var order = {
        id: Store.uid(),
        type: f.type.value,
        title: f.title.value.trim(),
        description: (f.desc.value || '').trim(),
        address: f.addressInput.value.trim(),
        city: city,
        price: Math.round(parseFloat(f.price.value.replace(',', '.'))),
        peopleCount: people,
        urgent: f.urgentCb.checked,
        datetime: f.datetime.value,
        showPhone: !!phone,
        phone: phone,
        authorId: Store.myId(),
        created_at: Date.now(),
        status: 'open',
        responses: [],
        reviews: []
      };
      try {
        await Store.addOrder(order);
        Store.pushNotif('Заказ опубликован: «' + order.title + '»');
        U.toast('Заказ опубликован');
        T.notify('success');
        resetForm();
        P24.nav.feed();
      } catch (err) {
        U.toast(err.message || 'Не удалось опубликовать заказ');
        T.notify('error');
      }
    }

    function resetForm() {
      people = 1;
      if (f.title) f.title.value = '';
      if (f.desc) f.desc.value = '';
      if (f.price) f.price.value = '';
      if (f.addressInput) f.addressInput.value = '';
      if (f.datetime) f.datetime.value = defaultDateTime();
      if (f.urgentCb) f.urgentCb.checked = false;
      if (f.phone) f.phone.value = '';
    }

    function cleanup() {
      T.hideMainButton();
      view = null; formEl = null; f = {}; people = 1;
    }

    return { render: render, cleanup: cleanup };
  })();
})(window);