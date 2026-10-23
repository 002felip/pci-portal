# Variáveis de ambiente para RODAR OS TESTES — valores fictícios.
#
# Os dublês (fake-mssql-*.js) nunca abrem conexão de verdade: o server.js
# só PRECISA que as 4 variáveis obrigatórias (checkConfig) não estejam
# vazias, nunca valida se apontam para um banco real. Não coloque
# credencial verdadeira aqui — é exatamente o problema que este arquivo
# existe para evitar (ver app.yaml e o histórico do diagnóstico de
# segurança de 20/09/2026).
#
# Uso: source tests/env-exemplo.sh antes de rodar tests/regressao.sh
# (o próprio regressao.sh já faz isso).

export AZURE_SQL_SERVER=teste.database.windows.net
export KAIZEN_AZURE_SQL_DATABASE=TESTE
export AZURE_SQL_PORT=1433
export AZURE_SQL_SCHEMA=ci
export AZURE_SQL_TABLE=kzn_aprovador
export AZURE_SQL_USER=teste
export AZURE_SQL_PASSWORD=teste
export AZURE_STORAGE_ACCOUNT=https://exemplo.blob.core.windows.net/exemplo
export AZURE_STORAGE_CONTAINER='05 - Kaizen'
export AZURE_STORAGE_SAS_TOKEN='sp=r&sig=exemplo'
