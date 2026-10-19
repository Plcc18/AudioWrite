-- Schema for the audio transcription + human review service.
-- Run this in the Supabase SQL editor (or via psql) against your project's Postgres database.

create extension if not exists pgcrypto;

create table if not exists projects (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    filename text not null,
    audio_path text not null,
    status text not null default 'queued'
        check (status in ('queued', 'processing', 'needs_review', 'done', 'failed')),
    final_text text,
    -- true depois que o usuário edita o texto final livremente (PATCH /final-text).
    -- A partir daí, resolver trechos duvidosos continua marcando-os como
    -- resolvidos, mas para de reconstruir final_text automaticamente — a
    -- edição manual passa a ser a fonte da verdade (ver rebuild_final_text).
    manual_override boolean not null default false,
    -- Preenchido pelo worker ao concluir a transcrição (duração real do áudio,
    -- reportada pelo faster-whisper) — null até lá, e em projetos antigos que
    -- nunca foram reprocessados.
    duration_ms integer,
    error text,
    created_at timestamptz not null default now()
);

create index if not exists idx_projects_user_id on projects (user_id);

create table if not exists jobs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects (id) on delete cascade,
    type text not null default 'transcribe',
    status text not null default 'queued'
        check (status in ('queued', 'processing', 'done', 'failed')),
    attempts int not null default 0,
    error text,
    locked_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_jobs_status_created on jobs (status, created_at);
create index if not exists idx_jobs_project_id on jobs (project_id);

create table if not exists transcription_runs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects (id) on delete cascade,
    model text not null,
    params jsonb not null default '{}'::jsonb,
    is_reference boolean not null default false,
    segments jsonb not null default '[]'::jsonb,
    error text,
    created_at timestamptz not null default now()
);

create index if not exists idx_transcription_runs_project_id on transcription_runs (project_id);

create table if not exists doubtful_segments (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects (id) on delete cascade,
    start_ms int not null,
    end_ms int not null,
    reference_text text not null,
    alternatives jsonb not null default '[]'::jsonb,
    score double precision not null,
    status text not null default 'pending' check (status in ('pending', 'resolved')),
    resolved_text text,
    resolved_alternative_index int,
    created_at timestamptz not null default now()
);

create index if not exists idx_doubtful_segments_project_id on doubtful_segments (project_id);
create index if not exists idx_doubtful_segments_status on doubtful_segments (project_id, status);

-- Turnos brutos de diarização (worker/diarize.py, via pyannote.audio), um por
-- falante detectado. Imutáveis depois de escritos (mesmo padrão de
-- transcription_runs): a API combina isso com word_timings (já existente, ver
-- app/services/transcript.py) para montar os trechos por falante sob demanda.
-- Fica vazia se a diarização estiver desabilitada ou falhar para o projeto
-- (ver DIARIZATION_ENABLED) — nesse caso a API simplesmente não expõe falantes.
create table if not exists speaker_turns (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects (id) on delete cascade,
    start_ms int not null,
    end_ms int not null,
    speaker text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_speaker_turns_project_id on speaker_turns (project_id);
