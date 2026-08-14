import os
import re

# P24_DB: URL PostgreSQL (postgres://...) или путь к файлу SQLite.
# Пример для Neon: postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/dbname?sslmode=require
DB_DSN = os.environ.get('P24_DB', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'p24.db'))

USE_PG = '://' in DB_DSN

if USE_PG:
    try:
        import psycopg
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool
    except ImportError:
        raise SystemExit('P24_DB задан как PostgreSQL URL, но не установлен psycopg. '
                         'Выполните: pip install "psycopg[binary,pool]"')

    # Пул: подключение к Neon дорогое (~0.6–1с за коннект) — держим тёплые соединения.
    # min_size=1 ещё и не даёт базе засыпать (постоянное активное соединение).
    _pool = ConnectionPool(DB_DSN, min_size=1, max_size=4, open=False,
                           kwargs={'row_factory': dict_row, 'connect_timeout': 15, 'autocommit': True})

    def _ensure_pool():
        if _pool.closed:
            _pool.open()

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT UNIQUE,
  name TEXT NOT NULL,
  username TEXT DEFAULT '',
  photo TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  role TEXT DEFAULT 'both',
  skills TEXT DEFAULT '[]',
  is_admin INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  created_at INTEGER,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  type TEXT, title TEXT, description TEXT, address TEXT,
  price INTEGER, people_count INTEGER, urgent INTEGER,
  show_phone INTEGER, phone TEXT, datetime TEXT,
  author_id INTEGER NOT NULL, created_at INTEGER,
  status TEXT DEFAULT 'open',
  accepted_response_id TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  message TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  name TEXT DEFAULT '',
  rating INTEGER NOT NULL,
  text TEXT DEFAULT '',
  time INTEGER
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT,
  time INTEGER,
  read INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT,
  comment TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  created_at INTEGER
);
"""

# Время хранится в миллисекундах — в PostgreSQL нужен BIGINT, не INTEGER.
PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  tg_id TEXT UNIQUE,
  name TEXT NOT NULL,
  username TEXT DEFAULT '',
  photo TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  role TEXT DEFAULT 'both',
  skills TEXT DEFAULT '[]',
  is_admin INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  created_at BIGINT,
  last_login BIGINT
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at BIGINT
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  type TEXT, title TEXT, description TEXT, address TEXT,
  price INTEGER, people_count INTEGER, urgent INTEGER,
  show_phone INTEGER, phone TEXT, datetime TEXT,
  author_id INTEGER NOT NULL, created_at BIGINT,
  status TEXT DEFAULT 'open',
  accepted_response_id TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  message TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  created_at BIGINT
);
CREATE TABLE IF NOT EXISTS reviews (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  name TEXT DEFAULT '',
  rating INTEGER NOT NULL,
  text TEXT DEFAULT '',
  time BIGINT
);
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT,
  time BIGINT,
  read INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT,
  comment TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  created_at BIGINT
);
"""

SCHEMA = PG_SCHEMA if USE_PG else SQLITE_SCHEMA

_QMARK = re.compile(r'\?')
_BOOL_CAST = re.compile(r"CAST\(\? AS BOOLEAN\)")


def _conv(sql):
    """Переводит плейсхолдеры SQLite (?) в стиль PostgreSQL (%s)."""
    if not USE_PG:
        return sql
    return _BOOL_CAST.sub('%s', _QMARK.sub('%s', sql))


class _SqliteConn:
    def __init__(self):
        import sqlite3
        self.conn = sqlite3.connect(DB_DSN, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

    def query(self, sql, args=(), one=False):
        cur = self.conn.execute(sql, args)
        rows = [dict(r) for r in cur.fetchall()]
        return (rows[0] if rows else None) if one else rows

    def execute(self, sql, args=()):
        cur = self.conn.execute(sql, args)
        self.conn.commit()
        return cur.lastrowid

    def executescript(self, script):
        self.conn.executescript(script)
        self.conn.commit()

    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.close()


class _PgConn:
    def __init__(self):
        _ensure_pool()
        self.conn = _pool.getconn()

    def query(self, sql, args=(), one=False):
        cur = self.conn.execute(_conv(sql), list(args) if args else None)
        rows = cur.fetchall()
        out = [dict(r) for r in rows]
        return (out[0] if out else None) if one else out

    def execute(self, sql, args=()):
        s = _conv(sql).strip()
        has_returning = 'RETURNING' in s.upper()
        # Для INSERT нужно вернуть id (замена lastrowid у sqlite3)
        if s.upper().startswith('INSERT') and not has_returning:
            s += ' RETURNING *'
            has_returning = True
        cur = self.conn.execute(s, list(args) if args else None)
        row = cur.fetchone() if has_returning else None
        self.conn.commit()
        return (dict(row) if row else {}).get('id')

    def executescript(self, script):
        # SCHEMA без параметров — psycopg выполнит как simple query (несколько операторов)
        self.conn.execute(script)
        self.conn.commit()

    def commit(self):
        self.conn.commit()

    def close(self):
        _pool.putconn(self.conn)


def connect():
    return _PgConn() if USE_PG else _SqliteConn()


def query(sql, args=(), one=False):
    conn = connect()
    try:
        return conn.query(sql, args, one)
    finally:
        conn.close()


def execute(sql, args=()):
    conn = connect()
    try:
        return conn.execute(sql, args)
    finally:
        conn.close()


def executescript(script):
    conn = connect()
    try:
        conn.executescript(script)
    finally:
        conn.close()


def init_db():
    executescript(SCHEMA)
    # безопасная миграция: колонки могут отсутствовать в старой БД
    for col in ('is_admin INTEGER DEFAULT 0', 'blocked INTEGER DEFAULT 0'):
        try:
            execute('ALTER TABLE users ADD COLUMN ' + col)
        except Exception:
            pass