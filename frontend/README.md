# AudioWrite — frontend

Frontend em Next.js (App Router + TypeScript) para o serviço de transcrição de
áudio com revisão humana. Consome a API FastAPI em `../backend` — não tem
nenhuma lógica de transcrição própria.

## Stack

- Next.js 15 (App Router) + React 18 + TypeScript
- Tailwind CSS
- `wavesurfer.js` para a forma de onda do áudio
- `@supabase/supabase-js` + `@supabase/ssr` para autenticação (sessão em
  cookies, usada pelo `middleware.ts` para proteger rotas)
- `vitest` para os testes unitários

## 1. Rodar localmente

```bash
cd frontend
npm install
cp .env.example .env.local   # edite com suas credenciais (seção 2)
npm run dev
```

Abre em `http://localhost:3000`.

## 2. Configurar variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

| Variável | Onde encontrar |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Painel do Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Painel do Supabase → Project Settings → API Keys (chave `anon`/pública — **nunca** a `service_role`) |
| `NEXT_PUBLIC_API_URL` | URL onde a API FastAPI do `backend/` está rodando (ex.: `http://localhost:8000` local, ou a URL pública depois do deploy do backend) |

Este frontend usa o **mesmo projeto Supabase** do backend (`backend/README.md`,
seção 1) — é o Supabase Auth desse projeto que emite o JWT que a API valida.

### CORS no backend

O backend precisa aceitar requisições vindas da origem deste frontend. Isso é
controlado pela variável `FRONTEND_ORIGINS` no `.env` do backend (lista
separada por vírgula). Em desenvolvimento local já vem configurado para
`http://localhost:3000`; ao fazer deploy, adicione a URL da Vercel lá também
(veja a seção 4).

## 3. Testes

```bash
npm test
```

Cobertura:
- `lib/api.test.ts`: cliente HTTP (`lib/api.ts`) — header `Authorization`,
  parsing de erro (`ApiError`), falha de rede.
- `lib/segments.test.ts`: lógica de avanço para o próximo trecho pendente
  (`lib/segments.ts`) e navegação por setas entre trechos.

## 4. Deploy na Vercel (plano Hobby/gratuito)

1. Suba este repositório no GitHub (ou outro provedor suportado pela Vercel).
2. Na Vercel: **New Project** → selecione o repositório → em **Root
   Directory** escolha `frontend/` (o backend não faz parte deste deploy).
3. Em **Environment Variables**, adicione as três variáveis da seção 2 com os
   valores de produção (a `NEXT_PUBLIC_API_URL` deve apontar para onde o
   backend FastAPI estiver publicamente acessível — a Vercel Hobby não hospeda
   o backend Python/worker, só este frontend).
4. Deploy. Depois do primeiro deploy, copie a URL gerada
   (`https://seu-app.vercel.app`) e adicione-a em `FRONTEND_ORIGINS` no `.env`
   do backend (e reinicie a API) para o CORS liberar as chamadas do navegador.
5. No painel do Supabase, em **Authentication → URL Configuration**, adicione
   a URL da Vercel em "Redirect URLs"/"Site URL" se for usar fluxos que
   redirecionam de volta para o site (login por e-mail/senha simples não
   precisa disso, mas é bom deixar configurado).

Tudo isso roda no plano gratuito: Next.js na Vercel Hobby, Supabase no plano
Free (Auth + Postgres + Storage). O backend/worker (FastAPI + faster-whisper)
continua fora da Vercel — ver `backend/README.md` para onde rodá-lo.

## Decisões tomadas onde o contrato deixava margem

Foram confirmadas lendo o código real do backend (`../backend/app`), não
assumidas:

- **Body do PATCH de resolução de trecho**: o schema real
  (`ResolveSegmentIn`) é `{"action": "accept_alternative", "alternative_index": N}`
  ou `{"action": "custom_text", "text": "..."}` — é isso que `lib/api.ts`
  envia. Os tipos estão em `lib/types.ts`.
- **Progresso durante `queued`/`processing`**: a API não expõe uma "etapa
  atual", só o status geral. A tela de projeto mostra uma barra indeterminada
  com uma mensagem por status, e faz polling em `GET /projects/{id}` a cada 5s
  até o status deixar de ser `queued`/`processing`. Se o backend algum dia
  passar a expor um campo de progresso granular, é só consumir em
  `app/projects/[id]/page.tsx` (`ProcessingIndicator`).
- **Destaque dos trechos duvidosos no texto**: o `final_text` retornado pelo
  backend já vem com os trechos *resolvidos* mesclados — só os trechos ainda
  `pending` precisam ser localizados e marcados visualmente. `Transcript.tsx`
  procura a substring exata de `reference_text` de cada trecho pendente
  dentro do `final_text`, na ordem de `start_ms`. Importante: a correção do
  usuário substitui **exatamente** esse intervalo de tempo (`start_ms`–
  `end_ms`), não a frase inteira ao redor — por isso o campo de correção edita
  apenas `reference_text`, nunca o parágrafo completo (isso está documentado
  no `backend/README.md` como um alerta explícito para quem construísse esta
  tela).
