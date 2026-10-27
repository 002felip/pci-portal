"""
Funções de Controle Estatístico de Processo (CEP)
Implementa cartas de controle X-Am e análise de capabilidade
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional
from scipy import stats


def calculate_xam_limits(data: pd.Series, window: int = 2) -> Dict[str, float]:
    """
    Calcula os limites de controle para carta X-Am (Amplitude Móvel)
    
    Parameters:
    -----------
    data : pd.Series
        Série de dados do processo (valores individuais)
    window : int, default=2
        Tamanho da janela para cálculo da amplitude móvel
    
    Returns:
    --------
    dict : Dicionário com limites de controle
        - CL: Linha central (média)
        - UCL: Limite superior de controle
        - LCL: Limite inferior de controle
        - Am_mean: Média das amplitudes móveis
        - sigma: Estimativa do desvio padrão
    """
    # Remove valores nulos
    data_clean = data.dropna()
    
    if len(data_clean) < 2:
        raise ValueError("Dados insuficientes para cálculo de limites de controle")
    
    # Linha central (média dos valores)
    cl = data_clean.mean()
    
    # Calcular amplitudes móveis (diferença absoluta entre observações consecutivas)
    am = np.abs(data_clean.diff(periods=window-1)).dropna()
    am_mean = am.mean()
    
    # Constante d2 para estimativa de sigma (depende do tamanho da janela)
    # Para n=2: d2=1.128
    d2_values = {2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326}
    d2 = d2_values.get(window, 1.128)
    
    # Estimativa do desvio padrão
    sigma = am_mean / d2
    
    # Limites de controle (3 sigma)
    ucl = cl + 3 * sigma
    lcl = cl - 3 * sigma
    
    # Limites para carta Am
    # D4 para n=2: 3.267
    d4_values = {2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114}
    d4 = d4_values.get(window, 3.267)
    
    am_ucl = am_mean * d4
    am_lcl = 0  # Sempre zero para amplitudes
    
    return {
        'CL': cl,
        'UCL': ucl,
        'LCL': lcl,
        'Am_mean': am_mean,
        'Am_UCL': am_ucl,
        'Am_LCL': am_lcl,
        'sigma': sigma,
        'd2': d2,
        'd4': d4
    }


def calculate_zones(cl: float, sigma: float) -> Dict[str, Tuple[float, float]]:
    """
    Calcula as zonas A, B e C para aplicação das Western Electric Rules
    
    Parameters:
    -----------
    cl : float
        Linha central
    sigma : float
        Desvio padrão estimado
    
    Returns:
    --------
    dict : Dicionário com limites das zonas
    """
    return {
        'C_upper': (cl, cl + sigma),
        'C_lower': (cl - sigma, cl),
        'B_upper': (cl + sigma, cl + 2*sigma),
        'B_lower': (cl - 2*sigma, cl - sigma),
        'A_upper': (cl + 2*sigma, cl + 3*sigma),
        'A_lower': (cl - 3*sigma, cl - 2*sigma)
    }


def detect_control_violations(data: pd.Series, limits: Dict[str, float]) -> Dict[str, List[int]]:
    """
    Detecta violações das 8 Western Electric Rules
    
    Parameters:
    -----------
    data : pd.Series
        Série de dados do processo
    limits : dict
        Dicionário com limites de controle (retornado por calculate_xam_limits)
    
    Returns:
    --------
    dict : Dicionário com listas de índices violando cada regra
    """
    data_clean = data.dropna()
    original_indices = data_clean.index.tolist()
    data_values = data_clean.reset_index(drop=True)
    
    cl = limits['CL']
    sigma = limits['sigma']
    ucl = limits['UCL']
    lcl = limits['LCL']
    
    zones = calculate_zones(cl, sigma)
    violations = {f'rule_{i}': [] for i in range(1, 9)}
    
    # Regra 1: Um ponto além de 3σ (fora de UCL ou LCL)
    for i, val in enumerate(data_values):
        if val > ucl or val < lcl:
            violations['rule_1'].append(i)
    
    # Regra 2: 9 pontos consecutivos no mesmo lado da linha central
    for i in range(8, len(data_values)):
        window = data_values[i-8:i+1]
        if all(window > cl) or all(window < cl):
            violations['rule_2'].extend(range(i-8, i+1))
    
    # Regra 3: 6 pontos consecutivos em tendência (crescente ou decrescente)
    for i in range(5, len(data_values)):
        window = data_values[i-5:i+1]
        diffs = window.diff().dropna()
        if all(diffs > 0) or all(diffs < 0):
            violations['rule_3'].extend(range(i-5, i+1))
    
    # Regra 4: 14 pontos consecutivos alternando para cima e para baixo
    for i in range(13, len(data_values)):
        window = data_values[i-13:i+1]
        diffs = window.diff().dropna()
        signs = np.sign(diffs).reset_index(drop=True)
        alternating = all(signs.iloc[j] != signs.iloc[j+1] for j in range(len(signs)-1) if signs.iloc[j] != 0 and signs.iloc[j+1] != 0)
        if alternating:
            violations['rule_4'].extend(range(i-13, i+1))
    
    # Regra 5: 2 de 3 pontos consecutivos na zona A (além de 2σ)
    for i in range(2, len(data_values)):
        window = data_values[i-2:i+1]
        in_zone_a = sum((val > cl + 2*sigma) or (val < cl - 2*sigma) for val in window)
        if in_zone_a >= 2:
            violations['rule_5'].extend(range(i-2, i+1))
    
    # Regra 6: 4 de 5 pontos consecutivos na zona B ou além (além de 1σ)
    for i in range(4, len(data_values)):
        window = data_values[i-4:i+1]
        in_zone_b_or_beyond = sum((val > cl + sigma) or (val < cl - sigma) for val in window)
        if in_zone_b_or_beyond >= 4:
            violations['rule_6'].extend(range(i-4, i+1))
    
    # Regra 7: 15 pontos consecutivos na zona C (dentro de 1σ em ambos os lados)
    for i in range(14, len(data_values)):
        window = data_values[i-14:i+1]
        all_in_zone_c = all((val <= cl + sigma) and (val >= cl - sigma) for val in window)
        if all_in_zone_c:
            violations['rule_7'].extend(range(i-14, i+1))
    
    # Regra 8: 8 pontos consecutivos em ambos os lados sem nenhum na zona C
    for i in range(7, len(data_values)):
        window = data_values[i-7:i+1]
        none_in_zone_c = all((val > cl + sigma) or (val < cl - sigma) for val in window)
        if none_in_zone_c:
            violations['rule_8'].extend(range(i-7, i+1))
    
    # Remover duplicatas mantendo ordem e converter para índices originais
    for rule in violations:
        violations[rule] = sorted([original_indices[i] for i in set(violations[rule])])
    
    return violations


def check_process_stability(violations: Dict[str, List[int]], total_points: int) -> Tuple[bool, Dict[str, any]]:
    """
    Verifica se o processo está sob controle estatístico
    
    Parameters:
    -----------
    violations : dict
        Dicionário de violações (retornado por detect_control_violations)
    total_points : int
        Número total de pontos na série
    
    Returns:
    --------
    tuple : (is_stable, stats_dict)
        - is_stable: True se processo está sob controle
        - stats_dict: Estatísticas sobre violações
    """
    # Considerar apenas as regras 1 a 4 para avaliação de estabilidade
    relevant_rules = ['rule_1', 'rule_2', 'rule_3', 'rule_4']
    relevant_violations = {k: v for k, v in violations.items() if k in relevant_rules}
    
    total_violations = sum(len(v) for v in relevant_violations.values())
    unique_violations = len(set(idx for v in relevant_violations.values() for idx in v))
    
    # Contagem por regra (mantém todas as regras para informação)
    rule_counts = {rule: len(indices) for rule, indices in violations.items()}
    
    # Calcular percentual de violações
    percent_violations = (unique_violations / total_points * 100) if total_points > 0 else 0
    
    # Processo considerado estável se não houver violações nas regras 1-4
    is_stable = total_violations == 0
    
    stats = {
        'is_stable': is_stable,
        'total_violations': total_violations,
        'unique_violations': unique_violations,
        'percent_violations': percent_violations,
        'rule_counts': rule_counts,
        'total_points': total_points
    }
    
    return is_stable, stats


def calculate_capability_indices(data: pd.Series, lsl: float, usl: float, 
                                 sigma: Optional[float] = None) -> Dict[str, float]:
    """
    Calcula índices de capabilidade do processo
    
    Parameters:
    -----------
    data : pd.Series
        Série de dados do processo
    lsl : float
        Lower Specification Limit (Limite Inferior de Especificação)
    usl : float
        Upper Specification Limit (Limite Superior de Especificação)
    sigma : float, optional
        Desvio padrão estimado. Se None, calcula da amplitude móvel
    
    Returns:
    --------
    dict : Índices de capabilidade e interpretações
    """
    data_clean = data.dropna()
    
    if len(data_clean) < 2:
        raise ValueError("Dados insuficientes para cálculo de capabilidade")
    
    # Média do processo
    mean = data_clean.mean()
    
    # Desvio padrão
    if sigma is None:
        # Estimar sigma através da amplitude móvel
        am = np.abs(data_clean.diff()).dropna()
        sigma = am.mean() / 1.128
    
    # Desvio padrão total (para Pp e Ppk)
    sigma_total = data_clean.std()
    
    # Cp - Capacidade Potencial (assume centralização perfeita)
    cp = (usl - lsl) / (6 * sigma) if sigma > 0 else 0
    
    # Cpk - Capacidade Real (considera descentramento)
    cpu = (usl - mean) / (3 * sigma) if sigma > 0 else 0
    cpl = (mean - lsl) / (3 * sigma) if sigma > 0 else 0
    cpk = min(cpu, cpl)
    
    # Pp - Performance Potencial (usa desvio padrão total)
    pp = (usl - lsl) / (6 * sigma_total) if sigma_total > 0 else 0
    
    # Ppk - Performance Real (usa desvio padrão total)
    ppu = (usl - mean) / (3 * sigma_total) if sigma_total > 0 else 0
    ppl = (mean - lsl) / (3 * sigma_total) if sigma_total > 0 else 0
    ppk = min(ppu, ppl)
    
    # Centro da especificação e descentramento
    target = (usl + lsl) / 2
    offset = mean - target
    offset_percent = (offset / ((usl - lsl) / 2)) * 100 if (usl - lsl) > 0 else 0
    
    # Capability classification
    def classify_capability(index_value):
        if index_value >= 1.67:
            return "Excellent"
        elif index_value >= 1.33:
            return "Capable"
        elif index_value >= 1.0:
            return "Adequate"
        else:
            return "Not Capable"
    
    # Interpretação
    interpretation = []
    if cp < 1.0:
        interpretation.append(f"Processo incapaz: variação excede especificação em {((1/cp - 1) * 100):.1f}%")
    if cpk < cp:
        interpretation.append(f"Descentramento reduz capabilidade em {((cp - cpk) / cp * 100):.1f}%")
    if abs(offset_percent) > 10:
        interpretation.append(f"Processo descentrado {abs(offset_percent):.1f}% do target")
    
    return {
        'Cp': cp,
        'Cpk': cpk,
        'Pp': pp,
        'Ppk': ppk,
        'Cpu': cpu,
        'Cpl': cpl,
        'mean': mean,
        'sigma': sigma,
        'sigma_total': sigma_total,
        'target': target,
        'offset': offset,
        'offset_percent': offset_percent,
        'Cp_class': classify_capability(cp),
        'Cpk_class': classify_capability(cpk),
        'Pp_class': classify_capability(pp),
        'Ppk_class': classify_capability(ppk),
        'interpretation': interpretation
    }


def test_normality(data: pd.Series) -> Dict[str, any]:
    """
    Testa normalidade dos dados usando Kolmogorov-Smirnov
    
    Parameters:
    -----------
    data : pd.Series
        Série de dados do processo
    
    Returns:
    --------
    dict : Resultados do teste de normalidade
    """
    data_clean = data.dropna()
    
    if len(data_clean) < 3:
        return {
            'is_normal': None,
            'statistic': None,
            'p_value': None,
            'message': 'Dados insuficientes para teste de normalidade'
        }
    
    # Teste Kolmogorov-Smirnov
    # Primeiro, padronizamos os dados para comparar com a distribuição normal padrão
    mean = data_clean.mean()
    std = data_clean.std()
    
    # Teste K-S comparando com distribuição normal
    statistic, p_value = stats.kstest(data_clean, lambda x: stats.norm.cdf(x, loc=mean, scale=std))
    
    is_normal = p_value > 0.05
    
    message = (
        f"p-value = {p_value:.4f}. "
        f"{'Data follows normal distribution' if is_normal else 'Data does not follow normal distribution'} "
        f"(α=0.05). "
        f"{'Data normality is essential to ensure accuracy of capability indices (Cp/Cpk/Pp/Ppk).' if not is_normal else 'Data appropriate for capability analysis.'}"
    )
    
    return {
        'is_normal': is_normal,
        'statistic': statistic,
        'p_value': p_value,
        'message': message
    }
