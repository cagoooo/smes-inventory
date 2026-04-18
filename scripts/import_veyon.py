# 解析 Veyon JSON + 2025班級電腦.xls 的軟體資產 → 產出 network_devices 的 INSERT SQL
import json, re, sys, xlrd
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

JSON_PATH = r'C:\Users\smes\Downloads\veyon.json'
XLS_PATH = r'H:\computer\smes-inventory\scripts\classes.xls'

# ---------- 1. 軟體資產：按 PC-n 聚合 ----------
soft_by_pc = {}
try:
    wb = xlrd.open_workbook(XLS_PATH)
    ws = wb.sheet_by_name('軟體資產')
    for r in range(1, ws.nrows):
        pc = ws.cell_value(r, 0)
        sw = ws.cell_value(r, 1)
        if pc and sw:
            soft_by_pc.setdefault(pc, []).append(sw)
    # 硬體資產：PC → MAC/IP 對應
    hw_map = {}  # IP → PC-N
    ws2 = wb.sheet_by_name('硬體資產')
    for r in range(1, ws2.nrows):
        pc = ws2.cell_value(r, 0)
        mac = ws2.cell_value(r, 1)
        ip = ws2.cell_value(r, 2)
        if ip:
            hw_map[ip] = pc
    print(f'📦 Excel 軟體資產: {len(soft_by_pc)} 台 PC，共 {sum(len(v) for v in soft_by_pc.values())} 筆軟體')
    print(f'📦 Excel 硬體對應: {len(hw_map)} 筆 IP→PC')
except Exception as e:
    print(f'⚠️ 讀 Excel 失敗: {e}')

# ---------- 2. 解析 Veyon JSON ----------
with open(JSON_PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)

devices = data['BuiltinDirectory']['NetworkObjects']['JsonStoreArray']
groups = {d['Uid']: d['Name'] for d in devices if d.get('Type') == 2}

def infer_classroom_code(name, group):
    m = re.match(r'^C(\d{3})', name)
    if m: return 'C' + m.group(1)
    if '幼兒園' in name or 'Rainbow' in name or 'Bubble' in name:
        if 'Rainbow' in name: return 'K-RAINBOW'
        if 'Bubble' in name: return 'K-BUBBLE'
        return 'K-OFFICE'
    if group == '113-SMES': return 'C212'
    if group == '109-SMES': return 'C213'
    return None

def infer_role(name, group):
    if group in ('109-SMES', '113-SMES'):
        return 'computer_lab_teacher' if 'Teacher' in name else 'computer_lab_student'
    if group == '全校班級電腦':
        if 'Phantosys' in name: return 'server'
        if re.search(r'public|-\d+$', name): return 'classroom_public'
        return 'classroom_teacher'
    if group == '@行政':
        return 'admin_office'
    if group == '移動觸屏':
        return 'mobile_touch'
    return 'unknown'

def infer_segment(ip):
    if not ip: return None
    if ip.startswith('10.44'): return '10.44 (電腦教室)'
    if ip.startswith('10.36'): return '10.36 (教學行政)'
    if ip.startswith('10.66'): return '10.66 (無線/移動)'
    return 'other'

def sql_esc(s):
    if s is None: return 'NULL'
    if isinstance(s, (int, float)): return str(s)
    if isinstance(s, bool): return 'TRUE' if s else 'FALSE'
    return "'" + str(s).replace("'", "''") + "'"

rows = []
pc_counter_109 = 0  # 電腦二
pc_counter_113 = 0  # 電腦一
total_soft_matched = 0

for d in devices:
    if d.get('Type') != 3:
        continue
    name = d['Name']
    host = d.get('HostAddress') or None
    mac = d.get('MacAddress', '')
    if mac:
        mac = mac.upper().replace(':', '-')
    group = groups.get(d.get('ParentUid'), 'Unknown')
    uid = d['Uid'].strip('{}')

    code = infer_classroom_code(name, group)
    role = infer_role(name, group)
    seg = infer_segment(host)

    # 對應軟體資產 (只有 109/113 電腦教室 PC 有 Excel 資料)
    sw_list = []
    if host in hw_map:
        pc = hw_map[host]
        sw_list = soft_by_pc.get(pc, [])
        if sw_list:
            total_soft_matched += 1

    rows.append({
        'veyon_uid': uid,
        'name': name,
        'host_address': host,
        'mac_address': mac if mac else None,
        'group_name': group,
        'device_role': role,
        'network_segment': seg,
        'classroom_code': code,
        'software_list': sw_list,
    })

