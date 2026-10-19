# AudioWrite — backend

Serviço de transcrição de áudio com revisão humana. O áudio é transcrito várias
vezes com configurações diferentes do Whisper (via `faster-whisper`), as
versões são comparadas palavra a palavra e os trechos divergentes/de baixa
confiança ficam marcados para um humano confirmar.

## Arquitetura

- **API** (`app/`): FastAPI. Recebe uploads, serve o status/transcrição dos
  projetos, resolve trechos duvidosos e exporta o resultado. **Não precisa de
  GPU** nem de `faster-whisper` instalado.
- **Worker** (`worker/`): processo separado que faz polling na tabela `jobs`,
  baixa o áudio do Supabase Storage, converte com `ffmpeg`, transcreve com
  `faster-whisper` em 2+ configurações, calcula o consenso e grava o
  resultado. Pode rodar em outra máquina (seu notebook, um Colab, etc.) — só
  precisa acessar o mesmo Postgres/Storage do Supabase.
- **Banco**: Postgres do Supabase, acessado via SQL puro (`psycopg2`), sem
  ORM. **Storage**: bucket do Supabase Storage para os arquivos de áudio.
- **Fila**: tabela `jobs`. O worker reivindica um job com
  `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
  o que permite rodar vários workers em paralelo sem conflito.

## Estrutura

```
backend/
  app/
    api/projects.py      # rotas FastAPI
    core/{config,auth,db}.py
    models/schemas.py    # schemas pydantic
    services/{storage,transcript,export}.py
    main.py
  worker/
    main.py               # loop de polling + pipeline
    config.py, db.py, storage.py   # versões standalone (sem depender de app/)
    audio.py              # ffmpeg
    transcribe.py         # faster-whisper
    consensus.py          # alinhamento por tempo + detecção de trechos duvidosos
  tests/test_consensus.py
  schema.sql
  requirements.txt        # deps da API
  worker/requirements.txt # deps do worker (faster-whisper etc.)
  .env.example
