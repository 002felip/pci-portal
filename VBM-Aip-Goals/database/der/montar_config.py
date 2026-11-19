"""Monta o config.json do DER do AIP Goals a partir do esqueleto (esqueleto_config.py) + textos abaixo.
Uso: python3 montar_config.py  (lê schema.json e config.json do esqueleto; grava config.json)"""
import json

s = json.load(open('schema.json'))
c = json.load(open('config.json'))
alt = {t['name']: 40 + 19 * len(t['cols']) for t in s['tables']}

c['titulo'] = 'DER do AIP Goals'
c['subtitulo'] = 'VBM AIP Goals · modelo proposto (fase 1) · Azure SQL, convenções do Schema IBP · 19/11/2026'
c['descricao_svg'] = 'Diagrama do banco do AIP Goals: o ciclo e os grupos à esquerda, o desdobramento de metas e pesos no centro, o Goal Card com versões e decisões e, à direita, comentários, log e notificações.'
c['legenda_figura'] = ('O <b>AIP_GOAL_CARD</b> é o centro: uma meta do desdobramento numa unidade (BU), com versões, decisão do grupo de aprovação e comentários. '
    'O <b>AIP_CICLO</b> organiza tudo, com as datas da jornada: só um ciclo fica aberto por vez. Pessoas vêm do MDM pela matrícula (CD_MATRICULA). '
    'Passe o mouse numa linha para ver o nome da regra. <b>Clique numa tabela para ver aqui o detalhe dela: cada campo explicado, com exemplo, ligações e regras.</b>')
c['texto_exemplos'] = ('Linhas fictícias, gravadas num banco de teste e aprovadas por todas as regras (exemplos.sql). Campos SG_ usam S/N, como no esquema IBP. Os IDs batem entre as tabelas: '
    'o AIP 2027 (ciclo 2) foi criado a partir do AIP 2026; o Goal Card GC-ONT-04 teve a v1 devolvida para ajuste na unidade e na régua (o comentário e a resposta estão no log), e o GC-ONP-04 foi aprovado. '
    'As matrículas são fictícias. Clique numa tabela do diagrama para destacar o exemplo dela.')
c['grupos'] = {
    'cic': {'nome': 'CICLO', 'claro': '#dfe8e2', 'escuro': '#233229'},
    'des': {'nome': 'DESDOBRAMENTO', 'claro': '#efe6d6', 'escuro': '#352d1f'},
    'gc': {'nome': 'GOAL CARD', 'claro': '#dde6ef', 'escuro': '#1f2c38'},
    'aud': {'nome': 'LOG', 'claro': '#e9e1ec', 'escuro': '#2e2533'},
    'ibp': {'nome': 'IBP', 'claro': '#e6e6e6', 'escuro': '#2b2b2b'},
}
c['grupo_destaque'] = 'gc'
c['layout'] = {'largura_tabela': 330, 'colunas': [20, 440, 860, 1280]}
c['formato'] = {'moeda': '', 'decimal': ',', 'fuso_horas': -3, 'prefixos_moeda': [], 'prefixos_percentual': []}

