import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import auth
from . import db
from . import seed

WEB_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

db.init_db()
seed.seed()

app = FastAPI(title='Подработка 24 API', version='1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


def now_ms():
    return int(time.time() * 1000)


def notify(user_id, text, push=False, order_id=None):
    db.execute('INSERT INTO notifications (user_id, text, time, read) VALUES (?,?,?,0)',
               (user_id, text, now_ms()))
    if push:
        tg_push(user_id, text, order_id)


def tg_push(user_id, text, order_id=None):
    """Личное сообщение пользователю через Bot API (если задан BOT_TOKEN и включены push)."""
    if not auth.BOT_TOKEN:
        return
    u = db.query('SELECT tg_id, tg_notify FROM users WHERE id=?', (user_id,), one=True)
    if not u or not u.get('tg_id') or not u.get('tg_notify', 1):
        return
    payload = {'chat_id': u['tg_id'], 'text': text}
    if order_id and auth.BASE_URL:
        app_url = auth.BASE_URL.rstrip('/') + '/?startapp=' + order_id
        payload['reply_markup'] = json.dumps({
            'inline_keyboard': [[{'text': 'Открыть заказ', 'web_app': {'url': app_url}}]]
        })
    try:
        req = urllib.request.Request(
            'https://api.telegram.org/bot{}/sendMessage'.format(auth.BOT_TOKEN),
            data=urllib.parse.urlencode(payload).encode(),
            headers={'Content-Type': 'application/x-www-form-urlencoded'})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


def post_to_channel(text, order_id=None, buttons=None):
    """Публикует заказ в группу-витрину (GROUP_ID). Возвращает message_id или None."""
    if not auth.BOT_TOKEN:
        return None
    group = os.environ.get('GROUP_ID', '').strip() or '@podrabotka_365'
    payload = {'chat_id': group, 'text': text}
    if buttons is None:
        buttons = []
        if order_id and auth.BASE_URL:
            app_url = auth.BASE_URL.rstrip('/') + '/?startapp=' + order_id
            # web_app-кнопки в группах и каналах Telegram запрещает (только личные чаты),
            # поэтому обычная url-кнопка: открывает приложение во встроенном браузере с SDK
            buttons = [[{'text': 'Открыть заказ', 'url': app_url}]]
    if buttons:
        payload['reply_markup'] = json.dumps({'inline_keyboard': buttons})
    try:
        req = urllib.request.Request(
            'https://api.telegram.org/bot{}/sendMessage'.format(auth.BOT_TOKEN),
            data=urllib.parse.urlencode(payload).encode(),
            headers={'Content-Type': 'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(req, timeout=5) as r:
            resp = json.loads(r.read().decode('utf-8'))
        if not resp.get('ok'):
            _notify_admin_fail('Канал-витрина: ' + str(resp.get('description', 'ошибка')))
            return None
        return (resp.get('result') or {}).get('message_id')
    except Exception as e:
        _notify_admin_fail('Канал-витрина: ' + str(e)[:200])
        return None


def _notify_admin_fail(text):
    try:
        admins = auth.ADMIN_TG_IDS
    except Exception:
        admins = []
    if not admins or not auth.BOT_TOKEN:
        return
    print('CHANNEL_ERR: ' + text, flush=True)
    try:
        u = db.query('SELECT id FROM users WHERE tg_id=?', (admins[0],), one=True)
        if u:
            notify(u['id'], '⚠️ ' + text)
    except Exception:
        pass
    try:
        payload = {'chat_id': admins[0], 'text': text}
        req = urllib.request.Request(
            'https://api.telegram.org/bot{}/sendMessage'.format(auth.BOT_TOKEN),
            data=urllib.parse.urlencode(payload).encode(),
            headers={'Content-Type': 'application/x-www-form-urlencoded'})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Требуется авторизация')
    uid = auth.user_from_token(authorization[len('Bearer '):])
    if not uid:
        raise HTTPException(401, 'Неверный токен сессии')
    return uid


def _ensure_admin(uid):
    u = db.query('SELECT * FROM users WHERE id=?', (uid,), one=True)
    if not u or not u.get('is_admin'):
        raise HTTPException(403, 'Требуются права администратора')


@app.get('/api/bot/info')
def bot_info():
    """Имя пользователя бота — для корректных ссылок «Поделиться». Без авторизации."""
    return {'username': auth.get_bot_username() or None}


def _compute_admin(tg_id):
    admins = {x.strip() for x in os.environ.get('ADMIN_TG_IDS', '').split(',') if x.strip()}
    if not auth.BOT_TOKEN and tg_id == '999001':
        return True  # демо-режим: демо-пользователь является админом
    return tg_id in admins


def _admin_tg_ids():
    return [x.strip() for x in os.environ.get('ADMIN_TG_IDS', '').split(',') if x.strip()]


def _block_threshold():
    try:
        return max(1, int(os.environ.get('BLOCK_THRESHOLD', '3')))
    except Exception:
        return 3


def send_admin_notif(text):
    """Отправка сообщения администраторам через Bot API (если задан BOT_TOKEN)."""
    if not auth.BOT_TOKEN:
        return
    for chat_id in _admin_tg_ids():
        try:
            url = 'https://api.telegram.org/bot{}/sendMessage'.format(auth.BOT_TOKEN)
            data = urllib.parse.urlencode({'chat_id': chat_id, 'text': text}).encode()
            urllib.request.urlopen(urllib.request.Request(url, data=data), timeout=5)
        except Exception:
            pass


# --------------------------------------------------------------------------
# Serialization
# --------------------------------------------------------------------------

def compute_stats(user_id):
    rows = db.query('SELECT rating FROM reviews WHERE target_id=?', (user_id,))
    if rows:
        avg = round(sum(r['rating'] for r in rows) / len(rows), 1)
        cnt = len(rows)
    else:
        avg, cnt = 0.0, 0
    done = db.query('SELECT COUNT(*) AS c FROM responses WHERE user_id=? AND status=?',
                    (user_id, 'done'))[0]['c']
    return avg, cnt, done


def user_payload(u):
    skills = json.loads(u.get('skills') or '[]')
    rating, rating_count, completed = compute_stats(u['id'])
    try:
        ref = db.query('SELECT COUNT(*) AS c FROM users WHERE referred_by=?', (u['id'],), one=True) or {}
    except Exception:
        ref = {}
    return {
        'id': u['id'],
        'name': u['name'],
        'username': u.get('username', '') or '',
        'photo': u.get('photo', '') or '',
        'phone': u.get('phone', '') or '',
        'role': u.get('role', 'both') or 'both',
        'skills': skills,
        'rating': rating,
        'ratingCount': rating_count,
        'completedCount': completed,
        'isAdmin': bool(u.get('is_admin')),
        'blocked': bool(u.get('blocked')),
        'tgNotify': bool(u.get('tg_notify', 1)),
        'referrals': int(ref.get('c', 0) or 0),
    }


def response_payload(r):
    ex = db.query('SELECT * FROM users WHERE id=?', (r['user_id'],), one=True) or {}
    rating = compute_stats(r['user_id'])[0]
    return {
        'id': r['id'],
        'userId': r['user_id'],
        'name': ex.get('name', ''),
        'username': ex.get('username', '') or '',
        'photo': ex.get('photo', '') or '',
        'rating': rating,
        'skills': json.loads(ex.get('skills') or '[]'),
        'message': r.get('message', '') or '',
        'status': r['status'],
        'created_at': r['created_at'],
    }


def order_payload(o):
    author = db.query('SELECT * FROM users WHERE id=?', (o['author_id'],), one=True) or {}
    responses = [response_payload(r) for r in db.query(
        'SELECT * FROM responses WHERE order_id=? ORDER BY created_at DESC', (o['id'],))]
    reviews = [{
        'userId': rv['user_id'],
        'name': rv['name'],
        'rating': rv['rating'],
        'text': rv['text'],
        'time': rv['time'],
    } for rv in db.query('SELECT * FROM reviews WHERE order_id=? ORDER BY time ASC', (o['id'],))]
    return {
        'id': o['id'],
        'type': o['type'],
        'title': o['title'],
        'description': o.get('description', '') or '',
        'address': o['address'],
        'price': o['price'],
        'peopleCount': o['people_count'],
        'urgent': bool(o['urgent']),
        'showPhone': bool(o['show_phone']),
        'phone': o['phone'] if o['show_phone'] else '',
        'datetime': o['datetime'],
        'authorId': o['author_id'],
        'authorName': author.get('name', ''),
        'authorUsername': author.get('username', '') or '',
        'authorPhoto': author.get('photo', '') or '',
        'created_at': o['created_at'],
        'status': o['status'],
        'boostedUntil': o.get('boosted_until') or 0,
        'city': o.get('city') or '',
        'responses': responses,
        'reviews': reviews,
    }


def my_responses(user_id):
    rows = db.query(
        'SELECT r.*, o.title AS order_title, o.type AS order_type FROM responses r '
        'JOIN orders o ON o.id = r.order_id WHERE r.user_id=? ORDER BY r.created_at DESC',
        (user_id,))
    return [{
        'orderId': r['order_id'],
        'orderTitle': r['order_title'],
        'type': r['order_type'],
        'status': r['status'],
        'created_at': r['created_at'],
    } for r in rows]


def my_notifications(user_id):
    rows = db.query('SELECT * FROM notifications WHERE user_id=? ORDER BY time DESC LIMIT 50', (user_id,))
    return [{'id': n['id'], 'text': n['text'], 'time': n['time'], 'read': bool(n['read'])} for n in rows]


def mutation_result(order_id, user_id):
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    return {
        'order': order_payload(o),
        'myResponses': my_responses(user_id),
        'notifications': my_notifications(user_id),
    }


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------

@app.post('/api/auth')
def api_auth(body: dict = None):
    body = body or {}
    init_data = str(body.get('initData', '') or '')
    user = auth.verify_init_data(init_data)

    if user:
        tg_id = user['tg_id']
    elif auth.BOT_TOKEN and init_data:
        raise HTTPException(401, 'Неверная подпись initData')
    else:
        # демо-вход (нет токена бота или приложение открыто вне Telegram)
        tg_id = '999001'
        user = {'tg_id': '999001', 'name': 'Иван Петров', 'username': 'demo_user', 'photo': ''}

    is_admin = 1 if _compute_admin(tg_id) else 0
    row = db.query('SELECT * FROM users WHERE tg_id=?', (tg_id,), one=True)
    if not row:
        new_id = db.execute(
            'INSERT INTO users (tg_id, name, username, photo, role, skills, is_admin, created_at, last_login) VALUES (?,?,?,?,?,?,?,?,?)',
            (tg_id, user['name'], user['username'], user['photo'], 'both', '["разнорабочий"]', is_admin,
             now_ms(), now_ms()))
        row = db.query('SELECT * FROM users WHERE id=?', (new_id,), one=True)
    else:
        db.execute('UPDATE users SET name=?, username=?, photo=?, last_login=?, is_admin=? WHERE id=?',
                   (user['name'], user['username'], user['photo'], now_ms(), is_admin, row['id']))
        row = db.query('SELECT * FROM users WHERE id=?', (row['id'],), one=True)

    token = auth.create_token(row['id'])
    return {'token': token, 'user': user_payload(row)}


@app.get('/api/health')
def health():
    # Лёгкий запрос к БД, чтобы внешний пингер держал активными и Render, и базу (Neon)
    db_ok = False
    try:
        db.query('SELECT 1')
        db_ok = True
    except Exception:
        db_ok = False
    return {'ok': True, 'db': db_ok, 'time': now_ms()}


# --------------------------------------------------------------------------
# Me / profile
# --------------------------------------------------------------------------

def _me(uid):
    u = db.query('SELECT * FROM users WHERE id=?', (uid,), one=True)
    if not u:
        raise HTTPException(401, 'Пользователь не найден')
    return u


@app.get('/api/me')
def get_me(uid: int = Depends(get_current_user)):
    u = _me(uid)
    my_orders = [order_payload(o) for o in db.query(
        'SELECT * FROM orders WHERE author_id=? ORDER BY created_at DESC', (uid,))]
    return {
        'user': user_payload(u),
        'myOrders': my_orders,
        'myResponses': my_responses(uid),
        'notifications': my_notifications(uid),
    }


@app.patch('/api/me')
def patch_me(body: dict = None, uid: int = Depends(get_current_user)):
    u = _me(uid)
    body = body or {}
    role = body.get('role', u['role'])
    skills = body.get('skills')
    phone = body.get('phone')
    name = body.get('name')
    tg_notify = body.get('tgNotify')

    new_skills = json.dumps(skills, ensure_ascii=False) if skills is not None else u['skills']
    db.execute('UPDATE users SET role=?, skills=?, phone=?, name=?, tg_notify=? WHERE id=?',
               (role, new_skills, phone if phone is not None else u['phone'],
                name if name else u['name'],
                1 if tg_notify else 0 if tg_notify is not None else u['tg_notify'], uid))
    u = _me(uid)
    return {'user': user_payload(u)}


# --------------------------------------------------------------------------
# Реферальная программа
# --------------------------------------------------------------------------

@app.post('/api/referral')
def post_referral(body: dict = None, uid: int = Depends(get_current_user)):
    body = body or {}
    try:
        ref = int(body.get('ref', 0) or 0)
    except Exception:
        ref = 0
    if ref <= 0 or ref == uid:
        return {'ok': True}
    u = _me(uid)
    if u.get('referred_by'):
        return {'ok': True}
    referrer = db.query('SELECT * FROM users WHERE id=?', (ref,), one=True)
    if not referrer:
        return {'ok': True}
    db.execute('UPDATE users SET referred_by=? WHERE id=?', (ref, uid))
    notify(ref, '🎉 По вашей ссылке присоединился ' + (u['name'] or 'новый пользователь'), push=True)
    return {'ok': True}


# --------------------------------------------------------------------------
# Подписки на новые заказы
# --------------------------------------------------------------------------

@app.get('/api/subscriptions')
def list_subscriptions(uid: int = Depends(get_current_user)):
    rows = db.query('SELECT * FROM subscriptions WHERE user_id=? ORDER BY id ASC', (uid,))
    return [{'id': s['id'], 'city': s.get('city') or '', 'type': s.get('type') or ''} for s in rows]


@app.post('/api/subscriptions')
def add_subscription(body: dict = None, uid: int = Depends(get_current_user)):
    body = body or {}
    city = str(body.get('city', '') or '').strip()
    otype = str(body.get('type', '') or '').strip()
    dup = db.query('SELECT id FROM subscriptions WHERE user_id=? AND city=? AND type=?', (uid, city, otype), one=True)
    if not dup:
        db.execute('INSERT INTO subscriptions (user_id, city, type, created_at) VALUES (?,?,?,?)',
                   (uid, city, otype, now_ms()))
    return list_subscriptions(uid)


@app.delete('/api/subscriptions/{sub_id}')
def delete_subscription(sub_id: int, uid: int = Depends(get_current_user)):
    db.execute('DELETE FROM subscriptions WHERE id=? AND user_id=?', (sub_id, uid))
    return list_subscriptions(uid)


def notify_subscribers(order):
    """Шлёт уведомления подписчикам (город/тип совпали с подпиской)."""
    city = (order.get('city') or '') or ''
    otype = (order.get('type') or '') or ''
    rows = db.query("SELECT user_id FROM subscriptions WHERE (city='' OR city=?) AND (type='' OR type=?)", (city, otype))
    where = ' в ' + city if city else ''
    price = str(order.get('price') or 0)
    if not price or price == '0':
        price = 'договорная'
    else:
        price = price + ' ₽'
    for s in rows:
        suid = s['user_id']
        if suid == order['author_id']:
            continue
        notify(suid, '🔔 Новый заказ' + where + ': «' + order['title'] + '» · ' + price, push=True, order_id=order['id'])


# --------------------------------------------------------------------------
# Orders
# --------------------------------------------------------------------------

@app.get('/api/orders')
def list_orders(uid: int = Depends(get_current_user)):
    rows = db.query('SELECT * FROM orders ORDER BY created_at DESC')
    return [order_payload(o) for o in rows]


@app.get('/api/orders/{order_id}')
def get_order(order_id: str, uid: int = Depends(get_current_user)):
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    return order_payload(o)


@app.post('/api/orders')
def create_order(body: dict = None, uid: int = Depends(get_current_user)):
    u = _me(uid)
    if u.get('blocked'):
        raise HTTPException(403, 'Ваш аккаунт заблокирован модерацией')
    body = body or {}
    required = ['type', 'title', 'address', 'price', 'datetime']
    for field in required:
        if not body.get(field):
            raise HTTPException(400, 'Не заполнено поле: ' + field)

    order_id = 'o_' + uuid.uuid4().hex[:8]
    db.execute(
        'INSERT INTO orders (id, type, title, description, address, price, people_count, urgent, show_phone, phone, datetime, author_id, created_at, status, city) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (order_id, str(body['type']), str(body['title']).strip(), str(body.get('description', '') or '').strip(),
         str(body['address']).strip(), int(body['price']), int(body.get('peopleCount', 1)),
         1 if body.get('urgent') else 0, 1 if body.get('showPhone') else 0,
         str(body.get('phone', '') or ''), str(body['datetime']), uid, now_ms(), 'open',
         str(body.get('city', '') or '').strip()))
    notify(uid, 'Заказ опубликован: «' + str(body['title']).strip() + '»')
    city = str(body.get('city', '') or '').strip()
    post_to_channel('🆕 Новый заказ\n\n«' + str(body['title']).strip() + '»\n📦 ' + str(body['type']) +
                    '\n🏙 ' + (city or '—') + '\n💰 ' + str(body['price']) + ' ₽\n🕐 ' +
                    str(body['datetime']).replace('T', ' '), order_id)
    try:
        notify_subscribers({'id': order_id, 'author_id': uid, 'title': str(body['title']).strip(),
                            'city': city, 'type': str(body['type']), 'price': str(body['price'])})
    except Exception:
        pass
    return mutation_result(order_id, uid)


@app.post('/api/orders/{order_id}/respond')
def respond(order_id: str, body: dict = None, uid: int = Depends(get_current_user)):
    u = _me(uid)
    if u.get('blocked'):
        raise HTTPException(403, 'Ваш аккаунт заблокирован модерацией')
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    if o['status'] != 'open':
        raise HTTPException(400, 'Заказ уже не принимает отклики')
    dup = db.query('SELECT id FROM responses WHERE order_id=? AND user_id=?', (order_id, uid), one=True)
    if dup:
        raise HTTPException(400, 'Вы уже откликнулись на этот заказ')

    body = body or {}
    r_id = 'r' + uuid.uuid4().hex[:8]
    db.execute('INSERT INTO responses (id, order_id, user_id, message, status, created_at) VALUES (?,?,?,?,?,?)',
               (r_id, order_id, uid, str(body.get('message', '') or ''), 'new', now_ms()))
    notify(uid, 'Ваш отклик отправлен на «' + o['title'] + '»')
    notify(o['author_id'], 'Новый отклик от ' + u['name'] + ' на «' + o['title'] + '»',
           push=True, order_id=order_id)
    return mutation_result(order_id, uid)


@app.post('/api/orders/{order_id}/cancel_respond')
def cancel_respond(order_id: str, uid: int = Depends(get_current_user)):
    r = db.query('SELECT * FROM responses WHERE order_id=? AND user_id=?', (order_id, uid), one=True)
    if r and r['status'] == 'new':
        db.execute('DELETE FROM responses WHERE id=?', (r['id'],))
    return mutation_result(order_id, uid)


def _ensure_author(o, uid):
    if o['author_id'] != uid:
        raise HTTPException(403, 'Действие доступно только заказчику')


@app.post('/api/orders/{order_id}/assign')
def assign(order_id: str, body: dict = None, uid: int = Depends(get_current_user)):
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    _ensure_author(o, uid)
    body = body or {}
    r_id = body.get('responseId')
    r = db.query('SELECT * FROM responses WHERE id=? AND order_id=?', (r_id, order_id), one=True)
    if not r:
        raise HTTPException(404, 'Отклик не найден')
    db.execute('UPDATE responses SET status=? WHERE id=?', ('accepted', r_id))
    db.execute("UPDATE orders SET status=?, accepted_response_id=? WHERE id=?",
               ('in_progress', r_id, order_id))
    ex = db.query('SELECT * FROM users WHERE id=?', (r['user_id'],), one=True) or {}
    notify(r['user_id'], 'Вы назначены исполнителем на «' + o['title'] + '»',
           push=True, order_id=order_id)
    return mutation_result(order_id, uid)


@app.post('/api/orders/{order_id}/reject')
def reject(order_id: str, body: dict = None, uid: int = Depends(get_current_user)):
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    _ensure_author(o, uid)
    body = body or {}
    r_id = body.get('responseId')
    r = db.query('SELECT * FROM responses WHERE id=? AND order_id=?', (r_id, order_id), one=True)
    if not r:
        raise HTTPException(404, 'Отклик не найден')
    db.execute('UPDATE responses SET status=? WHERE id=?', ('rejected', r_id))
    notify(r['user_id'], 'Ваш отклик на «' + o['title'] + '» отклонён',
           push=True, order_id=order_id)
    return mutation_result(order_id, uid)


@app.post('/api/orders/{order_id}/complete')
def complete(order_id: str, uid: int = Depends(get_current_user)):
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    if o['status'] != 'in_progress':
        raise HTTPException(400, 'Заказ нельзя завершить в текущем статусе')
    accepted = None
    if o['accepted_response_id']:
        accepted = db.query('SELECT * FROM responses WHERE id=? AND order_id=?',
                            (o['accepted_response_id'], order_id), one=True)
    if o['author_id'] != uid and not (accepted and accepted['user_id'] == uid):
        raise HTTPException(403, 'Завершить заказ может только заказчик или назначенный исполнитель')
    db.execute('UPDATE orders SET status=? WHERE id=?', ('done', order_id))
    if accepted:
        db.execute('UPDATE responses SET status=? WHERE id=?', ('done', accepted['id']))
        other = o['author_id'] if accepted['user_id'] == uid else accepted['user_id']
        notify(other, 'Заказ «' + o['title'] + '» завершён', push=True, order_id=order_id)
    return mutation_result(order_id, uid)


@app.post('/api/orders/{order_id}/review')
def review(order_id: str, body: dict = None, uid: int = Depends(get_current_user)):
    u = _me(uid)
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    if o['status'] != 'done':
        raise HTTPException(400, 'Оценить можно только завершённый заказ')
    body = body or {}
    rating = int(body.get('rating', 0))
    if rating < 1 or rating > 5:
        raise HTTPException(400, 'Оценка должна быть от 1 до 5')

    accepted = None
    if o['accepted_response_id']:
        accepted = db.query('SELECT * FROM responses WHERE id=? AND order_id=?',
                            (o['accepted_response_id'], order_id), one=True)
    if o['author_id'] == uid:
        target = accepted['user_id'] if accepted else None
    elif accepted and accepted['user_id'] == uid:
        target = o['author_id']
    else:
        raise HTTPException(403, 'Вы не можете оценить этот заказ')

    dup = db.query('SELECT id FROM reviews WHERE order_id=? AND user_id=?', (order_id, uid), one=True)
    if dup:
        raise HTTPException(400, 'Вы уже оставили отзыв на этот заказ')

    text = str(body.get('text', '') or '').strip()
    db.execute('INSERT INTO reviews (order_id, user_id, target_id, name, rating, text, time) VALUES (?,?,?,?,?,?,?)',
               (order_id, uid, target, u['name'], rating, text, now_ms()))
    if target:
        notify(target, 'Вас оценили на «' + o['title'] + '»: ' + str(rating) + '★',
               push=True, order_id=order_id)
    return mutation_result(order_id, uid)


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------

@app.post('/api/notifications/read')
def read_notifications(uid: int = Depends(get_current_user)):
    db.execute('UPDATE notifications SET read=1 WHERE user_id=? AND read=0', (uid,))
    return {'notifications': my_notifications(uid)}


# --------------------------------------------------------------------------
# Report (жалоба на заказ) и модерация
# --------------------------------------------------------------------------

@app.post('/api/orders/{order_id}/report')
def report_order(order_id: str, body: dict = None, uid: int = Depends(get_current_user)):
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    if o['author_id'] == uid:
        raise HTTPException(400, 'Нельзя пожаловаться на свой заказ')
    body = body or {}
    reason = str(body.get('reason', '') or '').strip()
    if not reason:
        raise HTTPException(400, 'Укажите причину жалобы')
    dup = db.query('SELECT id FROM reports WHERE order_id=? AND reporter_id=?', (order_id, uid), one=True)
    if dup:
        raise HTTPException(400, 'Вы уже пожаловались на этот заказ')
    db.execute('INSERT INTO reports (order_id, reporter_id, reason, comment, status, created_at) VALUES (?,?,?,?,?,?)',
               (order_id, uid, reason, str(body.get('comment', '') or ''), 'new', now_ms()))
    _on_new_report(o, reason, body.get('comment', '') or '')
    return {'ok': True}


def _on_new_report(o, reason, comment):
    """Уведомление админов и автоблокировка автора заказа после N жалоб."""
    target_id = o['author_id']
    target = db.query('SELECT * FROM users WHERE id=?', (target_id,), one=True) or {}
    rep = db.query('SELECT u.* FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.order_id=? ORDER BY r.created_at DESC LIMIT 1',
                   (o['id'],), one=True) or {}
    username = target.get('username') or ''
    target_str = target.get('name', '?') + (' (@' + username + ')' if username else '')
    reporter_str = rep.get('name', '?') + ((' (@' + (rep.get('username') or '') + ')') if rep.get('username') else '')
    send_admin_notif('Новая жалоба!\nЗаказ: «{}»\nПричина: {}{}\nАвтор заказа: {}\nПожаловался: {}\nURL: {}/orders/{}'.format(
        o['title'], reason, ('\nКомментарий: ' + comment) if comment else '', target_str, reporter_str,
        auth.BASE_URL, o['id']))

    if target.get('blocked'):
        return
    count = db.query(
        'SELECT COUNT(*) AS c FROM reports r JOIN orders o2 ON o2.id = r.order_id '
        'WHERE o2.author_id=? AND r.status=?', (target_id, 'new'), one=True)['c']
    if count >= _block_threshold():
        db.execute('UPDATE users SET blocked=1 WHERE id=?', (target_id,))
        notify(target_id, 'Ваш аккаунт заблокирован модерацией после жалоб. Обратитесь к администратору.')
        send_admin_notif('Аккаунт «{}» автоматически заблокирован ({} жалоб). Восстановить: панель админа.'.format(
            target_str, count))


@app.delete('/api/orders/{order_id}')
def delete_order(order_id: str, uid: int = Depends(get_current_user)):
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    u = _me(uid)
    admin = bool(u.get('is_admin'))
    if o['author_id'] != uid and not admin:
        raise HTTPException(403, 'Удалять может только автор заказа или администратор')
    if o['author_id'] == uid and not admin and o['status'] != 'open':
        raise HTTPException(400, 'Нельзя удалить заказ, который уже в работе или завершён')
    db.execute('DELETE FROM responses WHERE order_id=?', (order_id,))
    db.execute('DELETE FROM reviews WHERE order_id=?', (order_id,))
    db.execute('DELETE FROM reports WHERE order_id=?', (order_id,))
    db.execute('DELETE FROM orders WHERE id=?', (order_id,))
    return {'deleted': True}


@app.get('/api/admin/stats')
def admin_stats(uid: int = Depends(get_current_user)):
    _ensure_admin(uid)
    week = now_ms() - 7 * 86400000
    month = now_ms() - 30 * 86400000

    def cnt(sql, *args):
        r = db.query(sql, args, one=True) or {}
        return int(r.get('c', 0) or 0)

    rows = db.query(
        "SELECT status, COUNT(*) AS c FROM orders WHERE status IN ('open','done','cancelled') GROUP BY status")
    by_status = {r['status']: int(r['c'] or 0) for r in rows}
    total = by_status.get('open', 0) + by_status.get('done', 0) + by_status.get('cancelled', 0)
    by_city = db.query(
        "SELECT city, COUNT(*) AS c FROM orders WHERE status='open' AND city != '' GROUP BY city ORDER BY c DESC LIMIT 6")
    total_responses = cnt('SELECT COUNT(*) AS c FROM responses')
    workers = cnt("SELECT COUNT(*) AS c FROM users WHERE role IN ('worker','both')")
    customers = cnt("SELECT COUNT(*) AS c FROM users WHERE role IN ('customer','both')")
    new_users_week = cnt('SELECT COUNT(*) AS c FROM users WHERE created_at>=?', week)
    new_users_month = cnt('SELECT COUNT(*) AS c FROM users WHERE created_at>=?', month)
    new_orders_week = cnt('SELECT COUNT(*) AS c FROM orders WHERE created_at>=?', week)
    new_orders_month = cnt('SELECT COUNT(*) AS c FROM orders WHERE created_at>=?', month)
    responses_week = cnt('SELECT COUNT(*) AS c FROM responses WHERE created_at>=?', week)
    subscribers = cnt('SELECT COUNT(*) AS c FROM subscriptions')
    return {
        'totalOrders': total,
        'openOrders': by_status.get('open', 0),
        'doneOrders': by_status.get('done', 0),
        'cancelledOrders': by_status.get('cancelled', 0),
        'ordersWeek': new_orders_week,
        'ordersMonth': new_orders_month,
        'totalResponses': total_responses,
        'responsesWeek': responses_week,
        'totalUsers': cnt('SELECT COUNT(*) AS c FROM users'),
        'workers': workers,
        'customers': customers,
        'usersWeek': new_users_week,
        'usersMonth': new_users_month,
        'subscribers': subscribers,
        'byCity': [{'city': r['city'], 'count': int(r['c'] or 0)} for r in by_city],
    }


@app.get('/api/admin/reports')
def admin_reports(uid: int = Depends(get_current_user)):
    _ensure_admin(uid)
    rows = db.query(
        'SELECT r.*, o.title AS order_title, o.status AS order_status, '
        'ru.name AS reporter_name, '
        'ta.id AS target_id, ta.name AS target_name, ta.username AS target_username, ta.blocked AS target_blocked '
        'FROM reports r JOIN orders o ON o.id = r.order_id '
        'JOIN users ru ON ru.id = r.reporter_id '
        'JOIN users ta ON ta.id = o.author_id '
        'ORDER BY r.created_at DESC')
    return [{
        'id': r['id'], 'orderId': r['order_id'], 'orderTitle': r['order_title'],
        'reporterId': r['reporter_id'], 'reporterName': r['reporter_name'],
        'reason': r['reason'], 'comment': r['comment'] or '', 'status': r['status'],
        'targetId': r['target_id'], 'targetName': r['target_name'],
        'targetUsername': r['target_username'] or '', 'targetBlocked': bool(r['target_blocked']),
        'created_at': r['created_at'],
    } for r in rows]


@app.post('/api/admin/reports/{report_id}/resolve')
def admin_resolve_report(report_id: int, uid: int = Depends(get_current_user)):
    _ensure_admin(uid)
    db.execute('UPDATE reports SET status=? WHERE id=?', ('resolved', report_id))
    return {'ok': True}


@app.get('/api/admin/users/blocked')
def admin_blocked_users(uid: int = Depends(get_current_user)):
    _ensure_admin(uid)
    rows = db.query('SELECT id, name, username FROM users WHERE blocked=1 ORDER BY name')
    return [{'id': r['id'], 'name': r['name'], 'username': r['username'] or ''} for r in rows]


@app.post('/api/admin/users/{user_id}/unblock')
def admin_unblock_user(user_id: int, uid: int = Depends(get_current_user)):
    _ensure_admin(uid)
    u = db.query('SELECT * FROM users WHERE id=?', (user_id,), one=True)
    if not u:
        raise HTTPException(404, 'Пользователь не найден')
    db.execute('UPDATE users SET blocked=0 WHERE id=?', (user_id,))
    notify(user_id, 'Ваш аккаунт восстановлен модератором. Приятной работы!')
    return {'ok': True}


# --------------------------------------------------------------------------
# Платежи (Telegram Stars): продвижение заказа
# --------------------------------------------------------------------------

def _boost_price():
    try:
        return max(1, int(os.environ.get('BOOST_PRICE_STARS', '100')))
    except Exception:
        return 100


@app.post('/api/orders/{order_id}/boost_invoice')
def boost_invoice(order_id: str, uid: int = Depends(get_current_user)):
    if not auth.BOT_TOKEN:
        raise HTTPException(400, 'Продвижение доступно только в Telegram')
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        raise HTTPException(404, 'Заказ не найден')
    if o['author_id'] != uid:
        raise HTTPException(403, 'Поднять заказ может только его автор')
    if o['status'] != 'open':
        raise HTTPException(400, 'Продвигать можно только открытые заказы')
    if o.get('boosted_until') and o['boosted_until'] > now_ms():
        raise HTTPException(400, 'Заказ уже поднят — попробуйте позже')
    payload = 'BOOST:' + order_id
    body = {
        'title': 'Поднять заказ',
        'description': 'Подъём заказа наверх ленты на 24 часа',
        'payload': payload,
        'currency': 'XTR',
        'prices': json.dumps([{'label': 'Поднять заказ', 'amount': _boost_price()}], ensure_ascii=False),
    }
    try:
        req = urllib.request.Request(
            'https://api.telegram.org/bot{}/createInvoiceLink'.format(auth.BOT_TOKEN),
            data=urllib.parse.urlencode(body).encode(),
            headers={'Content-Type': 'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = json.loads(r.read().decode('utf-8'))
    except Exception:
        raise HTTPException(502, 'Не удалось создать инвойс, попробуйте позже')
    if not resp.get('ok') or not resp.get('result'):
        raise HTTPException(502, 'Ошибка Telegram: ' + str(resp.get('description', '')))
    return {'url': resp['result']}


_STARS_OFFSET = 0


def _stars_init_offset():
    global _STARS_OFFSET
    try:
        r = db.query('SELECT COALESCE(MAX(update_id),0) AS m FROM stars_updates', one=True)
        _STARS_OFFSET = int(r['m'] or 0)
    except Exception:
        _STARS_OFFSET = 0


def _tg_call(method, params):
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(
        'https://api.telegram.org/bot{}/{}'.format(auth.BOT_TOKEN, method),
        data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode('utf-8'))


def _apply_star_payment(update_id, payment):
    payload = str(payment.get('invoice_payload', '') or '')
    if not payload.startswith('BOOST:'):
        return
    order_id = payload[len('BOOST:'):]
    try:
        row = db.query('SELECT 1 FROM stars_updates WHERE update_id=?', (update_id,), one=True)
        if row:
            return
        db.execute('INSERT INTO stars_updates (update_id, ts) VALUES (?,?)', (update_id, now_ms()))
    except Exception:
        return
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        return
    db.execute('UPDATE orders SET boosted_until=? WHERE id=?', (now_ms() + 86400000, order_id))
    notify(o['author_id'], 'Заказ «' + o['title'] + '» поднят в ленте на 24 часа')


def _tg_poll_once():
    global _STARS_OFFSET
    if not auth.BOT_TOKEN:
        return
    url = ('https://api.telegram.org/bot{}/getUpdates?'.format(auth.BOT_TOKEN) +
           urllib.parse.urlencode({'timeout': 2, 'offset': _STARS_OFFSET}))
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception:
        return
    for upd in data.get('result', []):
        _STARS_OFFSET = max(_STARS_OFFSET, upd['update_id'] + 1)
        try:
            pq = upd.get('pre_checkout_query')
            if pq:
                _tg_call('answerPreCheckoutQuery', {'pre_checkout_query_id': pq['id'], 'ok': 'true'})
                continue
            cb = upd.get('callback_query')
            if cb:
                _bot_handle_callback(cb)
                continue
            msg = upd.get('message') or {}
            sp = msg.get('successful_payment')
            if sp:
                _apply_star_payment(upd['update_id'], sp)
            elif msg:
                _bot_handle_message(msg)
        except Exception:
            pass


# --------------------------------------------------------------------------
# Бот-редактор: люди пишут в ЛС → заказ в приложении + карточка в группу
# --------------------------------------------------------------------------

BOT_TYPES = [
    ('gruz', 'Грузчики'),
    ('vod', 'Водитель'),
    ('pereezd', 'Переезды'),
    ('uborka', 'Уборка'),
    ('raznorab', 'Разнорабочий'),
    ('drug', 'Другое'),
]
BOT_TYPE_LABEL = {k: lbl for k, lbl in BOT_TYPES}


def _kv_get(key):
    try:
        r = db.query('SELECT v FROM kv WHERE k=?', (key,), one=True)
        return r['v'] if r else None
    except Exception:
        return None


def _kv_set(key, val):
    try:
        if _kv_get(key) is None:
            db.execute('INSERT INTO kv (k, v) VALUES (?,?)', (key, val))
        else:
            db.execute('UPDATE kv SET v=? WHERE k=?', (val, key))
    except Exception:
        pass


def _bot_user_by_tg(tg_id, first_name, username):
    uid = str(tg_id)
    u = db.query('SELECT * FROM users WHERE tg_id=?', (uid,), one=True)
    if u:
        return u
    try:
        new_id = db.execute(
            'INSERT INTO users (tg_id, name, username, role, skills, created_at, last_login) VALUES (?,?,?,?,?,?,?)',
            (uid, (first_name or '').strip() or 'Пользователь', username or '', 'both', '[]', now_ms(), now_ms()))
        return db.query('SELECT * FROM users WHERE id=?', (new_id,), one=True)
    except Exception:
        return db.query('SELECT * FROM users WHERE tg_id=?', (uid,), one=True)


def _bot_welcome(chat_id):
    try:
        try:
            db.execute('DELETE FROM kv WHERE k=?', ('bot_pend_' + str(chat_id),))
        except Exception:
            pass
        markup = {'inline_keyboard': [[{'text': 'Открыть приложение',
                                        'url': (auth.BASE_URL or '').rstrip('/') + '/'}]]}
        _tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': 'Привет! Я бот «Подработка 24» 🤝\n\n'
                    'Напишите сообщением вашу вакансию или подработку, например:\n\n'
                    '«Нужен грузчик на 4 часа»\n\n'
                    'Дальше я задам пару вопросов (тип, цена, город) и опубликую заявку '
                    'в группе и в приложении.',
            'reply_markup': json.dumps(markup)})
    except Exception:
        pass


def _bot_get_pend(chat_id):
    s = _kv_get('bot_pend_' + str(chat_id))
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


def _bot_save_pend(chat_id, pend):
    _kv_set('bot_pend_' + str(chat_id), json.dumps(pend, ensure_ascii=False))


def _bot_ask_type(chat_id):
    kb = []
    for i in range(0, len(BOT_TYPES), 2):
        kb.append([{'text': lbl, 'callback_data': 'p24vt_' + k} for k, lbl in BOT_TYPES[i:i + 2]])
    try:
        _tg_call('sendMessage', {'chat_id': chat_id,
                                 'text': '👌 Принято! Теперь заполним заявку.\n\nШаг 1 из 3 — тип работы:',
                                 'reply_markup': json.dumps({'inline_keyboard': kb})})
    except Exception:
        pass


def _bot_ask_price(chat_id):
    try:
        _tg_call('sendMessage', {'chat_id': chat_id,
                                 'text': '💰 Шаг 2 из 3 — сколько платите?\n\n'
                                         'Напишите сумму числом, например: 2500\n'
                                         'Или отправьте «договорная», если цена не фиксирована.'})
    except Exception:
        pass


def _bot_ask_city(chat_id):
    try:
        _tg_call('sendMessage', {'chat_id': chat_id,
                                 'text': '🏙 Шаг 3 из 3 — в каком городе?',
                                 'reply_markup': json.dumps({
                                     'inline_keyboard': [[{'text': 'Пропустить', 'callback_data': 'p24city_skip'}]]})})
    except Exception:
        pass


def _bot_show_confirm(chat_id, pend):
    price = int(pend.get('price') or 0)
    price_txt = str(price) + ' ₽' if price else 'договорная'
    city = (pend.get('city') or '').strip()
    text = ('📝 Проверьте заявку:\n\n'
            '«' + pend['title'] + '»\n'
            '📦 ' + pend['type'] + '\n'
            '💰 ' + price_txt + '\n'
            '🏙 ' + (city or '—') + '\n\n'
            'Всё верно?')
    try:
        _tg_call('sendMessage', {'chat_id': chat_id, 'text': text, 'reply_markup': json.dumps({
            'inline_keyboard': [
                [{'text': '✅ Опубликовать', 'callback_data': 'p24pub_yes'}],
                [{'text': '✏️ Заполнить заново', 'callback_data': 'p24pub_reset'}],
            ]})})
    except Exception:
        pass


def _parse_price(text):
    t = (text or '').strip().lower()
    if not t or t in ('договорная', 'договорную', 'по договорённости', 'не знаю', 'без оплаты', '-'):
        return 0
    m = re.search(r'\d[\d\s]{0,8}', t)
    if not m:
        return 0
    try:
        return int(re.sub(r'\s+', '', m.group(0)))
    except Exception:
        return 0


def _bot_handle_message(msg):
    if (msg.get('chat') or {}).get('type') != 'private':
        return
    frm = msg.get('from') or {}
    tg_id = frm.get('id')
    chat_id = (msg.get('chat') or {}).get('id')
    text = (msg.get('text') or '').strip()
    if not tg_id or not chat_id or not text:
        return
    if text.startswith('/start'):
        _bot_welcome(chat_id)
        return
    if text.startswith('/'):
        return
    pend = _bot_get_pend(chat_id)
    if pend and pend.get('step') == 'price':
        pend['price'] = _parse_price(text)
        pend['step'] = 'city'
        _bot_save_pend(chat_id, pend)
        _bot_ask_city(chat_id)
        return
    if pend and pend.get('step') == 'city':
        pend['city'] = text[:60]
        pend['step'] = 'confirm'
        _bot_save_pend(chat_id, pend)
        _bot_show_confirm(chat_id, pend)
        return
    u = _bot_user_by_tg(tg_id, frm.get('first_name') or '', frm.get('username') or '')
    if not u:
        return
    _bot_save_pend(chat_id, {'user_id': u['id'], 'title': text[:300],
                             'type': '', 'price': 0, 'city': '', 'step': 'type'})
    _bot_ask_type(chat_id)


def _publish_order(chat_id, pend):
    order_id = 'o_' + uuid.uuid4().hex[:8]
    title = (pend.get('title') or '').strip()[:300] or 'Без названия'
    otype = pend.get('type') or 'Другое'
    price = int(pend.get('price') or 0)
    city = (pend.get('city') or '').strip()
    dt = time.strftime('%Y-%m-%dT%H:%M')
    try:
        db.execute(
            'INSERT INTO orders (id, type, title, description, address, price, people_count, urgent, show_phone, phone, datetime, author_id, created_at, status, city) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (order_id, otype, title, title, '', price, 1, 0, 0, '', dt, pend['user_id'], now_ms(), 'open', city))
    except Exception:
        return None
    try:
        db.execute('DELETE FROM kv WHERE k=?', ('bot_pend_' + str(chat_id),))
    except Exception:
        pass
    price_txt = str(price) + ' ₽' if price else 'договорная'
    text = '🆕 Новый заказ\n\n«' + title + '»\n📦 ' + otype + '\n💰 ' + price_txt
    if city:
        text += '\n🏙 ' + city
    text += '\n🕐 ' + dt.replace('T', ' ')
    app_url = (auth.BASE_URL or '').rstrip('/') + '/?startapp=' + order_id
    mid = post_to_channel(text, buttons=[
        [{'text': 'Открыть в приложении', 'url': app_url}],
    ])
    if mid:
        _kv_set('bot_msg_' + order_id, json.dumps({'msg_id': mid, 'text': text}))
    try:
        notify(pend['user_id'], 'Заказ опубликован: «' + title + '»')
    except Exception:
        pass
    try:
        notify_subscribers({'id': order_id, 'author_id': pend['user_id'], 'title': title,
                            'city': city, 'type': otype, 'price': price})
    except Exception:
        pass
    return order_id, title, otype, price_txt


def _bot_close_order(cqid, chat_id, msg_id, tg_id, order_id):
    o = db.query('SELECT * FROM orders WHERE id=?', (order_id,), one=True)
    if not o:
        try:
            _tg_call('answerCallbackQuery', {'callback_query_id': cqid, 'text': 'Заказ не найден'})
        except Exception:
            pass
        return
    if o.get('status') != 'open':
        try:
            _tg_call('answerCallbackQuery', {'callback_query_id': cqid, 'text': 'Вакансия уже закрыта'})
        except Exception:
            pass
        return
    author = db.query('SELECT tg_id FROM users WHERE id=?', (o['author_id'],), one=True)
    if not author or str(author.get('tg_id') or '') != str(tg_id):
        try:
            _tg_call('answerCallbackQuery', {'callback_query_id': cqid,
                                             'text': 'Закрыть может только автор заказа'})
        except Exception:
            pass
        return
    db.execute("UPDATE orders SET status='done' WHERE id=?", (order_id,))
    try:
        _tg_call('answerCallbackQuery', {'callback_query_id': cqid, 'text': '✅ Вакансия закрыта'})
        if chat_id and msg_id:
            _tg_call('editMessageText', {'chat_id': chat_id, 'message_id': msg_id,
                                         'text': '✅ Вакансия закрыта',
                                         'reply_markup': json.dumps({'inline_keyboard': []})})
    except Exception:
        pass
    info_s = _kv_get('bot_msg_' + order_id)
    if info_s:
        try:
            info = json.loads(info_s)
            group = os.environ.get('GROUP_ID', '').strip() or '@podrabotka_365'
            _tg_call('editMessageText', {'chat_id': group, 'message_id': info['msg_id'],
                                         'text': info['text'] + '\n\n✅ Вакансия закрыта',
                                         'reply_markup': json.dumps({'inline_keyboard': []})})
        except Exception:
            pass
    try:
        notify(o['author_id'], 'Ваша вакансия «' + str(o.get('title') or '') + '» закрыта')
    except Exception:
        pass


def _bot_handle_callback(cb):
    frm = cb.get('from') or {}
    tg_id = frm.get('id')
    data = cb.get('data') or ''
    cqid = cb.get('id')
    m = cb.get('message') or {}
    chat_id = (m.get('chat') or {}).get('id')
    msg_id = m.get('message_id')
    if not tg_id or not cqid:
        return
    if data.startswith('p24vt_'):
        label = BOT_TYPE_LABEL.get(data[len('p24vt_'):])
        pend = _bot_get_pend(chat_id)
        if not label or not pend or pend.get('step') != 'type':
            try:
                _tg_call('answerCallbackQuery', {'callback_query_id': cqid,
                                                 'text': 'Срок действия истёк — напишите сообщение заново'})
            except Exception:
                pass
            return
        pend['type'] = label
        pend['step'] = 'price'
        _bot_save_pend(chat_id, pend)
        try:
            _tg_call('answerCallbackQuery', {'callback_query_id': cqid, 'text': label})
        except Exception:
            pass
        _bot_ask_price(chat_id)
    elif data == 'p24city_skip':
        pend = _bot_get_pend(chat_id)
        if not pend or pend.get('step') != 'city':
            return
        pend['city'] = ''
        pend['step'] = 'confirm'
        _bot_save_pend(chat_id, pend)
        try:
            _tg_call('answerCallbackQuery', {'callback_query_id': cqid, 'text': 'Пропущено'})
        except Exception:
            pass
        _bot_show_confirm(chat_id, pend)
    elif data == 'p24pub_reset':
        pend = _bot_get_pend(chat_id)
        if pend:
            pend['step'] = 'type'
            pend['type'] = ''
            _bot_save_pend(chat_id, pend)
        try:
            _tg_call('answerCallbackQuery', {'callback_query_id': cqid, 'text': 'Начнём заново'})
        except Exception:
            pass
        _bot_ask_type(chat_id)
    elif data == 'p24pub_yes':
        pend = _bot_get_pend(chat_id)
        if not pend or pend.get('step') != 'confirm':
            try:
                _tg_call('answerCallbackQuery', {'callback_query_id': cqid, 'text': 'Срок действия истёк'})
            except Exception:
                pass
            return
        res = _publish_order(chat_id, pend)
        if not res:
            return
        order_id, title, otype, price_txt = res
        app_url = (auth.BASE_URL or '').rstrip('/') + '/?startapp=' + order_id
        try:
            _tg_call('answerCallbackQuery', {'callback_query_id': cqid, 'text': '✅ Опубликовано'})
            _tg_call('editMessageText', {'chat_id': chat_id, 'message_id': msg_id,
                                         'text': '✅ Заказ опубликован в группе и в приложении!\n\n'
                                                 '«' + title + '»\n📦 ' + otype + '\n💰 ' + price_txt +
                                                 '\n\nЗакрыть вакансию можно кнопкой ниже.',
                                         'reply_markup': json.dumps({'inline_keyboard': [
                                             [{'text': 'Вакансия закрыта', 'callback_data': 'p24close_' + order_id}],
                                             [{'text': 'Открыть в приложении', 'url': app_url}],
                                         ]})})
        except Exception:
            pass
    elif data.startswith('p24close_'):
        _bot_close_order(cqid, chat_id, msg_id, tg_id, data[len('p24close_'):])


def pin_group_welcome():
    """Разово постит в группу-витрину: приветствие (пин) + кнопку «Подать заявку»."""
    if not auth.BOT_TOKEN or not auth.BASE_URL:
        return
    group = os.environ.get('GROUP_ID', '').strip() or '@podrabotka_365'
    try:
        done = db.query("SELECT v FROM kv WHERE k='group_welcome'", one=True)
        if not done:
            try:
                payload = {'chat_id': group,
                           'text': '👋 Добро пожаловать в «Подработка 24»!\n\nЗдесь автоматически появляются свежие заказы. Открыть приложение:',
                           'reply_markup': json.dumps({
                               'inline_keyboard': [[{'text': 'Открыть приложение', 'url': auth.BASE_URL.rstrip('/') + '/'}]]
                           })}
                req = urllib.request.Request(
                    'https://api.telegram.org/bot{}/sendMessage'.format(auth.BOT_TOKEN),
                    data=urllib.parse.urlencode(payload).encode(),
                    headers={'Content-Type': 'application/x-www-form-urlencoded'})
                with urllib.request.urlopen(req, timeout=8) as r:
                    resp = json.loads(r.read().decode('utf-8'))
                msg_id = resp.get('result', {}).get('message_id')
                if msg_id:
                    try:
                        pin = urllib.request.Request(
                            'https://api.telegram.org/bot{}/pinChatMessage'.format(auth.BOT_TOKEN) + '?' +
                            urllib.parse.urlencode({'chat_id': group, 'message_id': msg_id, 'disable_notification': 'true'}))
                        urllib.request.urlopen(pin, timeout=8)
                    except Exception:
                        pass
            except Exception:
                pass
            db.execute("INSERT INTO kv (k, v) VALUES ('group_welcome', '1')")
        bot_username = auth.get_bot_username() or None
        inv = db.query("SELECT v FROM kv WHERE k='group_invite_v3'", one=True)
        if not inv and bot_username:
            invite_text = ('💼 Хотите разместить вакансию или подработку?\n\n'
                           'Просто откройте приложение по кнопке «Подработка 24», '
                           'разместите вакансию — и мы сразу опубликуем её в группе.')
            invite_markup = json.dumps({
                'inline_keyboard': [[{'text': 'Подработка 24',
                                      'url': (auth.BASE_URL or '').rstrip('/') + '/'}]]
            })
            try:
                payload = {'chat_id': group, 'text': invite_text,
                           'reply_markup': invite_markup}
                req = urllib.request.Request(
                    'https://api.telegram.org/bot{}/sendMessage'.format(auth.BOT_TOKEN),
                    data=urllib.parse.urlencode(payload).encode(),
                    headers={'Content-Type': 'application/x-www-form-urlencoded'})
                urllib.request.urlopen(req, timeout=8)
            except Exception:
                pass
            db.execute("INSERT INTO kv (k, v) VALUES ('group_invite_v3', '1')")
        # То же сообщение — в ЛС бота администраторам
        adm_inv = db.query("SELECT v FROM kv WHERE k='group_invite_admin_v3'", one=True)
        if not adm_inv:
            sent = False
            for chat_id in _admin_tg_ids():
                try:
                    payload = {'chat_id': chat_id,
                               'text': ('💼 Хотите разместить вакансию или подработку?\n\n'
                                        'Просто откройте приложение по кнопке «Подработка 24», '
                                        'разместите вакансию — и мы сразу опубликуем её в группе.'),
                               'reply_markup': json.dumps({
                                   'inline_keyboard': [[{'text': 'Подработка 24',
                                                         'url': (auth.BASE_URL or '').rstrip('/') + '/'}]]
                               })}
                    req = urllib.request.Request(
                        'https://api.telegram.org/bot{}/sendMessage'.format(auth.BOT_TOKEN),
                        data=urllib.parse.urlencode(payload).encode(),
                        headers={'Content-Type': 'application/x-www-form-urlencoded'})
                    urllib.request.urlopen(req, timeout=8)
                    sent = True
                except Exception:
                    pass
            db.execute("INSERT INTO kv (k, v) VALUES ('group_invite_admin_v3', '1')")
    except Exception:
        pass


def _stars_loop():
    while True:
        try:
            _tg_poll_once()
        except Exception:
            pass
        time.sleep(3)


_stars_init_offset()
threading.Thread(target=_stars_loop, daemon=True).start()
threading.Thread(target=pin_group_welcome, daemon=True).start()


# --------------------------------------------------------------------------
# Static (frontend)
# --------------------------------------------------------------------------

app.mount('/', StaticFiles(directory=WEB_ROOT, html=True), name='static')