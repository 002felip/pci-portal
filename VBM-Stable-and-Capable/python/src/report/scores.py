"""
Stability & Capability Scores (resumo do relatório consolidado e cabeçalho de cada KPI).

Fórmulas da página de resumo do "Stable & Capable Consolidated", no ano de referência do
relatório (o último ano dos dados), com uma carta X-AM do ano inteiro (CL = média do ano,
σ = amplitude móvel média ÷ 1,128):

    Stability Score (SS) = 100 × (1 − pontos fora de controle ÷ pontos − 0,3 × CV)
        pontos fora de controle = dias marcados por alguma regra de Nelson: 1) fora de CL ± 3σ;
        2) 9 pontos seguidos do mesmo lado da CL; 3) 6 pontos subindo ou descendo;
        4) 14 pontos alternando. CV = desvio padrão ÷ média do ano.

    Capability Score (CS) = 100 × pontos dentro dos limites de especificação ÷ pontos
        limites de especificação = Budget do ano ± 2σ (a "variação atual").

Conferido com o PDF de exemplo (dados até abril de 2026): a CS bate com ±1 ponto em Salobo e
Sossego, e a SS fica a poucos pontos (os dados de teste não são exatamente os do exemplo).
Os dois ficam entre 0 e 100, arredondados. Sem Budget no ano, não há CS.
"""

import numpy as np
import pandas as pd

# (mínimo, rótulo, fundo, texto) — do maior para o menor
FAIXAS_ESTABILIDADE = [
    (85, 'Very Stable', '#cdeedd', '#04764e'),
    (60, 'Stable', '#e3f4d7', '#3d7a12'),
    (40, 'Moderately Stable', '#fdf0c4', '#8a5a00'),
    (15, 'Unstable', '#fde0cc', '#b34700'),
    (0, 'Very Unstable', '#fbd5d5', '#b91c1c'),
]
FAIXAS_CAPABILIDADE = [
    (95, 'Very Capable', '#cdeedd', '#04764e'),
    (80, 'Capable', '#e3f4d7', '#3d7a12'),
    (70, 'Moderately Capable', '#fdf0c4', '#8a5a00'),
    (0, 'Incapable', '#fbd5d5', '#b91c1c'),
]
SEM_VALOR = ('—', '#eef2f6', '#5b6676')


def classificar(valor, faixas):
    """(rótulo, fundo, texto) da faixa do valor."""
    if valor is None or (isinstance(valor, float) and np.isnan(valor)):
        return SEM_VALOR
    for minimo, rotulo, fundo, texto in faixas:
        if valor >= minimo:
            return rotulo, fundo, texto
    return faixas[-1][1:]


def faixas_texto(faixas):
    """[(intervalo, rótulo, fundo, texto)] para a legenda: '85–100', '60–85', …"""
    saida, teto = [], 100
    for minimo, rotulo, fundo, texto in faixas:
        saida.append((f"{minimo}–{teto}", rotulo, fundo, texto))
        teto = minimo
    return saida


REGRA2_PONTOS = 9        # regra 2 de Nelson: pontos seguidos do mesmo lado da CL
REGRA3_PONTOS = 6        # regra 3: pontos seguidos subindo ou descendo
REGRA4_PONTOS = 14       # regra 4: pontos seguidos alternando
PESO_CV = 0.3
K_ESPECIFICACAO = 2      # limites de especificação: Budget ± K × σ


def pontos_fora_de_controle(v, cl, ucl, lcl):
    """Índices dos pontos marcados pelas regras de Nelson 1–4."""
    v = np.asarray(v, dtype=float)
    n = len(v)
    fora = set(np.where((v > ucl) | (v < lcl))[0].tolist())
    lado = np.where(v > cl, 1, -1)
    corrida = 1
    for i in range(1, n):
        corrida = corrida + 1 if lado[i] == lado[i - 1] else 1
        if corrida >= REGRA2_PONTOS:
            fora.update(range(i - REGRA2_PONTOS + 1, i + 1))
    k = REGRA3_PONTOS
    for i in range(n - k + 1):
        d = np.diff(v[i:i + k])
        if (d > 0).all() or (d < 0).all():
            fora.update(range(i, i + k))
    k = REGRA4_PONTOS
    for i in range(n - k + 1):
        d = np.diff(v[i:i + k])
        if (d[1:] * d[:-1] < 0).all():
            fora.update(range(i, i + k))
    return fora


def calcular_scores(df_kpi, ano=None):
    """Stability e Capability Score de um KPI (DataFrame com DT_REF, ACTUAL, BUDGET) no ano."""
    df = df_kpi.copy()
    df['DT_REF'] = pd.to_datetime(df['DT_REF'])
    ano = int(ano or df['DT_REF'].dt.year.max())
    do_ano = df[df['DT_REF'].dt.year == ano].sort_values('DT_REF')
    v = do_ano['ACTUAL'].dropna().to_numpy(dtype=float)
    n = len(v)
    resultado = {'ano': ano, 'n': n, 'stability': None, 'capability': None, 'fora_controle': 0, 'cv': None}
    if n < 2:
        return resultado

    cl = v.mean()
    sigma = np.abs(np.diff(v)).mean() / 1.128
    fora = pontos_fora_de_controle(v, cl, cl + 3 * sigma, cl - 3 * sigma)
    cv = float(v.std(ddof=1) / cl) if cl else 0.0
    ss = 100 * (1 - len(fora) / n - PESO_CV * abs(cv))
    resultado.update(fora_controle=len(fora), cv=cv, stability=int(round(min(100, max(0, ss)))))

    budget = do_ano['BUDGET'].dropna()
    if len(budget):
        b = float(budget.iloc[0])
        dentro = ((v >= b - K_ESPECIFICACAO * sigma) & (v <= b + K_ESPECIFICACAO * sigma)).sum()
        resultado['capability'] = int(round(100 * dentro / n))
    return resultado
