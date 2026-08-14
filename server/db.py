import os
import sqlite3

DB_PATH = os.environ.get('P24_DB', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'p24.db'))

SCHEMA = """
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


def connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def query(sql, args=(), one=False):
    conn = connect()
    try:
        cur = conn.execute(sql, args)
        rows = [dict(r) for r in cur.fetchall()]
        return (rows[0] if rows else None) if one else rows
    finally:
        conn.close()


def execute(sql, args=()):
    conn = connect()
    try:
        cur = conn.execute(sql, args)
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def executescript(script):
    conn = connect()
    try:
        conn.executescript(script)
        conn.commit()
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