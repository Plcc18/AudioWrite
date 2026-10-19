import { ALLOWED_AUDIO_EXTENSIONS, MAX_UPLOAD_MB } from "./types";

function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/** Retorna uma mensagem de erro em português se o arquivo for inválido, ou null se estiver ok. */
export function validateAudioFile(file: File): string | null {
  const ext = getExtension(file.name);
  if (!ALLOWED_AUDIO_EXTENSIONS.includes(ext as (typeof ALLOWED_AUDIO_EXTENSIONS)[number])) {
    return `Tipo de arquivo não suportado (.${ext || "?"}). Use: ${ALLOWED_AUDIO_EXTENSIONS.join(", ")}.`;
  }
  const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return `Arquivo muito grande (${(file.size / (1024 * 1024)).toFixed(1)}MB). O limite é ${MAX_UPLOAD_MB}MB.`;
  }
  return null;
}
