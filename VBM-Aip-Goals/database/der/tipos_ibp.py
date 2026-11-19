"""Mostra no DER os tipos do Azure SQL (esquema IBP) em vez dos do PostgreSQL de teste.
Lê os tipos declarados no modelo.sql e reescreve schema.json; formata data-hora dos exemplos (datetime2 sem fuso).
Uso: python3 tipos_ibp.py  (depois de exportar schema.json e exemplos.json)"""
import json, re
MAPA = {'integer': 'int', 'timestamp(0)': 'datetime2(0)', 'text': 'nvarchar(max)', 'numeric(6,2)': 'decimal(6,2)'}
ddl, tab = {}, None
for ln in open('modelo.sql'):
    m = re.match(r'create table (\w+) \(', ln)
    if m: tab = m.group(1).upper(); continue
    m = re.match(r'\s+([a-z_]+) ([a-z]+(?:\(\d+(?:,\d+)?\))?)', ln)
    if tab and m and m.group(1) not in ('constraint', 'primary'):
        ddl[(tab, m.group(1).upper())] = MAPA.get(m.group(2), m.group(2))
s = json.load(open('schema.json'))
dt = set()
for t in s['tables']:
    for c in t['cols']:
        c['ty'] = ddl.get((t['name'], c['n']), c['ty'])
        if c['ty'].startswith('datetime'): dt.add((t['name'], c['n'].lower()))
json.dump(s, open('schema.json', 'w'), ensure_ascii=False)
e = json.load(open('exemplos.json'))
for t, linhas in e.items():
    for r in linhas:
        for k, v in r.items():
            if (t, k) in dt and isinstance(v, str) and 'T' in v:
                r[k] = f'{v[8:10]}/{v[5:7]}/{v[:4]} {v[11:16]}'
json.dump(e, open('exemplos.json', 'w'), ensure_ascii=False)
print('ok', len(dt), 'campos data-hora')
