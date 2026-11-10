"""
Visual do relatório — o mesmo do Dashboard do app (aba Dashboard do Stable & Capable).

Tokens de cor e tipografia copiados de VBM-Stable-and-Capable/index.html (.dsc) e de
assets/js/painel-spc.js, para o PDF e a tela falarem a mesma língua:
    - fonte Poppins (data/fonts, OFL), registrada no matplotlib e usada no PIL;
    - cards brancos, borda #e8edf3, raio 16 px e sombra suave;
    - títulos de card em #316866, textos auxiliares em #5b6676;
    - tabelas com cabeçalho azul-marinho (#0d2640) e linhas zebradas.

As páginas são desenhadas em ESCALA× (2× = 3414 × 1920 px para a página de
1707 × 960) e o PDF mantém o mesmo tamanho físico: o texto sai nítido.
Todas as medidas abaixo estão em px "lógicos" (os da página de 1707 × 960).
"""

import logging
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

logger = logging.getLogger(__name__)

ESCALA = 2

# ── Cores (index.html, bloco .dsc) ─────────────────────────────────────────
PAGINA = '#ffffff'
SUPERFICIE = '#ffffff'
SUPERFICIE_ALT = '#f7f9fc'
LINHA = '#e8edf3'
LINHA_SUAVE = '#eef2f6'
TINTA = '#0f172a'
TINTA_SUAVE = '#5b6676'
TINTA_FRACA = '#9ca3af'
TITULO_CARD = '#316866'
ACENTO = '#1e8fc4'            # títulos grandes (--accent)
TEXTO_SUAVE = '#6b7280'       # --text-soft
AZUL = '#3cb5e5'
AZUL_ESCURO = '#1a8bbf'
AZUL_PROFUNDO = '#0d2640'
PILULA = '#d8f0fa'
SUBIU = '#007e7a'
CAIU = '#b91c1c'

# Carta de controle (--c-*)
C_SERIE = '#a7b8c6'
C_CL = '#1a8bbf'
C_LIM = '#8a96a6'
C_BEST = (60, 181, 229, 28)   # rgba(60,181,229,.11)
C_REGRA = {'r1': '#b91c1c', 'r2': '#3cb5e5', 'r3': '#0d2640', 'r4': '#8a96a6'}

# Medidas (--m-*)
M_COR = {'Mean': '#1a8bbf', 'Best 30 Days': '#3cb5e5', 'P75': '#9ddaf2', 'Budget': '#8a96a6'}

# Anos do histograma, por recência (--ano-0 = o mais novo)
ANO_COR = ['#3cb5e5', '#1b5e80', '#8a96a6', '#c3ccd6']


def cor_do_ano(i, n):
    """Cor do i-ésimo ano (em ordem crescente) de n anos: o mais novo em azul Vale."""
    return ANO_COR[min(3, n - 1 - i)]


# ── Fontes ─────────────────────────────────────────────────────────────────
_RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PASTA_FONTES = os.environ.get('REPORT_FONTS_DIR', os.path.join(_RAIZ, 'data', 'fonts'))
ARQ_FONTE = {
    'regular': 'Poppins-Regular.ttf',
    'italic': 'Poppins-Italic.ttf',
    'medium': 'Poppins-Medium.ttf',
    'semibold': 'Poppins-SemiBold.ttf',
    'bold': 'Poppins-Bold.ttf',
}
_cache_fontes = {}
_matplotlib_pronto = False


def caminho_fonte(peso):
    return os.path.join(PASTA_FONTES, ARQ_FONTE[peso])


def fonte(peso, tamanho_px):
    """Poppins no peso pedido, em px lógicos (já multiplica pela ESCALA)."""
    chave = (peso, tamanho_px)
    if chave not in _cache_fontes:
        tam = max(1, int(round(tamanho_px * ESCALA)))
        try:
            _cache_fontes[chave] = ImageFont.truetype(caminho_fonte(peso), tam)
        except (OSError, IOError):
            from .utils import load_font  # DejaVu no mesmo peso, se a Poppins faltar
            nome = {'regular': 'DejaVuSans.ttf', 'italic': 'DejaVuSans-Oblique.ttf'}.get(peso, 'DejaVuSans-Bold.ttf')
            logger.warning("Poppins (%s) não encontrada em %s — usando DejaVu", peso, PASTA_FONTES)
            _cache_fontes[chave] = load_font([nome], tam)
    return _cache_fontes[chave]


def preparar_matplotlib():
    """Registra a Poppins no matplotlib (uma vez) e aplica o estilo base dos gráficos."""
    global _matplotlib_pronto
    import matplotlib
    matplotlib.use('Agg')
    from matplotlib import font_manager, rcParams
    if not _matplotlib_pronto:
        achou = False
        for peso in ARQ_FONTE:
            arq = caminho_fonte(peso)
            if os.path.exists(arq):
                font_manager.fontManager.addfont(arq)
                achou = True
        rcParams['font.family'] = ['Poppins'] if achou else ['DejaVu Sans']
        rcParams['axes.unicode_minus'] = False
        rcParams['savefig.facecolor'] = SUPERFICIE
        _matplotlib_pronto = True