```

## 1. Configurar o Supabase

1. Crie um projeto em https://supabase.com.
2. **SQL**: abra o SQL Editor e rode o conteúdo de `schema.sql` (cria as
   tabelas `projects`, `jobs`, `transcription_runs`, `doubtful_segments`).
3. **Storage**: crie um bucket privado chamado `audio` (Storage → New bucket,
   "Public" desmarcado). Se usar outro nome, ajuste `SUPABASE_STORAGE_BUCKET`.
4. **Credenciais** (Project Settings):
   - `SUPABASE_URL`: em *Settings → General* (ou na URL do dashboard — é
     `https://<project-ref>.supabase.co`).
   - `SUPABASE_SERVICE_ROLE_KEY`: em *Settings → API Keys*. Em projetos novos
     aparece como uma "secret key" (`sb_secret_...`); em projetos mais antigos
     é a chave `service_role` (JWT). Qualquer uma funciona — é usada pelo
     backend/worker para falar com o Storage com privilégio total. **Nunca
     exponha no frontend.**
   - `SUPABASE_JWT_SECRET`: **deixe em branco na maioria dos casos.** Projetos
     Supabase novos assinam os JWTs de usuário com uma chave assimétrica
     (ES256) e publicam a chave pública em
     `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` — a API busca essa chave
     automaticamente (`app/core/auth.py`) e valida o token sem precisar de
     segredo nenhum. Só preencha essa variável se o seu projeto ainda usa o
     segredo HS256 legado (*Settings → JWT Keys → Legacy JWT Secret*, com
     status "still used").
   - `DATABASE_URL`: em *Settings → Database → Connect → Direct* (aba
     "Connection string"), escolha o método **Session pooler** (não *Direct
     connection* — essa usa IPv6 por padrão e pode não funcionar na sua rede;
     e não *Transaction pooler* — o worker usa `SELECT ... FOR UPDATE SKIP
     LOCKED`, que precisa de uma sessão de verdade). A string vem como
     `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-...pooler.supabase.com:5432/postgres`
     — troque `[YOUR-PASSWORD]` pela senha do banco (definida na criação do
     projeto; se não souber, resete em *Database password → Reset password*,
     o que invalida conexões antigas). **Se a senha tiver caracteres
     especiais** (`@`, `+`, `/`, etc.), faça [percent-encoding](https://en.wikipedia.org/wiki/Percent-encoding)
     deles antes de montar a URL (ex.: `@` → `%40`, `+` → `%2B`).
5. Autenticação de usuários: use o Supabase Auth normalmente no seu frontend;
   a API só precisa do JWT (`Authorization: Bearer <token>`) que o Supabase
   Auth emite.

Copie `.env.example` para `.env` e preencha os valores.

## 2. Rodar a API localmente

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env         # edite com suas credenciais
uvicorn app.main:app --reload --port 8000
```

A API sobe em `http://localhost:8000` (docs interativos em `/docs`).

### Testes

```bash
pytest
```

Os testes cobrem `worker/consensus.py` (prioridade do projeto): palavras
iguais, palavras divergentes, versão mais curta (palavra faltando), timestamps
que não se sobrepõem, baixa confiança mesmo com concordância, e agrupamento de
palavras duvidosas consecutivas em um único trecho.

## 3. Rodar o worker (na sua máquina ou no Colab)

O worker é independente da API — instale só as deps dele:

```bash
cd backend
pip install -r worker/requirements.txt
```

Instale também o **ffmpeg** e garanta que esteja no `PATH`:
- Windows: `winget install ffmpeg` (ou baixe em ffmpeg.org e adicione ao PATH).
  Depois de instalar, **abra um terminal novo** — o `PATH` só é atualizado em
  processos criados depois da instalação.
- Mac: `brew install ffmpeg`
- Linux: `apt install ffmpeg`
- Colab: `!apt-get install -y ffmpeg`

Use o mesmo `.env` da API (`DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, etc.) — copie-o para a máquina do worker ou
exporte as variáveis diretamente.

```bash
python -m worker.main
```

Na primeira execução, o `faster-whisper` baixa os modelos configurados em
`WHISPER_RUNS` automaticamente (cache em `~/.cache/huggingface`). O download do
modelo `small` tem ~500MB; `medium` tem ~1.5GB — a primeira transcrição demora
mais por causa disso.

Rodar vários workers em paralelo (em máquinas diferentes ou não) é seguro: o
`SELECT ... FOR UPDATE SKIP LOCKED` garante que cada job é processado por um
único worker.

## Configurações do Whisper (`WHISPER_RUNS`)

Por padrão usamos o modelo `small` duas vezes, com `beam_size`/`temperature`
diferentes — roda em qualquer CPU sem precisar baixar um modelo maior. Para
mais precisão (ao custo de mais RAM/tempo), troque para `small` + `medium`:

```
WHISPER_RUNS=[{"model":"small","beam_size":5,"temperature":0.0},{"model":"medium","beam_size":5,"temperature":0.0}]
```

Qualquer lista com 2+ entradas funciona; cada entrada aceita `model`,
`beam_size` e `temperature`.

Para fixar o idioma (em vez de auto-detecção, que pode variar entre as
execuções e afetar sutilmente o alinhamento do consenso), defina
`WHISPER_LANGUAGE=pt` no `.env`. Deixe em branco para manter a auto-detecção
(comportamento original).

## Identificação de falantes (diarização)

Opcional e **best-effort**: se falhar por qualquer motivo (sem token, termos
do modelo não aceitos, dependências não instaladas, sem internet no primeiro
download, ...), o projeto continua sendo transcrito normalmente, só sem
rótulos de falante — nunca derruba o job.

Implementado com [pyannote.audio](https://github.com/pyannote/pyannote-audio)
(modelo `pyannote/speaker-diarization-3.1`), rodando sobre o mesmo WAV 16kHz
mono já gerado para o Whisper (`worker/diarize.py`). Os falantes são
remapeados para identificadores estáveis ("Falante 1", "Falante 2", ...) por
ordem de aparição no áudio — nunca tenta adivinhar quem é cada um.

### 1. Instalar as dependências (pesadas)

```bash
cd backend
pip install -r worker/requirements.txt
```

Isso agora inclui `pyannote.audio` + `torch`/`torchaudio` (build CPU por
padrão) — são ~1-2GB a mais de download/disco. Se não quiser essa dependência
de jeito nenhum, remova as 3 últimas linhas de `worker/requirements.txt` e
deixe `DIARIZATION_ENABLED=false` no `.env`.

### 2. Criar um token de acesso no Hugging Face

Os modelos usados pelo pyannote são **gated** (exigem aceitar os termos de
uso antes de poder baixar):

1. Crie uma conta gratuita em https://huggingface.co.
2. Acesse https://huggingface.co/pyannote/segmentation-3.0 e
   https://huggingface.co/pyannote/speaker-diarization-3.1 e aceite os termos
   de uso em cada um (botão "Agree and access repository").
3. Gere um token em https://huggingface.co/settings/tokens (tipo "Read" já
   é suficiente).
4. Adicione `HF_TOKEN=hf_xxx...` no `.env` do backend (o mesmo arquivo usado
   pelo worker).

Sem isso, `DIARIZATION_ENABLED` continua `true` por padrão, mas toda
diarização vai falhar silenciosamente (um `WARNING` no log do worker) e os
projetos saem sem `speaker_segments`.

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `DIARIZATION_ENABLED` | `true` | `false` desativa completamente (nem tenta carregar o pipeline) |
| `HF_TOKEN` | (vazio) | token do Hugging Face com acesso aos modelos gated acima |
| `DIARIZATION_DEVICE` | mesmo de `WHISPER_DEVICE` | `cpu` ou `cuda` |

### Limitações conhecidas

- **CPU é lento**: diarização em CPU pode levar bem mais tempo que a própria
  transcrição para áudios longos (dezenas de minutos+). Com `WHISPER_DEVICE`/
  `DIARIZATION_DEVICE=cuda` (GPU), é bem mais rápido.
- **Fala simultânea**: pyannote 3.1 detecta sobreposição de fala, mas cada
  palavra do Whisper ainda é atribuída a um único falante (o de maior
  sobreposição de tempo) — não há suporte a "duas pessoas falando a mesma
  palavra ao mesmo tempo" na exibição.
- **Sem correspondência = falante desconhecido**: trechos que não batem com
  nenhum turno detectado aparecem como "Falante desconhecido" no frontend, em
  vez de serem atribuídos a um falante arbitrário.
- Primeira execução baixa os modelos do Hugging Face (precisa de internet
  nesse momento); depois ficam em cache local (`~/.cache/huggingface`, igual
  ao faster-whisper).

### Testado de ponta a ponta (não só por inspeção de código)

Rodei o pipeline completo com diarização de verdade (token + termos aceitos
na sua conta Hugging Face) e três bugs reais de compatibilidade de versão
apareceram — já corrigidos em `worker/requirements.txt`/`worker/diarize.py`:

1. **`torch==2.5.1` não tem wheel para Python 3.13**: pip falhava com "No
   matching distribution found". `pyannote.audio` só exige `torch>=2.0.0`
   (sem teto), então fixamos `torch==2.7.1`/`torchaudio==2.7.1` (par mais
   recente com wheel pronto pra 3.13 no momento).
2. **`use_auth_token` removido do `huggingface_hub`**: `pyannote.audio` 3.3.2
   chama `hf_hub_download(..., use_auth_token=...)` internamente, mas não
   fixa um teto em `huggingface_hub` ("`>=0.13.0`"). O `huggingface_hub`
   fez um bump de versão major (1.0/2.0) que removeu esse parâmetro
   (renomeado pra `token` muito antes, mas só removido de vez nessa versão),
   quebrando com `TypeError: hf_hub_download() got an unexpected keyword
   argument 'use_auth_token'`. Fixamos `huggingface_hub==0.36.2` (última 0.x).
3. **`torch.load` com `weights_only=True` por padrão (PyTorch 2.6+)**: o
   checkpoint do pyannote (carregado via `pytorch_lightning`) foi salvo antes
   dessa mudança de segurança do PyTorch e quebra com `UnpicklingError:
   Weights only load failed... Unsupported global: ...TorchVersion`.
   `worker/diarize.py` usa um monkeypatch local (`_legacy_torch_load`),
   escopado só à chamada de `Pipeline.from_pretrained(...)`, forçando
   `weights_only=False` — aceitável aqui porque o checkpoint vem direto do
   org oficial `pyannote` no Hugging Face, atrás dos termos de uso que você
   já aceitou (não é um arquivo arbitrário de origem desconhecida).

Também descobri que `pyannote.audio` importa `matplotlib.pyplot` (em
`pyannote/audio/tasks/segmentation/mixins.py`, carregado sempre, mesmo sem
usar nenhuma função de plot) sem declará-lo como dependência — adicionei
`matplotlib` em `worker/requirements.txt` (mesmo padrão do `requests` que
faltava no `faster-whisper`, já documentado acima).

Depois de testar, apaguei os projetos de teste criados (áudio, linhas no
banco) — nenhum dado de teste ficou no seu Supabase.

## Pipeline

1. `POST /projects` (multipart, campo `file`) valida extensão/tamanho, sobe o
   áudio para o Storage e cria `projects` (status `queued`) + `jobs`
   (`type=transcribe`, status `queued`).
2. O worker reivindica o job, baixa o áudio, converte para WAV 16kHz mono com
   `ffmpeg`.
3. Para cada configuração em `WHISPER_RUNS`, transcreve com
   `word_timestamps=True`. Se uma configuração falhar, o erro é registrado em
   `transcription_runs.error` e o pipeline segue com as demais. Se todas
   falharem, o job e o projeto vão para `failed`.
4. `worker/consensus.py` escolhe a execução com maior confiança média como
   referência, alinha as palavras das outras execuções pela sobreposição de
   tempo, calcula um score de concordância + confiança média por palavra, e
   agrupa palavras duvidosas consecutivas em trechos (`doubtful_segments`).
5. O projeto vai para `needs_review` (se houver trechos duvidosos) ou `done`
   (se não houver). `final_text` = transcrição da versão de referência.
6. `PATCH /projects/{id}/segments/{segment_id}` resolve um trecho (aceitando
   uma alternativa ou digitando um texto). O `final_text` é reconstruído
   substituindo aquele intervalo de tempo. Quando não há mais trechos
   pendentes, o projeto vira `done`.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | `/projects` | upload do áudio, cria o projeto/job |
| GET | `/projects` | lista projetos do usuário autenticado |
| GET | `/projects/{id}` | status, `final_text`, trechos duvidosos |
| GET | `/projects/{id}/audio-url` | URL assinada do áudio (Storage) |
| PATCH | `/projects/{id}/segments/{segment_id}` | resolve um trecho duvidoso |
| GET | `/projects/{id}/export?format=txt\|srt\|docx` | exporta a transcrição final |

Todas as rotas (exceto `/health`) exigem `Authorization: Bearer <jwt do Supabase Auth>`.
Cada usuário só vê/edita os próprios projetos (filtrado por `user_id` em toda query).

## O que falta configurar manualmente

- **Modelos do Whisper**: nenhuma ação manual — são baixados automaticamente
  pelo `faster-whisper` na primeira transcrição (precisa de internet nesse
  momento; depois ficam em cache local, `~/.cache/huggingface`). O `small`
  tem ~500MB.
- **Emissão de JWT para testar**: use o fluxo normal do Supabase Auth
  (sign up/sign in pelo SDK do Supabase) para obter um `access_token` e
  mandar como `Authorization: Bearer ...` nas chamadas à API.
- Em produção (worker numa máquina diferente da API), lembre de rodar
  `pip install -r worker/requirements.txt` lá e ter o `ffmpeg` no `PATH`
  dessa máquina — ver seção 3.

### O que foi testado de ponta a ponta nesta sessão (não só por inspeção de código)

Instalei o `ffmpeg`, instalei `worker/requirements.txt`, criei um usuário de
teste no seu Supabase Auth (via Admin API) e rodei o pipeline completo com um
áudio de fala real (TTS do Windows): upload → worker (ffmpeg + 2x faster-whisper
`small`) → consenso/trechos duvidosos → `PATCH` resolvendo cada trecho →
projeto virou `done` → export `txt`/`srt`/`docx`. Todos os dados de teste
(arquivo no Storage, linhas no banco, usuário no Auth) foram removidos depois.

Três bugs reais apareceram só porque rodei de verdade, não por leitura de
código — já corrigidos:

1. **JWT assimétrico**: seu projeto Supabase assina os JWTs de usuário com
   chave ES256 (JWKS), não o segredo HS256 legado que eu tinha assumido de
   início. `app/core/auth.py` agora valida via JWKS automaticamente — não
   defina `SUPABASE_JWT_SECRET` a menos que seu projeto ainda use o modo
   legado ("Legacy JWT Secret" aparecendo como "still used" em *Settings →
   JWT Keys*).
2. **Alternativas duplicadas/perdidas quando dois runs usam o mesmo modelo**:
   a configuração padrão de `WHISPER_RUNS` roda `small` duas vezes (só muda
   `beam_size`/`temperature`). O código original indexava as alternativas de
   cada trecho duvidoso pelo nome do modelo — como os dois runs se chamam
   `small`, a segunda sobrescrevia a primeira e cada trecho mostrava só 1
   alternativa em vez de 2. Corrigido em `worker/consensus.py` (`Run.label`,
   único por configuração) com um teste de regressão em
   `tests/test_consensus.py`.
3. **`av` (PyAV) incompatível**: `faster-whisper==1.1.0` declara `av>=11` sem
   teto, então o `pip install` pega a versão mais nova (19.x), que removeu o
   argumento `metadata_errors` que o faster-whisper usa para abrir o áudio —
   toda transcrição falhava com
   `TypeError: open() got an unexpected keyword argument 'metadata_errors'`.
   Fixei `av==13.1.0` em `worker/requirements.txt`.
4. (Menor, de robustez) `faster-whisper` importa `requests` mas não o declara
   como dependência — adicionei `requests` em `worker/requirements.txt`.

Também notei e corrigi uma inconsistência entre exports: o `.srt` estava
usando a transcrição bruta da run de referência, ignorando as correções
feitas via `PATCH`, enquanto `.txt`/`.docx` já refletiam o texto revisado.
Agora os três exports usam o mesmo texto final corrigido
(`app/services/transcript.py:merge_resolved`, compartilhado com
`app/services/export.py`).

**Nota para quem for construir a tela de revisão**: a correção enviada em
`PATCH .../segments/{id}` substitui *exatamente* o intervalo de tempo do
trecho duvidoso (`start_ms`–`end_ms`), não a frase inteira ao redor. Se a UI
mostrar o contexto completo mas o reviewer digitar uma correção que inclui
palavras fora do trecho destacado, elas aparecem duplicadas no texto final.
A UI deve destacar/editar exatamente `reference_text` do trecho, não a frase
toda.

`backend/.env` já está preenchido com suas credenciais reais (URL, secret
key, connection string do pooler em modo Session) e `schema.sql` já estava
aplicado no seu projeto. Criei um `.gitignore` que exclui `.env` — confira
antes do primeiro commit se for iniciar um repositório git.
