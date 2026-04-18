# 從電腦主機財產統計分析表.xlsx 抽取資料，輸出 SQL 格式
import openpyxl, json, sys, re
sys.stdout.reconfigure(encoding='utf-8')

SRC = r'D:/00資訊組2020/電腦主機財產統計分析表.xlsx'

# 非 C 代碼的地點文字 → 教室代碼
LOC_MAP = {
    '教務處': 'C208',
    '學務處': 'C206',
    '總務處': 'C204',
    '輔導室': 'C203',
    '人事會計': 'C202',
    '人事會計室': 'C202',
    '校長室': 'C205',
    '大辦公室': 'C210',
    '保健室': 'C134',
    '健康中心': 'C134',
    '校史室': 'C214',
    '圖書館': 'C301',
    '視聽器材': 'C303',
    '視聽器材室': 'C303',
    '英語教室一': 'C229',
    '英語教室二': 'C228',
    '英語教室三': 'C227',
    '音樂教室一': 'C305',
    '音樂教室二': 'C226',
    '美勞教室一': 'C231',
    '美勞教室二': 'C230',
    '知動教室': 'C117',
    '學習中心一': 'C116',
    '學習中心二': 'C118',
    '情境互動牆': 'C218',
    '情境教室': 'C218',
    '電腦教室一': 'C212',
    '電腦教室二': 'C213',
    '自然教室一': 'C312',
    '自然教室二': 'C222',
    '自然教室三': 'C119',
    '幼兒園': 'K-OFFICE',  # 預設指向辦公室，可後續調整
    '研習中心': 'C216',
    '棒球教室': 'C127',
    '桌球練習室': 'C306',
    '書法教室': 'C131',
    '國樂室': 'C110',
    '韻律教室': 'C201',
    '教師研討室': 'C219',
    '檔案室': 'C211',
    '電視台': 'C207',
    '資料室': 'C209',
    '智慧教室': 'C304',
}

def norm_code(loc):
    """將存放地點轉為教室代碼"""
    if not loc: return None, None
    s = str(loc).strip()
    # 直接 C### 格式
    m = re.match(r'^[Cc](\d{3})(-\d+)?$', s)
    if m:
        return 'C' + m.group(1), s if m.group(2) else None  # 保留副編號文字
    # 中文名稱映射
    if s in LOC_MAP:
        return LOC_MAP[s], s
    # 檢查是否包含 C###
    m2 = re.search(r'[Cc](\d{3})', s)
    if m2:
        return 'C' + m2.group(1), s
    # 無法映射，回傳原始文字
    return None, s

def parse_roc_year(purchase_date_roc, purchase_year_ad):
    """取得民國年份"""
    if purchase_year_ad:
        try: return int(purchase_year_ad) - 1911
        except: pass
    if purchase_date_roc:
        s = str(purchase_date_roc).strip()
        m = re.match(r'^(\d{2,3})[/\-\.]', s)
        if m:
            y = int(m.group(1))
            if 60 <= y <= 130: return y
    return None

def parse_roc_date(s):
    """民國日期 97/03/01 → 2008-03-01"""
    if not s: return None
    s = str(s).strip()
    m = re.match(r'^(\d{2,3})[/\-\.](\d{1,2})[/\-\.](\d{1,2})$', s)
    if m:
        y = int(m.group(1)) + 1911
        mo = int(m.group(2))
        d = int(m.group(3))
        try:
            return f'{y:04d}-{mo:02d}-{d:02d}'
        except: return None
    return None

def sql_esc(s):
    if s is None: return 'NULL'
    if isinstance(s, (int, float)): return str(s)
    return "'" + str(s).replace("'", "''") + "'"

wb = openpyxl.load_workbook(SRC, data_only=True)
ws = wb['電腦主機完整清冊']