def pt(px):
    """px lógicos → pontos do matplotlib (figuras a 96 dpi lógicos)."""
    return px * 72 / 96


def figura_px(w, h):
    """Figura matplotlib de w × h px lógicos, com o eixo ocupando a figura (margens à parte)."""
    preparar_matplotlib()
    import matplotlib.pyplot as plt
    fig = plt.figure(figsize=(w / 96, h / 96), dpi=96)
    return fig


def figura_para_imagem(fig):
    """Rasteriza a figura em ESCALA× (sem recorte automático: o tamanho é o pedido)."""
    from io import BytesIO
    import matplotlib.pyplot as plt
    buf = BytesIO()
    fig.savefig(buf, format='png', dpi=96 * ESCALA, facecolor=SUPERFICIE)
    plt.close(fig)
    buf.seek(0)
    return Image.open(buf).convert('RGB')


# ── PIL: desenho em px lógicos ─────────────────────────────────────────────
def s(v):
    return int(round(v * ESCALA))


def rgb(c, alfa=255):
    if isinstance(c, tuple):
        return c if len(c) == 4 else c + (alfa,)
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (alfa,)


def largura_texto(texto, f):
    try:
        return f.getlength(str(texto)) / ESCALA
    except AttributeError:
        bb = f.getbbox(str(texto))
        return (bb[2] - bb[0]) / ESCALA


def texto(draw, xy, conteudo, f, cor, ancora='la'):
    draw.text((s(xy[0]), s(xy[1])), str(conteudo), font=f, fill=rgb(cor), anchor=ancora)


def encurtar(conteudo, f, largura):
    t = str(conteudo)
    if largura_texto(t, f) <= largura:
        return t
    while len(t) > 1 and largura_texto(t + '…', f) > largura:
        t = t[:-1]
    return t.rstrip() + '…'


def nova_pagina(w, h):
    return Image.new('RGB', (s(w), s(h)), PAGINA)


def card(pagina, x, y, w, h, raio=16):
    """Card do Dashboard: sombra suave, fundo branco, borda #e8edf3."""
    sombra = Image.new('RGBA', (s(w + 60), s(h + 60)), (0, 0, 0, 0))
    ds = ImageDraw.Draw(sombra)
    ds.rounded_rectangle((s(30), s(30 + 8), s(30 + w), s(30 + h + 8)), radius=s(raio), fill=(15, 23, 42, 16))
    sombra = sombra.filter(ImageFilter.GaussianBlur(s(12)))
    pagina.paste(sombra, (s(x - 30), s(y - 30)), sombra)
    d = ImageDraw.Draw(pagina)
    d.rounded_rectangle((s(x), s(y), s(x + w), s(y + h)), radius=s(raio), fill=rgb(SUPERFICIE), outline=rgb(LINHA), width=max(1, s(1)))
    return d


def cabecalho_card(d, x, y, w, titulo, subtitulo=None):
    """Título (Poppins 500, 16 px, #316866) e subtítulo (11,5 px, #5b6676). Devolve o y do fim."""
    texto(d, (x, y), titulo, fonte('medium', 16), TITULO_CARD)
    y2 = y + 24
    if subtitulo:
        f = fonte('regular', 11.5)
        texto(d, (x, y2), encurtar(subtitulo, f, w), f, TINTA_SUAVE)
        y2 += 18
    return y2


def legenda(d, x, y, itens, tamanho=11, largura_max=None, alinhar_direita=False):
    """Legenda do Dashboard. itens: [(tipo, cor, rótulo)], tipo em linha|tracejada|ponto|faixa|quadrado.
    Quebra em linhas se passar de largura_max. Devolve a altura usada."""
    f = fonte('regular', tamanho)
    gap, marca = 16, 16
    larguras = [marca + 6 + largura_texto(r, f) for _, _, r in itens]
    linhas, atual, lw = [], [], 0
    for item, wi in zip(itens, larguras):
        if largura_max and atual and lw + gap + wi > largura_max:
            linhas.append((atual, lw)); atual, lw = [], 0
        lw += (gap if atual else 0) + wi
        atual.append((item, wi))
    if atual:
        linhas.append((atual, lw))
    alt = tamanho + 7
    for n, (linha, lw) in enumerate(linhas):
        cx = (x + (largura_max or lw) - lw) if alinhar_direita else x
        cy = y + n * alt
        meio = cy + alt / 2 - 1
        for (tipo, cor, rot), wi in linha:
            if tipo in ('linha', 'tracejada'):
                if tipo == 'linha':
                    d.line((s(cx), s(meio), s(cx + marca), s(meio)), fill=rgb(cor), width=s(2))
                else:
                    for i in range(0, marca, 6):
                        d.line((s(cx + i), s(meio), s(cx + min(i + 3.5, marca)), s(meio)), fill=rgb(cor), width=s(1.6))
            elif tipo == 'ponto':
                r = 4
                d.ellipse((s(cx + marca / 2 - r), s(meio - r), s(cx + marca / 2 + r), s(meio + r)), fill=rgb(cor))
            elif tipo == 'faixa':
                d.rounded_rectangle((s(cx + 1), s(meio - 5), s(cx + marca - 1), s(meio + 5)), radius=s(2), fill=rgb(cor))
            elif tipo == 'quadrado':
                d.rounded_rectangle((s(cx + 3), s(meio - 5), s(cx + 13), s(meio + 5)), radius=s(3), fill=rgb(cor))
            texto(d, (cx + marca + 6, meio), rot, f, TINTA_SUAVE, 'lm')
            cx += wi + gap
    return len(linhas) * alt