- **Confiança do trecho**: `score` no backend é uma fração de concordância
  entre as execuções do Whisper (0 a 1). A UI mostra como percentual no
  tooltip/badge (`title="Confiança: N%"`), e nunca só por cor — também tem
  texto e um ícone ⚠️, para acessibilidade.
- **Contador de pendências na lista de projetos**: `GET /projects` não traz
  `doubtful_segments` (só `GET /projects/{id}` traz). Para mostrar a contagem
  real, a lista busca o detalhe só dos projetos com status `needs_review`
  (não todos, para evitar N+1 desnecessário nos outros status).
- **Reenviar áudio após `failed`**: não existe endpoint de retry/reprocessamento
  no backend. O botão "Reenviar áudio" na tela de um projeto `failed` abre um
  seletor de arquivo e cria um **novo projeto** (`POST /projects`) — o
  projeto antigo com falha continua na lista, para referência.
- **Exportar com pendências**: usa `window.confirm` nativo (sem dependência
  extra) quando `pendingCount > 0`.
- **URL assinada do áudio**: `GET /projects/{id}/audio-url` expira
  (`expires_in`, 1h por padrão no backend). Durante a revisão, o frontend
  renova essa URL automaticamente ~1 minuto antes de expirar.
- **Validação de arquivo no cliente**: extensões `mp3,m4a,wav,ogg,opus` e
  50MB, espelhando os defaults do backend
  (`backend/app/core/config.py`, `MAX_UPLOAD_MB`/`ALLOWED_AUDIO_EXTENSIONS`).
  Se esses defaults mudarem no backend (variáveis de ambiente), ajuste as
  constantes em `lib/types.ts` (`ALLOWED_AUDIO_EXTENSIONS`, `MAX_UPLOAD_MB`)
  para a validação client-side continuar coerente — a API sempre revalida do
  lado dela de qualquer forma.
- **Autenticação/proteção de rotas**: usa `@supabase/ssr` com sessão em
  cookies para que `middleware.ts` consiga checar a sessão antes de renderizar
  qualquer rota sob `/projects`, redirecionando para `/login` quando não
  autenticado (e o inverso: usuário autenticado em `/login` é redirecionado
  para `/projects`).
- **CORS**: o backend original não tinha `CORSMiddleware` configurado, o que
  bloquearia todas as chamadas do navegador vindas de um domínio diferente
  (como o da Vercel). Foi adicionado `CORSMiddleware` em `backend/app/main.py`,
  controlado pela variável `FRONTEND_ORIGINS` — é a única alteração feita
  fora da pasta `frontend/`, necessária para o frontend funcionar.

## O que falta configurar manualmente

- **Projeto no Supabase**: se ainda não existe, siga `backend/README.md`
  (seção "1. Configurar o Supabase") — schema, bucket de Storage e
  credenciais. Login/cadastro aqui no frontend usam o Supabase Auth desse
  mesmo projeto; nenhuma conta de teste vem pré-criada.
- **URL do backend em produção**: a Vercel Hobby só hospeda este frontend. A
  API FastAPI (e o worker, que precisa de `ffmpeg`/`faster-whisper`) precisam
  rodar em algum outro lugar (sua máquina, uma VM, Render, Railway, etc. —
  qualquer host que sirva um processo Python de longa duração). Depois de
  decidir onde, aponte `NEXT_PUBLIC_API_URL` para essa URL.
- **Variáveis de ambiente na Vercel**: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` precisam ser
  cadastradas no painel do projeto na Vercel (Settings → Environment
  Variables) — elas não são lidas de nenhum arquivo commitado.
- **`FRONTEND_ORIGINS` no backend**: depois de saber a URL final da Vercel,
  adicione-a à lista (separada por vírgula) na configuração do backend e
  reinicie a API, ou as chamadas do navegador serão bloqueadas por CORS.
- **Criar um usuário**: use a tela de cadastro (`/login`, alternar para
  "Cadastre-se") para criar a primeira conta — ela pode exigir confirmação de
  e-mail dependendo da configuração do seu projeto Supabase
  (Authentication → Providers → Email).

## Estrutura

```
frontend/
  app/
    layout.tsx
    globals.css
    page.tsx                   # redireciona "/" -> /projects
    (auth)/login/page.tsx
    projects/page.tsx          # lista de projetos
    projects/new/page.tsx      # upload
    projects/[id]/page.tsx     # status/processamento + revisão + export
  components/
    AudioPlayer.tsx            # wavesurfer.js, toca um intervalo [start,end]
    Transcript.tsx             # final_text com trechos pendentes destacados
    DoubtfulSegment.tsx        # alternativas + correção livre de um trecho
    StatusBadge.tsx
    ExportMenu.tsx
    TopBar.tsx                 # cabeçalho com logout
  lib/
    api.ts                     # cliente fetch tipado (+ upload com progresso)
    supabase.ts                # cliente Supabase (browser)
    types.ts                   # espelha os schemas Pydantic do backend
    segments.ts                # lógica pura de navegação entre pendentes
    hooks/usePolling.ts
    validateAudioFile.ts
    *.test.ts
  middleware.ts                 # protege /projects via sessão Supabase
  tailwind.config.ts / postcss.config.js
  .env.example
```
