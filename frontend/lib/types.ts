// Espelha exatamente os schemas Pydantic do backend (app/models/schemas.py).
// Os nomes de campo são snake_case porque é assim que o FastAPI serializa.

export type ProjectStatus = "queued" | "processing" | "needs_review" | "done" | "failed";

export interface Project {
  id: string;
  filename: string;
  status: ProjectStatus;
  final_text: string | null;
  // true depois de uma edição livre (PATCH /final-text): o backend para de
  // reconstruir final_text a partir dos trechos resolvidos.
  manual_override: boolean;
  // Preenchido pelo worker ao concluir a transcrição — null antes disso, e em
  // projetos antigos que nunca foram reprocessados.
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface Alternative {
  model: string;
  params: Record<string, unknown>;
  text: string;
}

export type SegmentStatus = "pending" | "resolved";

export interface DoubtfulSegment {
  id: string;
  start_ms: number;
  end_ms: number;
  reference_text: string;
  alternatives: Alternative[];
  score: number; // 0..1, fração de concordância entre as execuções do Whisper
  status: SegmentStatus;
  resolved_text: string | null;
}

export interface WordTiming {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface SpeakerSegment {
  start_ms: number;
  end_ms: number;
  // null para trechos que não bateram com nenhum falante detectado (nunca
  // atribuído arbitrariamente — ver backend: app/services/speakers.py).
  speaker: string | null;
  text: string;
}

export interface ProjectDetail extends Project {
  doubtful_segments: DoubtfulSegment[];
  // Vazio enquanto não há transcrição pronta, ou depois de uma edição livre
  // (manual_override) — nesses casos o acompanhamento palavra a palavra
  // durante a reprodução fica desativado.
  word_timings: WordTiming[];
  // Vazio se a diarização estiver desabilitada ou tiver falhado para este
  // projeto — nesse caso a tela simplesmente não mostra rótulos de falante.
  speaker_segments: SpeakerSegment[];
}

export interface AudioUrlResponse {
  url: string;
  expires_in: number;
}

export type ResolveSegmentPayload =
  | { action: "accept_alternative"; alternative_index: number }
  | { action: "custom_text"; text: string };

export type ExportFormat = "txt" | "srt" | "docx";

// Mantidos em sincronia com os defaults de app/core/config.py no backend.
// Ajuste aqui se MAX_UPLOAD_MB / ALLOWED_AUDIO_EXTENSIONS mudarem no servidor.
export const ALLOWED_AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "ogg", "opus"] as const;
export const MAX_UPLOAD_MB = 50;
