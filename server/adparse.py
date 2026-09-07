# -*- coding: utf-8 -*-
"""Разбор объявления, написанного свободным текстом.

Люди пишут по-разному: кто-то «Ключ: значение» построчно, кто-то сплошной
прозой. Парсер вытаскивает поля для ленты приложения (тип, цена, город, дата,
телефон), а исходный текст сохраняется целиком и именно он уходит в канал.

Всё best-effort: чего не нашли — остаётся пустым, автор видит разбор
в предпросмотре перед публикацией.
"""
import datetime
import re

TYPES = ['Водитель', 'Грузчики', 'Разнорабочие', 'Переезды', 'Уборка', 'Другое']

# Порядок важен: «переезд + грузчики» — это Переезды
_TYPE_RULES = [
    ('Переезды', r'переезд|перевозк|газел|доставк\w*\s+мебел'),
    ('Водитель', r'водител|шофер|шофёр|экспедитор|категори\w*\s*[bcde]|с\s+правами'),
    ('Уборка', r'уборк|убрать|клинин|мойк|мыть\s+окна|дворник|подмет'),
    ('Грузчики', r'грузчик|разгруз|погруз|выгруж|такелаж|фур[ауы]\b|поднос'),
    ('Разнорабочие', r'разнорабоч|подсоб|стройк|строител|бетон|копать|землян|демонтаж|'
                     r'кровельщ|монтаж|сварщ|маляр|штукатур|плиточ|бригад'),
]

_CITIES = [
    'новосибирск', 'москва', 'санкт-петербург', 'петербург', 'екатеринбург', 'казань',
    'нижний новгород', 'челябинск', 'омск', 'самара', 'ростов', 'уфа', 'красноярск',
    'пермь', 'воронеж', 'волгоград', 'краснодар', 'тюмень', 'барнаул', 'иркутск',
    'томск', 'кемерово', 'новокузнецк', 'сочи', 'тольятти', 'ижевск', 'ульяновск',
    'ярославль', 'хабаровск', 'владивосток', 'саратов', 'тула', 'тверь',
]

_MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн', 'июл', 'август',
           'сентябр', 'октябр', 'ноябр', 'декабр']

_NUM_WORDS = {
    'один': 1, 'одного': 1, 'одна': 1, 'два': 2, 'две': 2, 'двух': 2, 'двое': 2,
    'три': 3, 'трех': 3, 'трёх': 3, 'трое': 3, 'четыре': 4, 'четырех': 4,
    'четырёх': 4, 'четверо': 4, 'пять': 5, 'пяти': 5, 'пятеро': 5, 'шесть': 6,
    'шести': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10,
}

# Строки-заголовки, которые не годятся в название
_GENERIC = re.compile(
    r'^(?:открыта\s+вакансия|вакансия|срочно|внимание|добрый\s+день|доброе\s+утро|'
    r'добрый\s+вечер|здравствуйте|привет|всем\s+привет|ищу|работа)[!.,\s]*$',
    re.IGNORECASE)

_FIELD_RE = re.compile(r'^\s*([а-яёa-z\s]{3,20})\s*[:]\s*(.+)$', re.IGNORECASE)

# Служебные ключи построчного формата — в название не годятся
_META_KEYS = ('дата', 'время', 'адрес', 'место', 'оплата', 'ставка', 'цена',
              'телефон', 'контакт', 'график', 'локация', 'зп', 'з/п')


def _lines(text):
    return [l.strip() for l in str(text or '').splitlines() if l.strip()]


def _fields(text):
    """Собирает пары «Ключ: значение» из построчного формата."""
    out = {}
    for line in _lines(text):
        m = _FIELD_RE.match(line)
        if m:
            out[m.group(1).strip().lower()] = m.group(2).strip()
    return out


def guess_type(text):
    low = str(text or '').lower()
    for name, pattern in _TYPE_RULES:
        if re.search(pattern, low):
            return name
    return 'Другое'


_MAX_PRICE = 1000000


def _sane(value):
    return value if 0 < value <= _MAX_PRICE else 0


def guess_price(text):
    """Цена только по явному денежному маркеру: «20 тонн» и «150 кг» — не цена."""
    # Телефон вырезаем заранее, иначе «Оплата нал сразу 89137539858» даст цену
    low = _PHONE_RE.sub(' ', str(text or '').lower())
    m = re.search(r'(\d[\d\s]{0,8}\d|\d)\s*(?:тыс\.?|тысяч\w*)', low)
    if m:
        return _sane(int(re.sub(r'\s', '', m.group(1))) * 1000)
    for word, val in _NUM_WORDS.items():
        if re.search(r'\b' + word + r'\s+тысяч', low):
            return val * 1000
    m = re.search(r'(\d[\d\s]{0,8}\d|\d)\s*(?:руб|₽|р\.|р/|р\b(?!-))', low)
    if m:
        return _sane(int(re.sub(r'\s', '', m.group(1))))
    # Запасной вариант — только в пределах одной строки после слова-маркера
    m = re.search(r'(?:оплата|ставка|цена|з/п|зп|заработок)[^\d\n]{0,12}?(\d[\d\s]{2,8}\d)', low)
    if m:
        return _sane(int(re.sub(r'\s', '', m.group(1))))
    return 0


def guess_people(text):
    low = str(text or '').lower()
    unit = r'(?:чел\b|человек\w*|работник\w*|грузчик\w*|сотрудник\w*|специалист\w*)'
    m = re.search(r'(\d{1,2})\s*' + unit, low)
    if m:
        return max(1, min(50, int(m.group(1))))
    for word, val in _NUM_WORDS.items():
        if re.search(r'\b' + word + r'\s+' + unit, low):
            return val
    return 1


