"""
Funções para carregamento e validação de dados
"""

import pandas as pd
import numpy as np
from typing import Optional, Tuple
from pathlib import Path


def load_excel_data(file_path: str, sheet_name: str = 'base') -> pd.DataFrame:
    """
    Carrega e valida dados do arquivo Excel
    
    Parameters:
    -----------
    file_path : str
        Caminho para o arquivo Excel
    sheet_name : str, default='base'
        Nome da planilha a ser carregada
    
    Returns:
    --------
    pd.DataFrame : DataFrame validado
    
    Raises:
    -------
    FileNotFoundError : Se arquivo não existir
    ValueError : Se validação falhar
    """
    # Verificar se arquivo existe
    if not Path(file_path).exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {file_path}")
    
    # Carregar dados
    try:
        df = pd.read_excel(file_path, sheet_name=sheet_name)
    except Exception as e:
        raise ValueError(f"Erro ao ler arquivo Excel: {str(e)}")
    
    # Validar schema - colunas obrigatórias
    required_columns = ['NM_REGIAOGLOBAL', 'NM_PAIS', 'TYPE OPERATION', 'BUSINESS UNIT', 'NAME SITE', 'NAME KPI','UNIT', 'DT_REF', 'ACTUAL', 'BUDGET']
    missing_columns = [col for col in required_columns if col not in df.columns]
    
    if missing_columns:
        raise ValueError(f"Colunas obrigatórias ausentes: {', '.join(missing_columns)}")
    
    # Remover espaços em branco extras das colunas de texto
    for col in ['NM_REGIAOGLOBAL', 'NM_PAIS', 'BUSINESS UNIT', 'TYPE OPERATION', 'NAME SITE', 'NAME KPI', 'UNIT']:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
    
    # Normalize site names
    if 'NAME SITE' in df.columns:
        df['NAME SITE'] = df['NAME SITE'].str.replace('Salobo I e II', 'Salobo I&II', regex=False)
        df['NAME SITE'] = df['NAME SITE'].str.replace('Copper Cliff | CCNR', 'Copper Cliff', regex=False)
        df['NAME SITE'] = df['NAME SITE'].str.replace('Clydach | CNR', 'Clydach', regex=False)
        df['NAME SITE'] = df['NAME SITE'].str.replace('Matsusaka | Tonimet', 'Matsusaka Tonimet', regex=False)
    
    # Validar e converter tipos de dados
    validation_errors = []
    
    # Converter DT_REF para datetime
    try:
        df['DT_REF'] = pd.to_datetime(df['DT_REF'])
    except Exception as e:
        validation_errors.append(f"Erro ao converter coluna 'DT_REF' para datetime: {str(e)}")
    
    # Validar ACTUAL como numérico
    try:
        df['ACTUAL'] = pd.to_numeric(df['ACTUAL'], errors='coerce')
    except Exception as e:
        validation_errors.append(f"Erro ao converter coluna 'ACTUAL' para numérico: {str(e)}")
    
    # Validar BUDGET como numérico
    try:
        df['BUDGET'] = pd.to_numeric(df['BUDGET'], errors='coerce')
    except Exception as e:
        validation_errors.append(f"Erro ao converter coluna 'BUDGET' para numérico: {str(e)}")
    
    # Verificar valores nulos em colunas críticas
    critical_columns = ['TYPE OPERATION', 'NAME SITE', 'NAME KPI', 'DT_REF']
    null_counts = df[critical_columns].isnull().sum()
    
    for col in critical_columns:
        if null_counts[col] > 0:
            validation_errors.append(f"Coluna '{col}' contém {null_counts[col]} valores nulos")
    
    if validation_errors:
        raise ValueError("Erros de validação encontrados:\n" + "\n".join(f"  • {err}" for err in validation_errors))
    
    # Transformar unidades
    df['UNIT'] = df['UNIT'].replace({'%': '%/day', 't': 'tonnes/day'})
    
    # Validação bem-sucedida
    print(f"✓ Dados carregados com sucesso: {len(df)} registros")
    print(f"✓ Colunas: {', '.join(df.columns)}")
    print(f"✓ Período: {df['DT_REF'].min()} até {df['DT_REF'].max()}")
    print(f"✓ Valores nulos em ACTUAL: {df['ACTUAL'].isnull().sum()} ({df['ACTUAL'].isnull().sum() / len(df) * 100:.2f}%)")
    
    return df