colunas = [
    ('cic', ['AIP_CICLO', 'AIP_PAPEL', 'SITES']),
    ('des', ['AIP_NIVEL', 'AIP_UNIDADE', 'AIP_META', 'AIP_META_PESO']),
    ('gc', ['AIP_GOAL_CARD', 'AIP_GOAL_CARD_VERSAO', 'AIP_NOTIFICACAO']),
    ('aud', ['AIP_EVENTO_LOG']),
]
grupo_de = {'SITES': 'ibp', 'AIP_NOTIFICACAO': 'aud'}
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
  'proposito': 'Um ciclo anual do AIP (ex.: AIP 2027), com as datas das 4 etapas da jornada. Só um ciclo pode estar aberto; os fechados ficam para consulta e podem ser reabertos se não houver outro aberto.',
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
   'CD_MATRICULA_FECHAMENTO': 'Matrícula de quem fechou. Preenchida só se FECHADO.',
   'DT_INI_DESDOBRAMENTO': 'Início da etapa 1, Desdobramento COO (início da jornada).',
   'DT_FIM_DESDOBRAMENTO': 'Fim do Desdobramento COO; a etapa 2, Propostas BU\'s, começa aqui.',
   'DT_FIM_PROPOSTA': 'Fim das Propostas BU\'s; começa a Calibração e Aprovação.',
   'DT_FIM_CALIBRACAO': 'Fim da Calibração e Aprovação; começa o Goal Card oficial.',
   'DT_FIM_OFICIAL': 'Fim da jornada: Goal Cards oficiais publicados.'},
  'regras': ['Só um ciclo com TP_STATUS = ABERTO por vez (índice único parcial).', 'Ano entre 2020 e 2100 e único.', 'TP_STATUS: ABERTO ou FECHADO.', 'Data e matrícula de fechamento preenchidas se, e só se, o ciclo estiver FECHADO.', 'Datas da jornada em ordem: cada etapa termina depois da anterior.', 'Janelas editáveis só com o ciclo aberto (a tela desativa as de ciclo fechado).'],
  'condicional': {'DT_FECHAMENTO': 'se FECHADO', 'CD_MATRICULA_FECHAMENTO': 'se FECHADO'},
  'exemplos': ['1 · AIP 2026, fechado', '2 · AIP 2027, aberto, criado do 2026']},
 'AIP_PAPEL': {
  'proposito': 'Quem participa do ciclo e em qual grupo: contribuidores e consulta por BU, grupo de aprovação e administradores. Os dados da pessoa vêm do MDM.',
  'campos': {
   'ID_PAPEL': 'Número interno da participação.',
   'ID_CICLO': 'Ciclo em que o papel vale.',
   'CD_MATRICULA': 'Matrícula da pessoa; nome, e-mail, cargo, estado e cidade são lidos do MDM.',
   'TP_GRUPO': 'CONTRIBUIDOR, APROVACAO, CONSULTA ou ADMIN.',
   'ID_SITE': 'BU (site do IBP) do contribuidor ou da consulta. Vazio para aprovação e administração.',
   'SG_ATIVO': 'N = a pessoa perde o acesso sem apagar o histórico.',
   'DT_INCLUSAO': 'Quando foi incluída (popup Adicionar usuário).',
   'CD_MATRICULA_INCLUSAO': 'Quem incluiu.'},
  'regras': ['TP_GRUPO: CONTRIBUIDOR, APROVACAO, CONSULTA, ADMIN.', 'BU obrigatória para contribuidor e consulta; vazia para aprovação e administrador.', 'Uma pessoa não se repete no mesmo grupo e BU do ciclo.'],
  'condicional': {'ID_SITE': 'se contribuidor ou consulta'},
  'exemplos': ['1 · Contribuidor de Ontario', '2 · Grupo de aprovação', '3 · Administrador']},
 'SITES': {
  'proposito': 'Tabela já existente do IBP (IBP.SITES): cada site é uma BU do AIP. ID_SITE é o identificador da BU em todo o modelo; o AIP só lê esta tabela.',
  'campos': {'ID_SITE': 'Identificador do site, usado como ID da BU no AIP.', 'ID_SISTEMA': 'Sistema do IBP a que o site pertence.', 'NM_SITE': 'Nome do site, mostrado como nome da BU (ex.: Ontario).', 'NM_PAIS': 'País ou região que agrupa as BUs nas telas.', 'SG_REGIAO': 'Sigla de região do IBP.'},
  'regras': ['Tabela do esquema IBP, mantida fora do AIP; no Azure SQL as FKs apontam para IBP.SITES.', 'Recriada aqui só para o teste do DER.'],
  'exemplos': ['12 · Onça Puma, Brasil', '15 · Ontario, Canadá']},
 'AIP_NIVEL': {
  'proposito': 'Os níveis do desdobramento de pontos do ciclo (CEO → COO → BU; GG e GA ficam fora no primeiro momento): total de pontos por unidade, quanto vem do nível acima e se o nível é obrigatório.',
  'campos': {
   'ID_NIVEL': 'Número interno do nível.',
   'ID_CICLO': 'Ciclo do nível.',
   'CD_NIVEL': 'CEO, COO ou BU.',
   'NO_ORDEM': 'Posição no desdobramento (1 = CEO).',
   'NM_NIVEL': 'Nome mostrado nas telas; editável.',
   'QTDE_PONTOS_TOTAL': 'Pontos que cada unidade do nível precisa fechar (ex.: 100).',
   'QTDE_PONTOS_HERDADOS': 'Pontos que vêm do resultado do nível acima (linha "Resultado do …", editável em Metas e pesos). O restante vai para as metas do nível.',
   'SG_OBRIGATORIO': 'S = Obrigatório (sempre no desdobramento), N = Opcional; escolhido em Parâmetros.',
   'SG_ATIVO': 'S = nível em uso. Nível obrigatório fica sempre S.'},
  'regras': ['Um nível de cada tipo por ciclo.', 'Total de 1 a 1000; herdado de 0 até total − 1; o primeiro nível não herda.', 'Nível obrigatório fica sempre ativo.', 'CD_NIVEL: CEO, COO ou BU (GG e GA entram depois, se necessário).'],
  'exemplos': ['1 · CEO, 100 pts', '2 · COO, 75 herdados do CEO', '3 · BU, 40 herdados do COO']},
 'AIP_UNIDADE': {
  'proposito': 'As unidades de cada nível do ciclo: CEO VBM, COO VBM, cada BU (site do IBP). É quem recebe pesos e Goal Cards; a unidade de nível BU é também a participação da BU no ciclo.',
  'campos': {'ID_UNIDADE': 'Número interno da unidade.', 'ID_NIVEL': 'Nível da unidade.', 'NM_UNIDADE': 'Nome mostrado (ex.: Ontario).', 'ID_SITE': 'BU (site do IBP) correspondente, quando a unidade é do nível BU.', 'SG_ATIVA': 'N = BU tirada do ciclo: não recebe Goal Cards nem notificações e sai das somas, sem apagar o histórico.'},
  'regras': ['Nome único dentro do nível.', 'ID_SITE preenchido só nas unidades de nível BU.', 'SG_ATIVA: S ou N.'],
  'condicional': {'ID_SITE': 'se nível BU'},
  'exemplos': ['1 · CEO VBM', '2 · COO VBM', '3 · Onça Puma (site 12)']},
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
  'proposito': 'Cada submissão gera uma versão (v1, v2…) com a foto de todos os campos, e recebe a decisão do grupo de aprovação (nível único) com a marcação de cada seção. É o que as telas Versões e Aprovações usam.',
  'campos': {'ID_VERSAO': 'Número interno da versão.', 'ID_GOAL_CARD': 'Card da versão.', 'NO_VERSAO': 'Número da versão no card (1, 2…).', 'TP_MOTIVO': 'SUBMISSAO, RESUBMISSAO ou REABERTURA.', 'DS_CAMPOS': 'Foto dos campos do card no momento da submissão.', 'DT_VERSAO': 'Quando foi submetida.', 'CD_MATRICULA_AUTOR': 'Quem submeteu.', 'TP_DECISAO': 'APROVADO, DEVOLVIDO ou NEGADO. Vazio = aguardando decisão.', 'DS_COMENTARIO_DECISAO': 'Justificativa da decisão; obrigatória para devolver ou negar (mínimo de caracteres controlado na aplicação).', 'DS_REVISAO_SECOES': 'Marcação de cada seção na decisão: OK ou AJUSTAR (ex.: {"UNIT": "AJUSTAR"}). Devolver exige ao menos uma AJUSTAR.', 'DT_DECISAO': 'Quando foi decidida.', 'CD_MATRICULA_DECISAO': 'Membro do grupo que decidiu (não pode ser quem editou ou submeteu, RN-12).'},
  'regras': ['Número de versão único por card.', 'TP_MOTIVO: SUBMISSAO, RESUBMISSAO, REABERTURA.', 'Os campos da versão não mudam depois da submissão; a decisão é gravada uma única vez (decisão idempotente).', 'TP_DECISAO: APROVADO, DEVOLVIDO, NEGADO; data, quem decidiu e revisão das seções vêm juntos.', 'Comentário obrigatório se DEVOLVIDO ou NEGADO.'],
  'condicional': {'TP_DECISAO': 'depois da decisão', 'DS_COMENTARIO_DECISAO': 'se devolvido ou negado', 'DS_REVISAO_SECOES': 'depois da decisão', 'DT_DECISAO': 'depois da decisão', 'CD_MATRICULA_DECISAO': 'depois da decisão'},
  'exemplos': ['1 · v1 do GC-ONT-04, devolvida', '2 · v1 do GC-ONP-04, aprovada']},
 'AIP_EVENTO_LOG': {
  'proposito': 'A linha do tempo única e imutável do ciclo (Action Log): submissões, decisões, comentários do Goal Card (com respostas), mudanças de configuração e abertura/fechamento de ciclo, com antes e depois.',
  'campos': {
   'ID_EVENTO': 'Número interno do evento.', 'ID_CICLO': 'Ciclo do evento.',
   'TP_EVENTO': 'SUBMISSAO, RECOLHIMENTO, DECISAO, REABERTURA, COMENTARIO, CONFIGURACAO, CICLO_ABERTO, CICLO_FECHADO, CICLO_REABERTO ou ACESSO_NEGADO.',
   'DT_EVENTO': 'Quando aconteceu.', 'CD_MATRICULA': 'Quem fez.', 'TP_GRUPO': 'Grupo da pessoa no momento (mostrado ao lado do nome).',
   'ID_GOAL_CARD': 'Card envolvido. Vazio em eventos de ciclo e configuração.', 'CD_SECAO': 'Seção envolvida, quando houver.', 'DS_COMENTARIO': 'Texto do comentário (eventos COMENTARIO) ou da justificativa da decisão.', 'ID_EVENTO_PAI': 'Comentário respondido. Vazio = comentário novo.',
   'DS_ANTES': 'Valor antes da mudança.', 'DS_DEPOIS': 'Valor depois da mudança.'},
  'regras': ['Registro imutável: um gatilho bloqueia UPDATE e DELETE.', 'TP_EVENTO numa lista fixa (inclui abrir, fechar e reabrir ciclo).', 'Evento COMENTARIO exige texto, card e seção.'],
  'condicional': {'DS_COMENTARIO': 'se comentário', 'ID_EVENTO_PAI': 'se resposta'},
  'exemplos': ['1 · AIP 2026 fechado', '2 · v1 do GC-ONT-04 submetida', '3 · Aprovador comenta na Unit']},
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
 ('AIP_CICLO', 'ID_CICLO_ORIGEM'): 'criado a partir de',
 ('AIP_PAPEL', 'ID_CICLO'): 'participa de', ('AIP_PAPEL', 'ID_SITE'): 'atua na',
 ('AIP_NIVEL', 'ID_CICLO'): 'nível de', ('AIP_UNIDADE', 'ID_NIVEL'): 'pertence ao', ('AIP_UNIDADE', 'ID_SITE'): 'representa',
 ('AIP_META', 'ID_NIVEL'): 'meta do', ('AIP_META', 'ID_META_ORIGEM'): 'desdobrada de',
 ('AIP_META_PESO', 'ID_META'): 'peso da', ('AIP_META_PESO', 'ID_UNIDADE'): 'na unidade',
 ('AIP_GOAL_CARD', 'ID_META'): 'card da', ('AIP_GOAL_CARD', 'ID_UNIDADE'): 'da unidade',
 ('AIP_GOAL_CARD_VERSAO', 'ID_GOAL_CARD'): 'versão de',

 ('AIP_EVENTO_LOG', 'ID_EVENTO_PAI'): 'responde a', ('AIP_EVENTO_LOG', 'ID_CICLO'): 'registrado em',
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
c['secoes_extras'].append({'id': 'enxuto', 'html': (
 '<section class="explica" id="enxuto"><h2>O que foi simplificado nesta revisão</h2>'
 '<p>De 16 para 10 tabelas do AIP, sem perder nenhuma regra das telas:</p>'
 '<ul class="fn">'
 '<li><code>AIP_CICLO_JANELA</code><span>As 4 etapas são fixas: viraram colunas de data do AIP_CICLO.</span></li>'
 '<li><code>AIP_CICLO_BU</code><span>A BU no ciclo já é a unidade de nível BU da AIP_UNIDADE (com SG_ATIVA).</span></li>'
 '<li><code>AIP_BU</code><span>A BU é o site da IBP.SITES (ID_SITE).</span></li>'
 '<li><code>AIP_DECISAO</code> e <code>AIP_REVISAO_SECAO</code><span>Uma decisão por versão: viraram colunas da AIP_GOAL_CARD_VERSAO, com a marcação das seções em DS_REVISAO_SECOES.</span></li>'
 '<li><code>AIP_COMENTARIO</code><span>Cada comentário já era um evento do Action Log: agora é só o evento COMENTARIO, com resposta em ID_EVENTO_PAI.</span></li>'
 '<li><code>GG e GA</code><span>Fora no primeiro momento: o desdobramento vai até a BU, e a AIP_UNIDADE perdeu a unidade-mãe.</span></li>'
 '</ul></section>')})
c['tabelas']['AIP_NIVEL']['link_extra'] = {'href': '#como-pontos', 'texto': 'Ver como os pontos descem ↓'}
c['tabelas']['AIP_META_PESO']['link_extra'] = {'href': '#como-pontos', 'texto': 'Ver como os pontos descem ↓'}
c['funcoes'] = [{'nome': 'aip_evento_imutavel', 'descricao': 'Gatilho da AIP_EVENTO_LOG: recusa qualquer UPDATE ou DELETE, mantendo o Action Log imutável.'}]
json.dump(c, open('config.json', 'w'), ensure_ascii=False, indent=1)
print('ok', len(c['ligacoes']), 'ligações')
