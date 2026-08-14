import json
import time

from . import db

MIN = 60000


def seed():
    """Заполняет БД демо-данными, если она пуста."""
    existing = db.query('SELECT COUNT(*) AS c FROM users')
    if existing and existing[0]['c']:
        ensure_demo_driver_order()
        return

    now = int(time.time() * 1000)

    auth = [
        ('101', 'СтройЛогистика', 'stroy_log'),
        ('102', 'Анна', 'anna_move'),
        ('103', 'Офис-Менеджер', 'office_mng'),
        ('104', 'Пётр', 'petr_build'),
        ('105', 'МебельПро', 'furniture_pro'),
        ('106', 'Сергей', 'sergey_office'),
        ('107', 'Ирина', 'irina_clean'),
        ('108', 'Мария', 'maria_ikea'),
        ('109', 'Дмитрий', 'dmitry_home'),
        ('110', 'Владимир', 'vlad_dacha'),
        ('111', 'Ольга', 'olga_win'),
        ('112', 'Алексей', 'alex_move'),
        ('113', 'Магазин «Вкусно»', 'shop_tasty'),
    ]
    author_ids = {}
    for tg, name, username in auth:
        author_ids[tg] = db.execute(
            'INSERT INTO users (tg_id, name, username, photo, role, skills, created_at, last_login) VALUES (?,?,?,?,?,?,?,?)',
            (tg, name, username, '', 'customer', '["работодатель"]', now - 90000000, now - 90000000))

    # несколько исполнителей с навыками и рейтингом (из отзывов ниже)
    workers = [
        ('9001', 'Дмитрий К.', 'dmitry_k', '["грузчик", "разнорабочий"]'),
        ('9002', 'Артём', 'artem', '["грузчик"]'),
        ('9003', 'Сергей В.', 'sergey_v', '["грузчик", "такелаж"]'),
        ('9004', 'Николай', 'nick_t', '["переезды", "водитель"]'),
        ('9101', 'Олег', 'oleg', '["уборка"]'),
    ]
    worker_ids = {}
    for tg, name, username, skills in workers:
        worker_ids[tg] = db.execute(
            'INSERT INTO users (tg_id, name, username, photo, role, skills, created_at, last_login) VALUES (?,?,?,?,?,?,?,?)',
            (tg, name, username, '', 'worker', skills, now - 80000000, now - 80000000))

    def d(day_offset, h, m):
        import datetime
        x = datetime.datetime.now() + datetime.timedelta(days=day_offset)
        x = x.replace(hour=h, minute=m, second=0, microsecond=0)
        return x.strftime('%Y-%m-%dT%H:%M')

    orders = [
        # no, type, title, desc, address, price, people, urgent, minutesAgo, iso, author, showPhone, phone, status
        ('o_1', 'Грузчики', 'Разгрузка фуры со стройматериалами',
         'Нужно разгрузить 20-тонную фуру с мешками цемента и поддонами. Срочно, работа на 3–4 часа. Оплата по факту, работа оплачивается на месте.',
         'Москва, ул. Складочная, 3, склад №5', 3000, 4, 1, 12, d(0, 14, 0), '101', 1, '+7 901 234-56-78', 'open'),
        ('o_2', 'Переезды', 'Квартирный переезд, 2-комн.',
         'Квартирный переезд с 5 этажа (лифт есть). Вещи: диван, шкаф, коробки. Нужен грузовой лифт — на месте.',
         'Москва, пр-т Мира, 12, кв. 45', 6000, 2, 0, 45, d(1, 9, 0), '102', 0, '', 'open'),
        ('o_3', 'Уборка', 'Генеральная уборка офиса 120 м²',
         'Генеральная уборка офиса после ремонта: полы, окна, кухня. Инвентарь и химия наши.',
         'Москва, Бизнес-центр «Атлант», офис 301', 4500, 2, 0, 110, d(0, 18, 0), '103', 0, '', 'open'),
        ('o_4', 'Разнорабочие', 'Подсобные работы на стройке',
         'Подсобные работы: поднос материалов, уборка территории, помощь бригаде. Работа ежедневная по 8 часов, оплата ежедневно.',
         'Москва, ул. Строителей, 7, корп. 2', 2500, 3, 0, 150, d(0, 8, 0), '104', 1, '+7 912 345-67-89', 'open'),
        ('o_5', 'Грузчики', 'Погрузка мебели на склад',
         'Нужно погрузить мебель из квартиры в грузовик и выгрузить на складе. Объём — 1 машина.',
         'Москва, ул. Садовая, 3, подъезд 1', 2000, 2, 1, 210, d(0, 11, 0), '105', 0, '', 'open'),
        ('o_6', 'Переезды', 'Офисный переезд, 30 рабочих мест',
         'Переезд офиса из бизнес-центра в бизнес-центр. Столы, кресла, шкафы, техника в коробках. Два грузовика.',
         'Москва, от «Москва-Сити» до «Сокол»', 15000, 4, 0, 320, d(1, 10, 0), '106', 1, '+7 923 456-78-90', 'open'),
        ('o_7', 'Уборка', 'Уборка после ремонта квартиры',
         'Уборка после косметического ремонта: побелка, пыль, полы. Квартира 60 м².',
         'Москва, ул. Ленина, 21, кв. 7', 4000, 1, 0, 480, d(0, 16, 0), '107', 0, '', 'open'),
        ('o_8', 'Разнорабочие', 'Сборка мебели (ИКЕА)',
         'Собрать шкаф, комод и кухонный гарнитур. Инструкции есть, нужен набор отверток.',
         'Москва, ул. Космонавтов, 15, кв. 88', 3000, 1, 0, 640, d(0, 13, 0), '108', 0, '', 'open'),
        ('o_9', 'Грузчики', 'Такелаж холодильника и стиральной машины',
         'Нужно поднять холодильник и стиральную машину на 4 этаж без лифта и поставить на место.',
         'Санкт-Петербург, ул. Чехова, 5, кв. 12', 1500, 1, 1, 800, d(0, 15, 0), '109', 1, '+7 934 567-89-01', 'open'),
        ('o_10', 'Другое', 'Помощь в выносе хлама с дачи',
         'Помочь вынести старую мебель и хлам из дома на участок, погрузить в прицеп.',
         'Казань, СНТ «Берёзка», уч. 32', 2000, 2, 0, 1500, d(1, 12, 0), '110', 0, '', 'open'),
        ('o_11', 'Уборка', 'Мойка окон в квартире',
         'Помыть окна в 3-комнатной квартире, 8 окон + балкон.',
         'Санкт-Петербург, ул. Пушкина, 8, кв. 3', 2500, 1, 0, 2100, d(0, 17, 0), '111', 0, '', 'open'),
        ('o_12', 'Переезды', 'Перевозка + грузчики, 1 грузовик',
         'Переезд из хрущёвки в новостройку. Грузчик нужен на погрузку и выгрузку.',
         'Москва, от ул. Первомайская, 14 до ул. Новая, 1', 8000, 3, 0, 3000, d(2, 8, 0), '112', 1, '+7 945 678-90-12', 'open'),
        ('o_13', 'Уборка', 'Мытьё витрин магазина',
         'Помыть витрины и стеклянные двери магазина, 30 м² стекла. Вода есть.',
         'Москва, ТЦ «Рио», 1 этаж', 3500, 1, 0, 5000, d(-1, 10, 0), '113', 0, '', 'done'),
        ('o_14', 'Водитель', 'Водитель с машиной на день (грузоперевозки)',
         'Нужен водитель со своим авто (универсал или грузовой) на 8 часов: доставка мебели и развоз по 3 адресам. Оплата по часам.',
         'Москва, склад «Депо», ул. Электролитный пр-д, 3', 9000, 1, 1, 900, d(1, 9, 0), '112', 1, '+7 945 678-90-12', 'open'),
    ]

    for (oid, otype, title, desc, address, price, people, urgent, minago, iso, author, show_phone, phone, status) in orders:
        city = address.split(',', 1)[0].strip()
        db.execute(
            'INSERT INTO orders (id, type, title, description, address, price, people_count, urgent, show_phone, phone, datetime, author_id, created_at, status, city) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (oid, otype, title, desc, address, price, people, urgent, show_phone, phone, iso, author_ids[author], now - minago * MIN, status, city))

    # отклики на o_1 и o_2
    db.execute(
        'INSERT INTO responses (id, order_id, user_id, message, status, created_at) VALUES (?,?,?,?,?,?)',
        ('r11', 'o_1', worker_ids['9001'], 'Готов выйти, есть опыт работы на складе.', 'new', now - 32 * MIN))
    db.execute(
        'INSERT INTO responses (id, order_id, user_id, message, status, created_at) VALUES (?,?,?,?,?,?)',
        ('r12', 'o_1', worker_ids['9002'], 'Смогу приехать к указанному времени.', 'new', now - 20 * MIN))
    db.execute(
        'INSERT INTO responses (id, order_id, user_id, message, status, created_at) VALUES (?,?,?,?,?,?)',
        ('r13', 'o_1', worker_ids['9003'], 'Есть своя тележка и опыт такелажа.', 'new', now - 9 * MIN))
    db.execute(
        'INSERT INTO responses (id, order_id, user_id, message, status, created_at) VALUES (?,?,?,?,?,?)',
        ('r21', 'o_2', worker_ids['9004'], 'Занимаюсь переездами 3 года, есть фургон.', 'new', now - 15 * MIN))

    # отзывы (дают рейтинг авторам и исполнителям)
    db.execute(
        'INSERT INTO reviews (order_id, user_id, target_id, name, rating, text, time) VALUES (?,?,?,?,?,?,?)',
        ('o_13', author_ids['113'], author_ids['113'], 'Магазин «Вкусно»', 4, 'Работали аккуратно, немного задержались.', now - 4400 * MIN))
    db.execute(
        'INSERT INTO reviews (order_id, user_id, target_id, name, rating, text, time) VALUES (?,?,?,?,?,?,?)',
        ('o_13', worker_ids['9101'], author_ids['113'], 'Магазин «Вкусно»', 5, 'Заказчик приятный, всё оплатил вовремя.', now - 4300 * MIN))
    for uid, rating in [('9001', 4.9), ('9002', 4.5), ('9003', 5.0), ('9004', 4.7)]:
        db.execute(
            'INSERT INTO reviews (order_id, user_id, target_id, name, rating, text, time) VALUES (?,?,?,?,?,?,?)',
            ('o_1', author_ids['101'], worker_ids[uid], '', rating, '', now - 20000 * MIN))


def ensure_demo_driver_order():
    """Добавляет демо-заказ «Водитель» в уже существующую БД (идемпотентно)."""
    if db.query('SELECT id FROM orders WHERE id=?', ('o_14',), one=True):
        return
    a = db.query('SELECT id FROM users WHERE tg_id=?', ('112',), one=True)
    if not a:
        return
    import datetime
    x = (datetime.datetime.now() + datetime.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    db.execute(
        'INSERT INTO orders (id, type, title, description, address, price, people_count, urgent, show_phone, phone, datetime, author_id, created_at, status, city) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('o_14', 'Водитель', 'Водитель с машиной на день (грузоперевозки)',
         'Нужен водитель со своим авто (универсал или грузовой) на 8 часов: доставка мебели и развоз по 3 адресам. Оплата по часам.',
         'Москва, склад «Депо», ул. Электролитный пр-д, 3', 9000, 1, 1, 1, '+7 945 678-90-12',
         x.strftime('%Y-%m-%dT%H:%M'), a['id'], int(time.time() * 1000) - 900 * MIN, 'open', 'Москва'))