def load_specifications(csv_path: str) -> pd.DataFrame:
    """
    Carrega limites de especificação do arquivo CSV
    
    Parameters:
    -----------
    csv_path : str
        Caminho para o arquivo CSV de especificações
    
    Returns:
    --------
    pd.DataFrame : DataFrame com especificações
    """
    # Verificar se arquivo existe
    if not Path(csv_path).exists():
        print(f"⚠️ Arquivo de especificações não encontrado: {csv_path}")
        print("   Criando estrutura vazia de especificações...")
        # Retornar DataFrame vazio com estrutura correta
        return pd.DataFrame(columns=['TYPE OPERATION', 'NAME SITE', 'NAME KPI', 'LSL', 'USL', 'TARGET'])
    
    try:
        # Carregar CSV
        df_specs = pd.read_csv(csv_path)
        
        # Validar colunas obrigatórias
        required_cols = ['TYPE OPERATION', 'NAME SITE', 'NAME KPI']
        missing_cols = [col for col in required_cols if col not in df_specs.columns]
        
        if missing_cols:
            raise ValueError(f"Colunas obrigatórias ausentes no CSV: {', '.join(missing_cols)}")
        
        # Remover espaços em branco extras das colunas de texto
        for col in ['TYPE OPERATION', 'NAME SITE', 'NAME KPI']:
            if col in df_specs.columns:
                df_specs[col] = df_specs[col].astype(str).str.strip()
        
        # Garantir que colunas numéricas sejam numéricas
        for col in ['LSL', 'USL', 'TARGET']:
            if col in df_specs.columns:
                df_specs[col] = pd.to_numeric(df_specs[col], errors='coerce')
        
        # Contar especificações válidas
        valid_specs = df_specs[df_specs['LSL'].notna() & df_specs['USL'].notna()]
        
        print(f"✓ Especificações carregadas: {len(df_specs)} registros")
        print(f"✓ Especificações válidas (com LSL e USL): {len(valid_specs)}")
        
        return df_specs
        
    except Exception as e:
        print(f"⚠️ Erro ao carregar especificações: {str(e)}")
        return pd.DataFrame(columns=['TYPE OPERATION', 'NAME SITE', 'NAME KPI', 'LSL', 'USL', 'TARGET'])


def get_specification_for_group(df_specs: pd.DataFrame, tipo_op: str, site: str, kpi: str) -> Optional[dict]:
    """
    Busca especificação para um grupo específico
    
    Parameters:
    -----------
    df_specs : pd.DataFrame
        DataFrame de especificações
    tipo_op : str
        Tipo de operação
    site : str
        Nome do site
    kpi : str
        Nome do KPI
    
    Returns:
    --------
    dict ou None : Dicionário com LSL, USL e TARGET (se existir)
    """
    if df_specs.empty:
        return None
    
    # Fazer strip nos valores de busca
    tipo_op = str(tipo_op).strip()
    site = str(site).strip()
    kpi = str(kpi).strip()
    
    # Buscar especificação exata
    mask = (
        (df_specs['TYPE OPERATION'].astype(str).str.strip() == tipo_op) &
        (df_specs['NAME SITE'].astype(str).str.strip() == site) &
        (df_specs['NAME KPI'].astype(str).str.strip() == kpi)
    )
    
    result = df_specs[mask]
    
    if len(result) == 0:
        return None
    
    spec = result.iloc[0]
    
    # Verificar se LSL e USL estão definidos
    if pd.isna(spec['LSL']) or pd.isna(spec['USL']):
        return None
    
    return {
        'LSL': float(spec['LSL']),
        'USL': float(spec['USL']),
        'TARGET': float(spec['TARGET']) if pd.notna(spec.get('TARGET')) else (float(spec['LSL']) + float(spec['USL'])) / 2
    }


def validate_uploaded_file(file) -> Tuple[bool, str]:
    """
    Valida arquivo uploadado no Streamlit
    
    Parameters:
    -----------
    file : UploadedFile
        Arquivo do Streamlit
    
    Returns:
    --------
    tuple : (is_valid, message)
    """
    if file is None:
        return False, "Nenhum arquivo foi enviado"
    
    # Verificar extensão
    if not file.name.endswith(('.xlsx', '.xlsm', '.xls')):
        return False, f"Formato inválido: {file.name}. Use arquivos Excel (.xlsx, .xlsm, .xls)"
    
    # Verificar tamanho (máximo 50MB)
    max_size = 50 * 1024 * 1024  # 50MB em bytes
    if file.size > max_size:
        return False, f"Arquivo muito grande: {file.size / (1024*1024):.1f}MB. Máximo: 50MB"
    
    return True, "Arquivo válido"
