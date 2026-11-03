#!/usr/bin/env python
"""
Importação do PCI Master -> linhas da IBP.PEDRAVISAODIARIA.

Mesma lógica do mapeamento.py (Colab) usado até aqui, sem upload/download:
para cada linha da planilha de mapeamento, pega a coluna do PCI Master,
filtra o mês/ano escolhido, divide por 100 quando "Dividir por 100?" = S e
gera uma linha por dia com VL_REAL (VL_D30/VL_CS/VL_PD/VL_PROJ = 0).

Formatos de mapeamento aceitos:
  · NM_TABELA            nome da coluna; a ABA é descoberta pelo cabeçalho
                         (prefere a aba da BU à "Consolidated Table", que só
                         repete as colunas por fórmula)
  · NM_ABA + NM_CAMPO    formato do mapeamento.py original

Uso:
  python importar_pci_master.py --master PCI.xlsx --mapeamento mapa.xlsx \
      --ano 2026 --mes 7 --saida-xlsx resultado.xlsx --saida-json previa.json

Saída JSON: { periodo, linhas[], campos[], avisos[] }. Código de saída 0 mesmo
com avisos; != 0 só em erro que impede o processamento (mensagem no stderr).
"""

import argparse
import calendar
import json
import sys

import openpyxl
import pandas as pd

COLUNAS_SAIDA = ["DT_REF", "ID_SISTEMA", "ID_SITE", "ID_OPERACAO", "ID_KPI",
                 "VL_D30", "VL_CS", "VL_PD", "VL_REAL", "VL_PROJ"]
CHAVE = ["DT_REF", "ID_SISTEMA", "ID_SITE", "ID_OPERACAO", "ID_KPI"]
ABA_ESPELHO = "consolidated table"


def falhar(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)


def cabecalhos(caminho):
    """{aba: [colunas]} lendo só a 1ª linha de cada aba (rápido mesmo em arquivo grande)."""
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    try:
        out = {}
        for ws in wb.worksheets:
            linha = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), ())
            out[ws.title] = [str(c).strip() for c in linha if c is not None]
        return out
    finally:
        wb.close()


