# Variáveis de ambiente para RODAR OS TESTES — valores fictícios.
#
# O dublê (fake-mssql.js) nunca abre conexão de verdade: o server.js só
# precisa que as variáveis obrigatórias não estejam vazias. NUNCA coloque
# credencial verdadeira aqui (mesma regra do VBM Kaizen).
#
# Uso: source tests/env-exemplo.sh (o regressao.sh já faz isso).
export AZURE_SQL_SERVER=teste.database.windows.net
export AZURE_SQL_DATABASE=TESTE_PRD
export AZURE_SQL_PORT=1433
export AZURE_SQL_USER=teste
export AZURE_SQL_PASSWORD=teste
export COO_ID_DASH=15
