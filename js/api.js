(function (global) {
  'use strict';

  /* Клиент REST API. В проде приложение и API живут на одном домене (FastAPI отдаёт статику).
     base можно переопределить через window.API_URL (например, при раздельном хостинге). */
  var API = {
    base: (typeof global.API_URL === 'string' && global.API_URL) ? String(global.API_URL).replace(/\/+$/, '') : '',
    token: null,
    initData: '',

    call: function (method, path, body) {
      var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
      if (this.token) opts.headers.Authorization = 'Bearer ' + this.token;
      if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
      return global.fetch(this.base + path, opts).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var err = new Error((data && data.detail) || ('Ошибка сервера: ' + res.status));
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
    },

    auth: function () {
      this.initData = (global.T && global.T.initData) ? global.T.initData : '';
      return this.call('POST', '/api/auth', { initData: this.initData }).then(function (res) {
        API.token = res.token;
        return res;
      });
    }
  };

  global.API = API;
})(window);