def guess_city(text):
    low = str(text or '').lower()
    for city in _CITIES:
        if city in low:
            return city.title()
    return ''


_PHONE_RE = re.compile(
    r'(?:\+7|\b8|\b7)[\s\-(]*(\d{3})[\s\-)]*(\d{3})[\s\-]*(\d{2})[\s\-]*(\d{2})\b')


def guess_phone(text):
    """Российский номер в любом написании. Короткие цифры (время, даты) не ловит."""
    m = _PHONE_RE.search(str(text or ''))
    if m:
        return '+7' + ''.join(m.groups())
    return ''


def guess_contact(text):
    m = re.search(r'@([a-zA-Z][a-zA-Z0-9_]{3,31})', str(text or ''))
    return m.group(1) if m else ''


_ADDR_MARKER = re.compile(
    r'\bул\.|улиц|проспект|просп\.|проезд|переул|шоссе|деревн|посёл|поселок|'
    r'мкр|микрорайон|район|\bр-н\b|метро', re.IGNORECASE)

# Сокращения, где точка не заканчивает предложение
_ABBR_RE = re.compile(r'\b(ул|д|кв|стр|корп|пр|просп|пер|ш|г|обл|мкр|пл|наб|эт)\.',
                      re.IGNORECASE)


def _split_chunks(line):
    """Режет строку на смысловые куски, не ломая «ул.» и «д. 5»."""
    protected = _ABBR_RE.sub(lambda m: m.group(1) + '\x00', line)
    parts = re.split(r'\s*[,;]\s*|\.\s+', protected)
    return [p.replace('\x00', '.').strip(' .,;') for p in parts if p.strip(' .,;')]


def guess_address(text):
    f = _fields(text)
    for key in ('адрес', 'место', 'локация', 'адрес работы', 'место работы'):
        if f.get(key):
            return f[key]
    for line in _lines(text):
        chunks = _split_chunks(line)
        for idx, chunk in enumerate(chunks):
            if not _ADDR_MARKER.search(chunk):
                continue
            # Подхватываем «д. 5», «корп. 2», «кв. 8» из соседних кусков.
            # Голое число берём только если это похоже на номер дома, а не «1500 р/смена».
            parts = [chunk]
            for tail in chunks[idx + 1:]:
                if not re.match(r'^(?:д\.|дом|кв|корп|стр|под|эт)', tail, re.IGNORECASE) \
                        and not re.match(r'^\d{1,4}[а-я]?$', tail, re.IGNORECASE):
                    break
                parts.append(tail)
            return ', '.join(parts)[:200]
    return ''


def guess_datetime(text, today=None):
    """Возвращает строку 'YYYY-MM-DDTHH:MM'. Не разобрали — завтра 09:00."""
    low = str(text or '').lower()
    today = today or datetime.date.today()
    date = None
    if re.search(r'\bсегодня\b', low):
        date = today
    elif re.search(r'\bзавтра\b', low):
        date = today + datetime.timedelta(days=1)
    if date is None:
        m = re.search(r'\b(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?\b', low)
        if m:
            day, month = int(m.group(1)), int(m.group(2))
            year = int(m.group(3) or today.year)
            if year < 100:
                year += 2000
            try:
                date = datetime.date(year, month, day)
            except ValueError:
                date = None
    if date is None:
        for idx, mon in enumerate(_MONTHS, start=1):
            m = re.search(r'\b(\d{1,2})\s*(?:[^\d]{1,3}\d{1,2}\s*)?' + mon, low)
            if m:
                try:
                    date = datetime.date(today.year, idx, int(m.group(1)))
                except ValueError:
                    date = None
                break
    if date is None:
        date = today + datetime.timedelta(days=1)

    tm = re.search(r'\b([01]?\d|2[0-3])[:.]([0-5]\d)\b', low)
    hh, mm = (int(tm.group(1)), int(tm.group(2))) if tm else (9, 0)
    return '%04d-%02d-%02dT%02d:%02d' % (date.year, date.month, date.day, hh, mm)


def guess_title(text, limit=70):
    """Первая содержательная фраза. Приветствия и шапки «ОТКРЫТА ВАКАНСИЯ» пропускаем."""
    chunks = []
    for line in _lines(text):
        m = _FIELD_RE.match(line)
        if m and m.group(1).strip().lower() in _META_KEYS:
            continue
        for part in re.split(r'[,.;]\s*', line):
            part = part.strip(' .,;!-*')
            if part:
                chunks.append(part)
    for chunk in chunks:
        if len(chunk) < 3 or _GENERIC.match(chunk):
            continue
        if len(chunk) <= limit:
            return chunk
        cut = chunk[:limit].rsplit(' ', 1)[0]
        return (cut or chunk[:limit]).rstrip(' .,;') + '…'
    first = (_lines(text) or [''])[0]
    return first[:limit] or 'Объявление'


def parse(text):
    """Полный разбор. description — исходный текст без изменений."""
    text = str(text or '').strip()
    return {
        'title': guess_title(text),
        'type': guess_type(text),
        'description': text,
        'address': guess_address(text),
        'city': guess_city(text),
        'price': guess_price(text),
        'people_count': guess_people(text),
        'datetime': guess_datetime(text),
        'phone': guess_phone(text),
        'contact': guess_contact(text),
    }
