"""Monta o config.json do DER do AIP Goals a partir do esqueleto (esqueleto_config.py) + textos abaixo.
Uso: python3 montar_config.py  (lê schema.json e config.json do esqueleto; grava config.json)"""
import json

s = json.load(open('schema.json'))
c = json.load(open('config.json'))
alt = {t['name']: 40 + 19 * len(t['cols']) for t in s['tables']}

c['titulo'] = 'DER do AIP Goals'
c['subtitulo'] = 'VBM AIP Goals · modelo proposto (fase 1) · alvo Azure SQL BDIBPBMSA, convenções do Schema IBP de 21/10/2026 · versão de 19/11/2026 · prefixos ID_, NM_, DS_, DT_, NO_, CD_, TP_, SG_ (S/N), QTDE_, VL_'
c['descricao_svg'] = 'Diagrama do banco do AIP Goals: o ciclo e os grupos à esquerda, o desdobramento de metas e pesos no centro, o Goal Card com versões e decisões e, à direita, comentários, log e notificações.'
c['legenda_figura'] = ('O <b>AIP_GOAL_CARD</b> é o centro: uma meta do desdobramento numa unidade (BU), com versões, decisão do grupo de aprovação e comentários. '
    'O <b>AIP_CICLO</b> organiza tudo: só um ciclo fica aberto por vez. Pessoas vêm do MDM pela matrícula (CD_MATRICULA). '
    'Passe o mouse numa linha para ver o nome da regra. <b>Clique numa tabela para ver aqui o detalhe dela: cada campo explicado, com exemplo, ligações e regras.</b>')
c['texto_exemplos'] = ('Linhas fictícias, gravadas num banco de teste e aprovadas por todas as regras (exemplos.sql). Campos SG_ usam S/N, como no esquema IBP. Os IDs batem entre as tabelas: '
    'o AIP 2027 (ciclo 2) foi criado a partir do AIP 2026; o Goal Card GC-ONT-04 teve a v1 devolvida para ajuste na unidade e na régua, e o GC-ONP-04 foi aprovado. '
    'As matrículas são fictícias. Clique numa tabela do diagrama para destacar o exemplo dela.')
c['grupos'] = {
    'cic': {'nome': 'CICLO E PESSOAS', 'claro': '#dfe8e2', 'escuro': '#233229'},
    'des': {'nome': 'DESDOBRAMENTO', 'claro': '#efe6d6', 'escuro': '#352d1f'},
    'gc': {'nome': 'GOAL CARD', 'claro': '#dde6ef', 'escuro': '#1f2c38'},
    'aud': {'nome': 'LOG E AVISOS', 'claro': '#e9e1ec', 'escuro': '#2e2533'},
}
c['grupo_destaque'] = 'gc'
c['layout'] = {'largura_tabela': 330, 'colunas': [20, 440, 860, 1280]}
c['formato'] = {'moeda': '', 'decimal': ',', 'fuso_horas': -3, 'prefixos_moeda': [], 'prefixos_percentual': []}

colunas = [
    ('cic', ['AIP_CICLO', 'AIP_CICLO_JANELA', 'AIP_PAPEL', 'AIP_BU']),
    ('des', ['AIP_CICLO_BU', 'AIP_NIVEL', 'AIP_UNIDADE', 'AIP_META', 'AIP_META_PESO']),
    ('gc', ['AIP_GOAL_CARD', 'AIP_GOAL_CARD_VERSAO', 'AIP_DECISAO', 'AIP_REVISAO_SECAO']),
    ('aud', ['AIP_COMENTARIO', 'AIP_EVENTO_LOG', 'AIP_NOTIFICACAO']),
]
grupo_de = {'AIP_BU': 'des', 'AIP_COMENTARIO': 'gc'}
ordem = []
for i, (g, ts) in enumerate(colunas):
    y = 20
    for t in ts:
        c['tabelas'][t]['pos'] = [i, y]
        c['tabelas'][t]['grupo'] = grupo_de.get(t, g)
        y += alt[t] + 34
        ordem.append(t)