def ler_mapeamento(caminho):
    mapa = pd.read_excel(caminho)
    mapa.columns = mapa.columns.astype(str).str.strip()
    obrig = ["ID_SISTEMA", "ID_SITE", "ID_OPERACAO", "ID_KPI"]
    faltando = [c for c in obrig if c not in mapa.columns]
    if faltando:
        falhar(f"Mapeamento sem as colunas: {', '.join(faltando)}")
    if "NM_TABELA" not in mapa.columns and not {"NM_CAMPO", "NM_ABA"} <= set(mapa.columns):
        falhar("Mapeamento precisa de NM_TABELA (ou NM_ABA + NM_CAMPO).")
    col_div = next((c for c in mapa.columns if c.lower().startswith("dividir")), None)
    mapa["_dividir"] = mapa[col_div].astype(str).str.strip().str.upper().eq("S") if col_div else False
    return mapa


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", required=True)
    ap.add_argument("--mapeamento", required=True)
    ap.add_argument("--ano", type=int, required=True)
    ap.add_argument("--mes", type=int, required=True)
    ap.add_argument("--saida-xlsx", required=True)
    ap.add_argument("--saida-json", required=True)
    a = ap.parse_args()
    if not 1 <= a.mes <= 12:
        falhar("Mês inválido.")

    try:
        heads = cabecalhos(a.master)
    except Exception as exc:  # arquivo corrompido, não é xlsx, etc.
        falhar(f"Não foi possível abrir o PCI Master: {exc}")
    mapa = ler_mapeamento(a.mapeamento)
    avisos = []

    # 1. Onde está cada campo
    planos = []  # (linha do mapa, campo, aba)
    for _, l in mapa.iterrows():
        if "NM_ABA" in mapa.columns and "NM_CAMPO" in mapa.columns and pd.notna(l.get("NM_ABA")):
            campo, aba = str(l["NM_CAMPO"]).strip(), str(l["NM_ABA"]).strip()
            if aba not in heads:
                avisos.append({"campo": campo, "tipo": "aba-ausente", "msg": f"Aba '{aba}' não encontrada."})
                continue
        else:
            campo = str(l["NM_TABELA"]).strip()
            abas = [n for n, cols in heads.items() if campo in cols and "Date" in cols]
            if not abas:
                avisos.append({"campo": campo, "tipo": "campo-ausente", "msg": "Coluna não encontrada em nenhuma aba com 'Date'."})
                continue
            proprias = [n for n in abas if n.strip().lower() != ABA_ESPELHO]
            aba = (proprias or abas)[0]
            if len(proprias) > 1:
                avisos.append({"campo": campo, "tipo": "ambiguo", "msg": f"Coluna em várias abas ({', '.join(proprias)}); usada '{aba}'."})
        if campo not in heads[aba]:
            avisos.append({"campo": campo, "tipo": "campo-ausente", "msg": f"Coluna não encontrada na aba '{aba}'."})
            continue
        if "Date" not in heads[aba]:
            avisos.append({"campo": campo, "tipo": "sem-date", "msg": f"Aba '{aba}' não possui a coluna 'Date'."})
            continue
        planos.append((l, campo, aba))

    # 2. Lê só as abas necessárias
    abas_df = {}
    if planos:
        lidas = pd.read_excel(a.master, sheet_name=sorted({p[2] for p in planos}))
        for nome, df in lidas.items():
            df.columns = df.columns.astype(str).str.strip()
            df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
            abas_df[nome] = df[(df["Date"].dt.year == a.ano) & (df["Date"].dt.month == a.mes)]

    dias_mes = calendar.monthrange(a.ano, a.mes)[1]
    linhas, campos = [], []
    for l, campo, aba in planos:
        df = abas_df[aba]
        valores = pd.to_numeric(df[campo], errors="coerce")
        if bool(l["_dividir"]):
            valores = valores / 100
        n = 0
        soma = 0.0
        for data, valor in zip(df["Date"], valores):
            if pd.isna(data) or pd.isna(valor):
                continue
            linhas.append({
                "DT_REF": data.date().isoformat(),
                "ID_SISTEMA": int(l["ID_SISTEMA"]), "ID_SITE": int(l["ID_SITE"]),
                "ID_OPERACAO": int(l["ID_OPERACAO"]), "ID_KPI": int(l["ID_KPI"]),
                "VL_D30": 0, "VL_CS": 0, "VL_PD": 0, "VL_REAL": float(valor), "VL_PROJ": 0,
            })
            n += 1
            soma += float(valor)
        campos.append({
            "campo": campo, "aba": aba,
            "ID_SISTEMA": int(l["ID_SISTEMA"]), "ID_SITE": int(l["ID_SITE"]),
            "ID_OPERACAO": int(l["ID_OPERACAO"]), "ID_KPI": int(l["ID_KPI"]),
            "dividir100": bool(l["_dividir"]), "dias": n, "diasMes": dias_mes,
            "media": (soma / n) if n else None,
        })
        if n == 0:
            avisos.append({"campo": campo, "tipo": "sem-dados", "msg": f"Nenhum dado em {a.mes:02d}/{a.ano}."})
        elif n < dias_mes:
            avisos.append({"campo": campo, "tipo": "incompleto", "msg": f"{n} de {dias_mes} dias com dado."})

    # Chave repetida (dois campos do mapeamento no mesmo site/operação/KPI) = erro de mapeamento
    df_out = pd.DataFrame(linhas, columns=COLUNAS_SAIDA)
    if not df_out.empty:
        dup = df_out[df_out.duplicated(CHAVE, keep=False)]
        if not dup.empty:
            chaves = dup[["ID_SISTEMA", "ID_SITE", "ID_OPERACAO", "ID_KPI"]].drop_duplicates().to_dict("records")
            falhar("Mapeamento com chave repetida (mesmo sistema/site/operação/KPI em mais de um campo): "
                   + "; ".join(f"{c['ID_SISTEMA']}/{c['ID_SITE']}/{c['ID_OPERACAO']}/{c['ID_KPI']}" for c in chaves))
        df_out = df_out.sort_values(CHAVE).reset_index(drop=True)

    # resultado.xlsx — o mesmo arquivo que antes era subido à mão
    saida = df_out.copy()
    saida["DT_REF"] = pd.to_datetime(saida["DT_REF"]).dt.date
    saida.to_excel(a.saida_xlsx, index=False)

    with open(a.saida_json, "w", encoding="utf-8") as f:
        json.dump({"periodo": {"ano": a.ano, "mes": a.mes, "dias": dias_mes},
                   "linhas": df_out.to_dict("records"), "campos": campos, "avisos": avisos}, f, ensure_ascii=False)
    print(f"ok: {len(df_out)} linhas, {len(campos)} campos, {len(avisos)} avisos")


if __name__ == "__main__":
    main()
