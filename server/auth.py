import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.parse
import urllib.request

from . import db


def _load_env():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip())


_load_env()
BOT_TOKEN = os.environ.get('BOT_TOKEN', '')

# Публичный адрес приложения (для ссылок в уведомлениях админу), напр. https://myservice.onrender.com
BASE_URL = os.environ.get('BASE_URL', '')

_BOT_INFO = {'username': '', 'ts': 0}


def get_bot_username():
    """Имя пользователя бота для ссылок «Поделиться» (getMe, кэш на час)."""
    now = time.time()
    if not _BOT_INFO['username'] or now - _BOT_INFO['ts'] > 3600:
        info = ''
        if BOT_TOKEN:
            try:
                url = 'https://api.telegram.org/bot{}/getMe'.format(BOT_TOKEN)
                with urllib.request.urlopen(url, timeout=10) as r:
                    data = json.loads(r.read().decode('utf-8'))
                info = (data.get('result') or {}).get('username') or ''
            except Exception:
                info = _BOT_INFO['username'] or ''
        _BOT_INFO['username'] = info
        _BOT_INFO['ts'] = now
    return _BOT_INFO['username']


def _parse_user(init_data):
    """Достаёт объект user из initData (URL-encoded JSON)."""
    parsed = dict(urllib.parse.parse_qsl(init_data))
    raw = parsed.get('user')
    if not raw:
        return None
    try:
        u = json.loads(raw)
    except Exception:
        return None
    name = ' '.join(x for x in [str(u.get('first_name', '')), str(u.get('last_name', ''))] if x)
    return {
        'tg_id': str(u.get('id')),
        'name': name or 'Гость',
        'username': str(u.get('username', '') or ''),
        'photo': str(u.get('photo_url', '') or '')
    }


def verify_init_data(init_data):
    """
    Проверка подписи initData (Telegram WebApp):
    secret_key = HMAC_SHA256(bot_token, "WebAppData")
    signature  = HMAC_SHA256(data_check_string, secret_key)
    Возвращает dict пользователя или None при неверной подписи.
    """
    if not init_data:
        return None
    if not BOT_TOKEN:
        # режим разработки без токена: доверяем (но парсим user)
        return _parse_user(init_data)
    try:
        parsed = dict(urllib.parse.parse_qsl(init_data))
    except Exception:
        return None
    hash_val = parsed.pop('hash', '')
    if not hash_val:
        return None
    items = sorted(parsed.items())
    data_check = '\n'.join('{}={}'.format(k, v) for k, v in items)
    secret = hmac.new(b'WebAppData', BOT_TOKEN.encode(), hashlib.sha256).digest()
    signature = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, hash_val):
        return None
    return _parse_user(init_data)


def create_token(user_id):
    token = secrets.token_hex(24)
    db.execute('INSERT INTO tokens (token, user_id, created_at) VALUES (?,?,?)',
               (token, user_id, int(time.time())))
    return token


def user_from_token(token):
    if not token:
        return None
    row = db.query('SELECT user_id FROM tokens WHERE token=?', (token,), one=True)
    if not row:
        return None
    return row['user_id']