c['ordem'] = ordem

T = {
 'AIP_CICLO': {
  'proposito': 'Um ciclo anual do AIP (ex.: AIP 2027). Só um ciclo pode estar aberto; os fechados ficam para consulta e podem ser reabertos se não houver outro aberto.',
  'campos': {
   'ID_CICLO': 'Número interno do ciclo.',
   'NO_ANO': 'Ano do ciclo, de 2020 a 2100; não se repete.',
   'NM_CICLO': 'Nome mostrado nas telas (ex.: AIP 2027).',
   'TP_STATUS': 'ABERTO ou FECHADO. Fechar e reabrir é feito na Administração.',
   'DS_TEXTO_PADRAO_EXCECOES': 'Texto padrão da seção Exceptions and Considerations de todos os Goal Cards; a BU não edita.',
   'ID_CICLO_ORIGEM': 'Ciclo de onde este foi criado (BUs, grupos e metas copiados). Vazio = criado do zero.',
   'DT_CRIACAO': 'Quando o ciclo foi aberto.',
   'CD_MATRICULA_CRIACAO': 'Matrícula (MDM) de quem abriu o ciclo.',
   'DT_FECHAMENTO': 'Quando foi fechado. Preenchido só se FECHADO.',
   'CD_MATRICULA_FECHAMENTO': 'Matrícula de quem fechou. Preenchida só se FECHADO.'},
  'regras': ['Só um ciclo com TP_STATUS = ABERTO por vez (índice único parcial).', 'Ano entre 2020 e 2100 e único.', 'TP_STATUS: ABERTO ou FECHADO.', 'Data e matrícula de fechamento preenchidas se, e só se, o ciclo estiver FECHADO.'],
  'condicional': {'DT_FECHAMENTO': 'se FECHADO', 'CD_MATRICULA_FECHAMENTO': 'se FECHADO'},
  'exemplos': ['1 · AIP 2026, fechado', '2 · AIP 2027, aberto, criado do 2026']},
 'AIP_CICLO_JANELA': {
  'proposito': 'As quatro etapas da jornada do ciclo (Desdobramento COO, Propostas BU\'s, Calibração e Aprovação, Goal Card oficial) com suas datas.',
  'campos': {
   'ID_CICLO': 'Ciclo dono da janela.',
   'TP_ETAPA': 'DESDOBRAMENTO, PROPOSTA, CALIBRACAO ou OFICIAL.',
   'NO_ORDEM': 'Posição da etapa na jornada (1 a 4).',
   'DT_INI': 'Início, só na primeira etapa; as demais começam quando a anterior termina.',
   'DT_FIM': 'Último dia da etapa.'},
  'regras': ['Uma janela por etapa em cada ciclo; ordem única.', 'TP_ETAPA: DESDOBRAMENTO, PROPOSTA, CALIBRACAO, OFICIAL.', 'Só a etapa 1 tem DT_INI; DT_FIM depois de DT_INI.', 'Editável só com o ciclo aberto (a tela desativa as janelas de ciclo fechado).'],
  'condicional': {'DT_INI': 'só na etapa 1'},
  'exemplos': ['Calibração termina em 15/12', 'Desdobramento de 01/10 a 29/10', 'Goal Card oficial em 22/12']},
 'AIP_PAPEL': {
  'proposito': 'Quem participa do ciclo e em qual grupo: contribuidores e consulta por BU, grupo de aprovação e administradores. Os dados da pessoa vêm do MDM.',
  'campos': {
   'ID_PAPEL': 'Número interno da participação.',
   'ID_CICLO': 'Ciclo em que o papel vale.',
   'CD_MATRICULA': 'Matrícula da pessoa; nome, e-mail, cargo, estado e cidade são lidos do MDM.',
   'TP_GRUPO': 'CONTRIBUIDOR, APROVACAO, CONSULTA ou ADMIN.',
   'ID_BU': 'BU do contribuidor ou da consulta. Vazio para aprovação e administração.',
   'SG_ATIVO': 'N = a pessoa perde o acesso sem apagar o histórico.',
   'DT_INCLUSAO': 'Quando foi incluída (popup Adicionar usuário).',
   'CD_MATRICULA_INCLUSAO': 'Quem incluiu.'},
  'regras': ['TP_GRUPO: CONTRIBUIDOR, APROVACAO, CONSULTA, ADMIN.', 'BU obrigatória para contribuidor e consulta; vazia para aprovação e administrador.', 'Uma pessoa não se repete no mesmo grupo e BU do ciclo.'],
  'condicional': {'ID_BU': 'se contribuidor ou consulta'},
  'exemplos': ['1 · Contribuidor de Ontario', '2 · Grupo de aprovação', '3 · Administrador']},
 'AIP_BU': {
  'proposito': 'Cadastro das Business Units (nome e país ou região). A BU entra em cada ciclo pela AIP_CICLO_BU.',
  'campos': {'ID_BU': 'Número interno da BU.', 'NM_BU': 'Nome da BU; não se repete. Renomear atualiza pesos, pessoas e unidades ligadas.', 'NM_PAIS': 'País ou região que agrupa as BUs nas telas (Brasil, Canadá, International Refineries), como NM_PAIS da IBP.SITES.', 'ID_SITE': 'Ligação com a IBP.SITES (ID_SITE) quando a BU existe lá. Vazio = BU só do AIP.', 'DT_CRIACAO': 'Quando a BU foi cadastrada.'},
  'regras': ['Nome único.', 'ID_SITE é ligação implícita com IBP.SITES (outro esquema, sem FK física).', 'Só se exclui BU sem Goal Card submetido; com card, tira-se do ciclo (AIP_CICLO_BU).'],
  'exemplos': ['1 · Onça Puma, Brasil', '2 · Ontario, Canadá']},
 'AIP_CICLO_BU': {
  'proposito': 'Quais BUs participam de cada ciclo. Tirar do ciclo não apaga a BU: ela deixa de receber Goal Cards e notificações e sai das somas.',
  'campos': {'ID_CICLO': 'Ciclo.', 'ID_BU': 'BU.', 'SG_ATIVA': 'S = a BU está no ciclo; N = fora do ciclo.'},
  'regras': ['Uma linha por BU em cada ciclo.'],
  'exemplos': ['Onça Puma no AIP 2026', 'Ontario no AIP 2026', 'Onça Puma no AIP 2027']},
 'AIP_NIVEL': {
  'proposito': 'Os níveis do desdobramento de pontos do ciclo (CEO → COO → BU → GG → GA): total de pontos por unidade, quanto vem do nível acima e se o nível é obrigatório.',
  'campos': {
   'ID_NIVEL': 'Número interno do nível.',
   'ID_CICLO': 'Ciclo do nível.',
   'CD_NIVEL': 'CEO, COO, BU, GG ou GA.',
   'NO_ORDEM': 'Posição no desdobramento (1 = CEO).',
   'NM_NIVEL': 'Nome mostrado nas telas; editável.',
   'QTDE_PONTOS_TOTAL': 'Pontos que cada unidade do nível precisa fechar (ex.: 100).',
   'QTDE_PONTOS_HERDADOS': 'Pontos que vêm do resultado do nível acima (linha "Resultado do …", editável em Metas e pesos). O restante vai para as metas do nível.',
   'SG_OBRIGATORIO': 'S = Obrigatório (sempre no desdobramento), N = Opcional; escolhido em Parâmetros.',
   'SG_ATIVO': 'S = nível em uso. Nível obrigatório fica sempre S.'},
  'regras': ['Um nível de cada tipo por ciclo.', 'Total de 1 a 1000; herdado de 0 até total − 1; o primeiro nível não herda.', 'Nível obrigatório fica sempre ativo.', 'GA só ativo com GG ativo (o desdobramento não pula nível; validado na API).', 'Metas e pesos mostra só CEO, COO e BU.'],
  'exemplos': ['1 · CEO, 100 pts', '2 · COO, 75 herdados do CEO', '3 · BU, 40 herdados do COO']},
 'AIP_UNIDADE': {
  'proposito': 'As unidades de cada nível: CEO VBM, COO VBM, cada BU ativa e, se usados, as GGs e GAs. É quem recebe pesos e Goal Cards.',
  'campos': {'ID_UNIDADE': 'Número interno da unidade.', 'ID_NIVEL': 'Nível da unidade.', 'NM_UNIDADE': 'Nome mostrado (ex.: Ontario).', 'ID_BU': 'BU correspondente, quando a unidade é do nível BU.', 'ID_UNIDADE_PAI': 'Unidade do nível acima (a BU aponta para o COO; a GG para a BU).'},
  'regras': ['Nome único dentro do nível.'],
  'condicional': {'ID_BU': 'se nível BU', 'ID_UNIDADE_PAI': 'exceto o CEO'},
  'exemplos': ['1 · CEO VBM', '2 · COO VBM, abaixo do CEO', '3 · Onça Puma, abaixo do COO']},
 'AIP_META': {
  'proposito': 'As metas de cada nível do desdobramento (número, título, tipo e direção). As metas da BU podem vir de uma meta do COO.',
  'campos': {
   'ID_META': 'Número interno da meta.',
   'ID_NIVEL': 'Nível da meta (COO, BU…).',
   'NO_META': 'Número mostrado nas telas (ex.: 04); único no nível.',
   'NM_TITULO': 'Título da meta (Goal Title).',
   'TP_META': 'FORMULA (Por fórmula) ou MARCOS (Por marcos).',
   'TP_POLARIDADE': 'MAIOR (maior é melhor) ou MENOR (menor é melhor).',
   'ID_META_ORIGEM': 'Meta do nível acima de onde esta foi desdobrada. Vazio = meta própria do nível.',
   'SG_ATIVA': 'N = fora do ciclo, sem apagar o histórico.'},
  'regras': ['Número único dentro do nível.', 'TP_META: FORMULA ou MARCOS; TP_POLARIDADE: MAIOR ou MENOR.'],
  'exemplos': ['1 · Meta 02 do COO', '2 · Meta 04 das BUs', '3 · Meta 05 da BU, desdobrada da 02 do COO']},
 'AIP_META_PESO': {
  'proposito': 'O peso de cada meta em cada unidade. Somado aos pontos herdados, fecha o total da unidade (RN-16).',
  'campos': {'ID_META': 'Meta.', 'ID_UNIDADE': 'Unidade que recebe o peso.', 'VL_PESO': 'Pontos da meta nesta unidade (aceita meio ponto, ex.: 7,5).'},
  'regras': ['Um peso por meta e unidade; maior que zero.', 'Para cada unidade: herdado + soma dos pesos = total do nível (validado na API antes de gravar).'],
  'exemplos': ['Meta 02 vale 5 no COO VBM', 'Meta 04 vale 10 em Onça Puma', 'Meta 04 vale 10 em Ontario']},
 'AIP_GOAL_CARD': {
  'proposito': 'O Goal Card de uma meta numa unidade (ex.: GC-ONT-04): estado atual, versão oficial e o rascunho em edição.',
  'campos': {
   'ID_GOAL_CARD': 'Número interno do card.',
   'CD_GOAL_CARD': 'Código mostrado nas telas: GC-<BU>-<meta>.',
   'ID_META': 'Meta do card.',
   'ID_UNIDADE': 'Unidade (BU) dona do card.',
   'TP_ESTADO': 'RASCUNHO, EM_APROVACAO, EM_REVISAO (devolvido para ajuste), APROVADO ou NEGADO.',
   'NO_VERSAO_OFICIAL': 'Versão aprovada que vale como oficial. Preenchida só se APROVADO.',
   'DS_RASCUNHO': 'Campos em edição ainda não submetidos (objetivo, fórmula, unidade, régua, área, evidência, exceções da BU).',
   'DT_ATUALIZACAO': 'Última mudança no card (coluna "Última atualização").',
   'CD_MATRICULA_ATUALIZACAO': 'Quem fez a última mudança.'},
  'regras': ['Código único; um card por meta e unidade.', 'TP_ESTADO: RASCUNHO, EM_APROVACAO, EM_REVISAO, APROVADO, NEGADO.', 'Versão oficial preenchida se, e só se, APROVADO.'],
  'condicional': {'NO_VERSAO_OFICIAL': 'se APROVADO'},
  'exemplos': ['1 · GC-ONT-04, devolvido para ajuste', '2 · GC-ONP-04, aprovado (v1 oficial)']},
 'AIP_GOAL_CARD_VERSAO': {
  'proposito': 'Cada submissão gera uma versão imutável (v1, v2…) com a foto de todos os campos. É o que a tela Versões compara.',
  'campos': {'ID_VERSAO': 'Número interno da versão.', 'ID_GOAL_CARD': 'Card da versão.', 'NO_VERSAO': 'Número da versão no card (1, 2…).', 'TP_MOTIVO': 'SUBMISSAO, RESUBMISSAO ou REABERTURA.', 'DS_CAMPOS': 'Foto dos campos do card no momento da submissão.', 'DT_VERSAO': 'Quando foi submetida.', 'CD_MATRICULA_AUTOR': 'Quem submeteu.'},
  'regras': ['Número de versão único por card.', 'TP_MOTIVO: SUBMISSAO, RESUBMISSAO, REABERTURA.', 'Não se edita nem apaga uma versão (só a API grava, sempre inserindo).'],
  'exemplos': ['1 · v1 do GC-ONT-04', '2 · v1 do GC-ONP-04']},
 'AIP_DECISAO': {
  'proposito': 'A decisão do grupo de aprovação sobre uma versão (nível único): aprovar, devolver para ajuste ou negar.',
  'campos': {'ID_DECISAO': 'Número interno da decisão.', 'ID_VERSAO': 'Versão decidida.', 'TP_DECISAO': 'APROVADO, DEVOLVIDO ou NEGADO.', 'DS_COMENTARIO': 'Justificativa; obrigatória para devolver ou negar (mínimo de caracteres controlado na aplicação).', 'DT_DECISAO': 'Quando foi decidida.', 'CD_MATRICULA_DECISAO': 'Membro do grupo que decidiu (não pode ser quem editou ou submeteu, RN-12).'},
  'regras': ['Uma decisão por versão (decisão idempotente).', 'TP_DECISAO: APROVADO, DEVOLVIDO, NEGADO.', 'Comentário obrigatório se DEVOLVIDO ou NEGADO.'],
  'condicional': {'DS_COMENTARIO': 'se devolvido ou negado'},
  'exemplos': ['1 · v1 do GC-ONT-04 devolvida', '2 · v1 do GC-ONP-04 aprovada']},
 'AIP_REVISAO_SECAO': {
  'proposito': 'A marcação de cada seção do card na decisão: OK ou Ajustar. Devolver exige ao menos uma seção Ajustar.',
  'campos': {'ID_DECISAO': 'Decisão.', 'CD_SECAO': 'Seção do card (OBJECTIVE, FORMULA, UNIT, RULER, AREA, EVIDENCE, EXCEPTIONS).', 'TP_MARCACAO': 'OK ou AJUSTAR.'},
  'regras': ['Uma marcação por seção em cada decisão.', 'TP_MARCACAO: OK ou AJUSTAR.', 'Devolver exige ao menos uma seção AJUSTAR (validado na API).'],
  'exemplos': ['Objective OK', 'Ruler para ajustar', 'Unit para ajustar']},
 'AIP_COMENTARIO': {
  'proposito': 'Comentários por seção do Goal Card, com respostas. Aparecem no card e no Action Log.',
  'campos': {'ID_COMENTARIO': 'Número interno do comentário.', 'ID_GOAL_CARD': 'Card comentado.', 'CD_SECAO': 'Seção comentada.', 'DS_COMENTARIO': 'Texto do comentário.', 'ID_COMENTARIO_PAI': 'Comentário respondido. Vazio = comentário novo.', 'DT_COMENTARIO': 'Quando foi publicado.', 'CD_MATRICULA_AUTOR': 'Quem comentou (o grupo de consulta não comenta).'},
  'regras': ['CD_SECAO numa das sete seções do card.', 'Não se edita nem apaga comentário publicado.'],
  'exemplos': ['1 · Aprovador pede % na unidade', '2 · Contribuidor responde']},
 'AIP_EVENTO_LOG': {
  'proposito': 'A linha do tempo única e imutável do ciclo (Action Log): submissões, decisões, comentários, mudanças de configuração e abertura/fechamento de ciclo, com antes e depois.',
  'campos': {
   'ID_EVENTO': 'Número interno do evento.', 'ID_CICLO': 'Ciclo do evento.',
   'TP_EVENTO': 'SUBMISSAO, RECOLHIMENTO, DECISAO, REABERTURA, COMENTARIO, CONFIGURACAO, CICLO_ABERTO, CICLO_FECHADO, CICLO_REABERTO ou ACESSO_NEGADO.',
   'DT_EVENTO': 'Quando aconteceu.', 'CD_MATRICULA': 'Quem fez.', 'TP_GRUPO': 'Grupo da pessoa no momento (mostrado ao lado do nome).',
   'ID_GOAL_CARD': 'Card envolvido. Vazio em eventos de ciclo e configuração.', 'CD_SECAO': 'Seção envolvida, quando houver.',
   'DS_ANTES': 'Valor antes da mudança.', 'DS_DEPOIS': 'Valor depois da mudança.'},
  'regras': ['Registro imutável: um gatilho bloqueia UPDATE e DELETE.', 'TP_EVENTO numa lista fixa (inclui abrir, fechar e reabrir ciclo).'],
  'exemplos': ['1 · AIP 2026 fechado', '2 · v1 do GC-ONT-04 submetida', '3 · Devolvido para ajuste']},
 'AIP_NOTIFICACAO': {
  'proposito': 'Avisos gerados a partir dos eventos (ex.: card devolvido), por e-mail ou na aplicação, com envio e leitura.',
  'campos': {'ID_NOTIFICACAO': 'Número interno do aviso.', 'ID_EVENTO': 'Evento que gerou o aviso.', 'CD_MATRICULA_DESTINO': 'Quem recebe (e-mail vem do MDM).', 'TP_CANAL': 'EMAIL ou APP.', 'DT_ENVIO': 'Quando foi enviado. Vazio = na fila.', 'DT_LEITURA': 'Quando foi lido. Vazio = não lido.'},
  'regras': ['TP_CANAL: EMAIL ou APP.', 'Só tem leitura depois de enviado.'],
  'exemplos': ['1 · E-mail lido pelo contribuidor', '2 · Aviso na aplicação ainda não lido']},
}
for t, v in T.items():
    tab = c['tabelas'][t]
    faltam = set(tab['campos']) - set(v['campos'])
    assert not faltam, (t, faltam)
    assert len(v['exemplos']) == len(tab['exemplos']), (t, len(tab['exemplos']))
    tab.update(v)