def pilula(d, xc, yc, conteudo, f, fundo, cor, pad_x=8, alt=20):
    w = largura_texto(conteudo, f) + 2 * pad_x
    d.rounded_rectangle((s(xc - w / 2), s(yc - alt / 2), s(xc + w / 2), s(yc + alt / 2)), radius=s(alt / 2), fill=rgb(fundo))
    texto(d, (xc, yc), conteudo, f, cor, 'mm')
    return w


def tabela(pagina, x, y, w, colunas, linhas, tam=11, alt_linha=26, alt_cab=28, raio=10):
    """Tabela do Dashboard (.dsc-tabela): cabeçalho #0d2640, linhas zebradas, borda arredondada.

    colunas: [(rótulo, fração da largura, alinhamento 'l'|'r'|'c')]
    linhas:  [[célula, …]]; célula = texto ou dict(texto=, cor=, peso=, marca=cor do quadradinho,
             pilula=(fundo, cor))
    Devolve a altura total."""
    h = alt_cab + alt_linha * len(linhas)
    camada = Image.new('RGBA', (s(w), s(h)), (0, 0, 0, 0))
    dc = ImageDraw.Draw(camada)
    dc.rectangle((0, 0, s(w), s(alt_cab)), fill=rgb(AZUL_PROFUNDO))
    for i in range(len(linhas)):
        y0 = alt_cab + i * alt_linha
        dc.rectangle((0, s(y0), s(w), s(y0 + alt_linha)), fill=rgb(SUPERFICIE_ALT if i % 2 else SUPERFICIE))
        if i:
            dc.line((0, s(y0), s(w), s(y0)), fill=rgb(LINHA_SUAVE), width=max(1, s(1)))
    mascara = Image.new('L', camada.size, 0)
    ImageDraw.Draw(mascara).rounded_rectangle((0, 0, s(w) - 1, s(h) - 1), radius=s(raio), fill=255)
    pagina.paste(camada.convert('RGB'), (s(x), s(y)), mascara)
    d = ImageDraw.Draw(pagina)
    d.rounded_rectangle((s(x), s(y), s(x + w), s(y + h)), radius=s(raio), outline=rgb(LINHA), width=max(1, s(1)))

    pad = 10
    fc = fonte('medium', tam - 0.5)
    xs, cx = [], x
    for _, frac, _ in colunas:
        xs.append((cx, cx + w * frac)); cx += w * frac

    def alinhar(a, b, larg, al):
        return {'l': a + pad, 'r': b - pad - larg, 'c': (a + b - larg) / 2}[al]

    for (rot, _, al), (a, b) in zip(colunas, xs):
        rot = encurtar(rot, fc, b - a - 2 * pad)
        texto(d, (alinhar(a, b, largura_texto(rot, fc), al), y + alt_cab / 2), rot, fc, '#ffffff', 'lm')
    for i, linha in enumerate(linhas):
        ym = y + alt_cab + i * alt_linha + alt_linha / 2
        for cel, (_, _, al), (a, b) in zip(linha, colunas, xs):
            c = cel if isinstance(cel, dict) else {'texto': cel}
            f = fonte(c.get('peso', 'regular'), c.get('tam', tam))
            marca = c.get('marca')
            conteudo = encurtar(c.get('texto', ''), f, b - a - 2 * pad - (16 if marca else 0))
            lt = largura_texto(conteudo, f) + (16 if marca else 0)
            x0 = alinhar(a, b, lt, al)
            if c.get('pilula'):
                fundo, cor = c['pilula']
                pilula(d, x0 + lt / 2, ym, conteudo, f, fundo, cor, pad_x=7, alt=min(20, alt_linha - 6))
                continue
            if marca:
                d.rounded_rectangle((s(x0), s(ym - 5), s(x0 + 10), s(ym + 5)), radius=s(3), fill=rgb(marca))
                x0 += 16
            texto(d, (x0, ym), conteudo, f, c.get('cor', TINTA), 'lm')
    return h


def colar(pagina, img, x, y):
    pagina.paste(img, (s(x), s(y)))


def salvar_png(img, caminho):
    """PNG da página em paleta de 256 cores (os gráficos têm poucas cores): o PDF fica com o
    tamanho de antes, mesmo com a página desenhada em ESCALA×."""
    img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
        caminho, format='PNG', optimize=True, dpi=(96 * ESCALA, 96 * ESCALA))