print(f'🖥️  Veyon 裝置: {len(rows)} 台')
print(f'🔗 有軟體清單對應: {total_soft_matched} 台')

# 分類統計
from collections import Counter
roles = Counter(r['device_role'] for r in rows)
segs = Counter(r['network_segment'] for r in rows)
print('\n📊 角色分佈:')
for k, v in roles.most_common():
    print(f'  {k}: {v}')
print('\n📊 網段分佈:')
for k, v in segs.most_common():
    print(f'  {k}: {v}')

# 檢查 classroom_code 有效性
valid_codes = {
    'C101','C102','C103','C104','C105','C106','C107','C108','C109','C110','C111','C112','C113','C114',
    'C116','C117','C118','C119','C120','C121','C122','C123','C124','C125','C127','C128','C129','C130',
    'C131','C132','C133','C134','C135','C136',
    'C201','C202','C203','C204','C205','C206','C207','C208','C209','C210','C211','C212','C213','C214',
    'C216','C217','C218','C219','C220','C221','C222','C223','C224','C225','C226','C227','C228','C229',
    'C230','C231','C232','C233','C234',
    'C301','C302','C303','C304','C305','C306','C307','C308','C309','C310','C312','C313','C314',
    'K-BUBBLE','K-RAINBOW','K-OFFICE'
}
invalid = [r for r in rows if r['classroom_code'] and r['classroom_code'] not in valid_codes]
if invalid:
    print(f'\n⚠️ 無效教室代碼 {len(invalid)} 筆:')
    for r in invalid[:5]:
        print(f'  {r["name"]} → {r["classroom_code"]}')

# ---------- 3. 輸出 SQL ----------
sql_path = Path(r'H:\computer\smes-inventory\scripts\network_devices_seed.sql')
with open(sql_path, 'w', encoding='utf-8') as f:
    f.write('-- 從 Veyon JSON + 2025班級電腦.xls 軟體資產匯入\n')
    f.write(f'-- 共 {len(rows)} 筆設備\n\n')
    f.write('INSERT INTO network_devices (veyon_uid, name, host_address, mac_address, group_name, device_role, network_segment, classroom_code, software_list) VALUES\n')
    vals = []
    for r in rows:
        code = r['classroom_code'] if r['classroom_code'] in valid_codes else None
        vals.append(
            f"({sql_esc(r['veyon_uid'])}::uuid, "
            f"{sql_esc(r['name'])}, "
            f"{sql_esc(r['host_address'])}"+ ('::inet' if r['host_address'] else '') + ", "
            f"{sql_esc(r['mac_address'])}, "
            f"{sql_esc(r['group_name'])}, "
            f"{sql_esc(r['device_role'])}, "
            f"{sql_esc(r['network_segment'])}, "
            f"{sql_esc(code)}, "
            f"{sql_esc(json.dumps(r['software_list'], ensure_ascii=False))}::jsonb)"
        )
    f.write(',\n'.join(vals) + '\nON CONFLICT (veyon_uid) DO UPDATE SET\n')
    f.write('  name = EXCLUDED.name,\n')
    f.write('  host_address = EXCLUDED.host_address,\n')
    f.write('  mac_address = EXCLUDED.mac_address,\n')
    f.write('  group_name = EXCLUDED.group_name,\n')
    f.write('  device_role = EXCLUDED.device_role,\n')
    f.write('  network_segment = EXCLUDED.network_segment,\n')
    f.write('  classroom_code = EXCLUDED.classroom_code,\n')
    f.write('  software_list = EXCLUDED.software_list,\n')
    f.write('  last_veyon_sync = now(),\n')
    f.write('  updated_at = now();\n')

print(f'\n💾 SQL 輸出: {sql_path}')
print(f'   檔案大小: {sql_path.stat().st_size // 1024} KB')