rot = {
 ('AIP_CICLO', 'ID_CICLO_ORIGEM'): 'criado a partir de', ('AIP_CICLO_JANELA', 'ID_CICLO'): 'etapa de',
 ('AIP_PAPEL', 'ID_CICLO'): 'participa de', ('AIP_PAPEL', 'ID_BU'): 'atua na',
 ('AIP_CICLO_BU', 'ID_CICLO'): 'participa de', ('AIP_CICLO_BU', 'ID_BU'): 'inclui',
 ('AIP_NIVEL', 'ID_CICLO'): 'nível de', ('AIP_UNIDADE', 'ID_NIVEL'): 'pertence ao', ('AIP_UNIDADE', 'ID_BU'): 'representa',
 ('AIP_UNIDADE', 'ID_UNIDADE_PAI'): 'abaixo de', ('AIP_META', 'ID_NIVEL'): 'meta do', ('AIP_META', 'ID_META_ORIGEM'): 'desdobrada de',
 ('AIP_META_PESO', 'ID_META'): 'peso da', ('AIP_META_PESO', 'ID_UNIDADE'): 'na unidade',
 ('AIP_GOAL_CARD', 'ID_META'): 'card da', ('AIP_GOAL_CARD', 'ID_UNIDADE'): 'da unidade',
 ('AIP_GOAL_CARD_VERSAO', 'ID_GOAL_CARD'): 'versão de', ('AIP_DECISAO', 'ID_VERSAO'): 'decide',
 ('AIP_REVISAO_SECAO', 'ID_DECISAO'): 'detalha', ('AIP_COMENTARIO', 'ID_GOAL_CARD'): 'comenta',
 ('AIP_COMENTARIO', 'ID_COMENTARIO_PAI'): 'responde a', ('AIP_EVENTO_LOG', 'ID_CICLO'): 'registrado em',
 ('AIP_EVENTO_LOG', 'ID_GOAL_CARD'): 'sobre', ('AIP_NOTIFICACAO', 'ID_EVENTO'): 'avisa sobre',
}
for l in c['ligacoes']:
    l['rotulo'] = rot[(l['filho'], l['campo'])]

