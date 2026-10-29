"""
Job agendado — ajusta o compute do Databricks App 'pci-portal' pelo horário.

Grade (horário de Brasília):
    00:00 – 04:59   desligado
    05:00 – 07:59   Medium
    08:00 – 16:59   Large
    17:00 – 23:59   Medium

O script é idempotente: olha a hora atual e só age se o app estiver fora do
estado esperado. Por isso pode rodar de hora em hora (cron Quartz
'0 0 * * * ?') — uma execução que falhar é corrigida pela seguinte — ou só
nas viradas ('0 0 0,5,8,17 * * ?'). Fuso do agendamento: America/Sao_Paulo.

Como configurar o job (Jobs & Pipelines > Create job):
  • Task type: Python script · Source: Git provider
    (https://github.com/002felip/pci-portal, branch main)
    Path: jobs/ajusta_compute_app.py
  • Compute: Serverless · Environment > Dependencies: databricks-sdk>=0.158.0
  • O "Run as" do job precisa de CAN MANAGE no app (botão Share do app).

Esta pasta não é servida pelo Portal (server.js só expõe as pastas das
aplicações e /assets), então o arquivo não fica acessível pela URL do app.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.apps import App, ComputeSize, ComputeState

APP_NAME = "pci-portal"
TZ = ZoneInfo("America/Sao_Paulo")


def compute_desejado(hora: int):
    """None = app desligado."""
    if 0 <= hora < 5:
        return None
    if 8 <= hora < 17:
        return ComputeSize.LARGE
    return ComputeSize.MEDIUM


def main():
    w = WorkspaceClient()  # dentro de um job, autentica com o "Run as"
    app = w.apps.get(APP_NAME)
    estado = app.compute_status.state if app.compute_status else None
    alvo = compute_desejado(datetime.now(TZ).hour)
    print(f"[{APP_NAME}] atual: {app.compute_size} / {estado} -> alvo: {alvo or 'desligado'}")

    if alvo is None:
        if estado not in (ComputeState.STOPPED, ComputeState.STOPPING):
            print("Desligando o app...")
            w.apps.stop(APP_NAME).result()
        return

    if app.compute_size != alvo:
        # create_update com update_mask altera SÓ o compute_size. O apps.update
        # é substituição completa: campos omitidos seriam apagados (resources
        # db-user, db-password, sql-warehouse, database etc.).
        print(f"Mudando compute para {alvo.value}...")
        w.apps.create_update_and_wait(
            app_name=APP_NAME,
            update_mask="compute_size",
            app=App(name=APP_NAME, compute_size=alvo),
        )

    if estado in (ComputeState.STOPPED, ComputeState.STOPPING):
        print("Ligando o app (sobe o último deployment)...")
        w.apps.start(APP_NAME).result()

    print("OK")


if __name__ == "__main__":
    main()
