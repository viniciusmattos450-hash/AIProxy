# AIProxy

Ponte local entre o chat do DeepSeek no navegador e o seu PC: a extensão captura
blocos `[SCRIPT]` das respostas da IA e executa localmente com sandbox, além de
um servidor com memória persistente do projeto e um CLI de terminal.

Extraído como repositório próprio a partir de `roguelike-playground`.

## O que é

- **`server.py`** — servidor HTTP local (`http://127.0.0.1:8765`, threading).
  Expõe a API da ponte (`/ping`, execução de scripts com timeout de 120s e
  limite de 200KB de saída), mantém **memória do projeto** em `.bridge/`
  (`memory.md`, `todo.json`, `log.jsonl` com backups automáticos) e um canal
  de outbox/streaming para o CLI. Tudo confinado à pasta do projeto
  (`BRIDGE_PROJECT`, caminhos fora dela são bloqueados).
- **`ds_cli.py`** — cliente de terminal (DeepSeek CLI): conversa com o servidor,
  anexa arquivos (`/file`), roda comandos shell (`/run`), gerencia tarefas
  (`/todos`), pede briefing de contexto e acompanha respostas em streaming.
- **`ds_bridge/`** — extensão para Chrome (Manifest V2): injeta `content.js` em
  `https://chat.deepseek.com/*` e usa `bg.js` para despachar os blocos
  `[SCRIPT]` ao servidor local.
- **`run-server.bat` / `ds.bat`** — lançadores Windows do servidor e do CLI.

## Como usar

Requisitos: Windows + Python 3.x + Chrome.

1. **Suba o servidor** — duplo-clique em `run-server.bat`, informe a pasta do
   projeto (ela vira o `BRIDGE_PROJECT`, onde ficam `.bridge/` e os arquivos).
2. **Instale a extensão** — abra `chrome://extensions`, ative o modo
   desenvolvedor, "Carregar sem compactação" e selecione a pasta `ds_bridge/`.
3. **Converse no DeepSeek** — blocos `[SCRIPT]` nas respostas são oferecidos
   para execução local via ponte.
4. **Use o terminal** — `ds.bat` abre o CLI (`/help` lista os comandos).

> Os arquivos de `.bridge/` (memória, todos, logs) são estado local de cada
> projeto e **não** vão para o git (ver `.gitignore`).