c['secoes_extras'] = [{'id': 'como-pontos', 'html': (
 '<section class="explica" id="como-pontos"><h2>Como os pontos descem do CEO até a BU</h2>'
 '<p>Cada unidade de um nível precisa fechar o total de pontos do nível. Uma parte vem do resultado do nível acima '
 '(<code>QTDE_PONTOS_HERDADOS</code> da AIP_NIVEL) e o restante é distribuído entre as metas do nível (<code>VL_PESO</code> da AIP_META_PESO).</p>'
 '<ol class="ordem"><li>O CEO fecha 100 pontos só com metas próprias (não herda).</li>'
 '<li>O COO herda 75 pontos do resultado do CEO e distribui 25 entre as suas metas (ex.: meta 02 com 5 pontos).</li>'
 '<li>Cada BU herda 40 pontos do resultado do COO e distribui 60 entre as metas da BU (ex.: meta 04 com 10 pontos em Ontario).</li>'
 '<li>A API só grava quando herdado + soma dos pesos = total, em todas as unidades de todos os níveis ativos (RN-16).</li></ol>'
 '<div class="tscroll"><table class="passo"><thead><tr><th>Unidade</th><th>Herdado</th><th>Metas</th><th>Total</th></tr></thead><tbody>'
 '<tr><td>CEO VBM</td><td>0</td><td>100</td><td>100</td></tr><tr><td>COO VBM</td><td>75</td><td>25</td><td>100</td></tr>'
 '<tr class="hl"><td>Ontario</td><td>40</td><td>60</td><td>100</td></tr></tbody></table></div></section>')}]
c['tabelas']['AIP_NIVEL']['link_extra'] = {'href': '#como-pontos', 'texto': 'Ver como os pontos descem ↓'}
c['tabelas']['AIP_META_PESO']['link_extra'] = {'href': '#como-pontos', 'texto': 'Ver como os pontos descem ↓'}
c['funcoes'] = [{'nome': 'aip_evento_imutavel', 'descricao': 'Gatilho da AIP_EVENTO_LOG: recusa qualquer UPDATE ou DELETE, mantendo o Action Log imutável.'}]
json.dump(c, open('config.json', 'w'), ensure_ascii=False, indent=1)
print('ok', len(c['ligacoes']), 'ligações')