records = []
for i, row in enumerate(ws.iter_rows(values_only=True)):
    if i < 3: continue
    if not row[1]: continue

    property_number = str(row[1]).strip()
    model_desc = row[2]
    standard_model = row[3]
    purchase_date_roc = row[4]
    purchase_year_ad = row[5]
    age = row[6]
    urgency = row[7]
    unit = row[8]
    keeper = row[9]
    location = row[10]
    price = row[11]
    status = row[12]
    notes = row[13]

    roc_year = parse_roc_year(purchase_date_roc, purchase_year_ad)
    acq_date = parse_roc_date(purchase_date_roc)
    code, loc_text = norm_code(location)

    # 品牌提取
    brand = None
    model = standard_model or model_desc
    if model:
        m_str = str(model).strip()
        for b in ['ASUS','Acer','HP','Lenovo','Dell','Apple','Microsoft','MSI','Intel','Gigabyte']:
            if m_str.lower().startswith(b.lower()) or (' '+b.lower()) in m_str.lower():
                brand = b
                break

    raw = {
        '財產序號': property_number,
        '電腦型號': str(model_desc) if model_desc else None,
        '標準化機型': str(standard_model) if standard_model else None,
        '購置日期民國': str(purchase_date_roc) if purchase_date_roc else None,
        '購置西元年': purchase_year_ad,
        '機齡': age,
        '汰換急迫性': urgency,
        '保管單位': unit,
        '保管人': keeper,
        '存放地點': location,
        '原始單價': price,
        '使用狀態': status,
        '備註': notes
    }

    rec = {
        'property_number': property_number,
        'item_name': '桌上型電腦主機',
        'brand': brand,
        'model': str(standard_model) if standard_model else str(model_desc) if model_desc else None,
        'specification': str(model_desc) if model_desc and model_desc != standard_model else None,
        'acquired_year': roc_year,
        'acquired_date': acq_date,
        'unit_price': float(price) if price else None,
        'classroom_code': code,
        'location_text': loc_text or (str(location) if location else None),
        'status': str(status).split('.')[-1].strip() if status else '在用',
        'raw_data': raw
    }
    records.append(rec)

# 輸出 SQL
with open(r'H:/computer/smes-inventory/scripts/inventory_seed.sql', 'w', encoding='utf-8') as f:
    f.write('-- 從 電腦主機財產統計分析表.xlsx 匯入的財產資料\n')
    f.write(f'-- 總筆數: {len(records)}\n\n')
    f.write('INSERT INTO inventory_items (property_number, item_name, brand, model, specification, acquired_year, acquired_date, unit_price, classroom_code, location_text, status, raw_data) VALUES\n')
    vals = []
    for r in records:
        v = (
            f"({sql_esc(r['property_number'])}, "
            f"{sql_esc(r['item_name'])}, "
            f"{sql_esc(r['brand'])}, "
            f"{sql_esc(r['model'])}, "
            f"{sql_esc(r['specification'])}, "
            f"{sql_esc(r['acquired_year'])}, "
            f"{sql_esc(r['acquired_date'])}, "
            f"{sql_esc(r['unit_price'])}, "
            f"{sql_esc(r['classroom_code'])}, "
            f"{sql_esc(r['location_text'])}, "
            f"{sql_esc(r['status'])}, "
            f"{sql_esc(json.dumps(r['raw_data'], ensure_ascii=False))}::jsonb)"
        )
        vals.append(v)
    f.write(',\n'.join(vals) + ';\n')

# 統計
mapped = sum(1 for r in records if r['classroom_code'])
print(f'✅ 轉換完成: {len(records)} 筆')
print(f'   有對應教室代碼: {mapped}')
print(f'   無代碼(僅文字): {len(records) - mapped}')
print(f'   SQL 輸出到: scripts/inventory_seed.sql')

# 列出未對應的地點樣本
unmapped = set()
for r in records:
    if not r['classroom_code'] and r['location_text']:
        unmapped.add(r['location_text'])
print()
print('未能自動對應的地點:')
for u in sorted(unmapped):
    print('  -', u)
