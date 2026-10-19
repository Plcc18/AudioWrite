import { getSupabaseBrowserClient } from "./supabase";
import type {
  AudioUrlResponse,
  ExportFormat,
  DoubtfulSegment,
  Project,
  ProjectDetail,
  ResolveSegmentPayload,
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL não configurada. Veja .env.example.");
  }
  return url.replace(/\/$/, "");
}

async function getAuthToken(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ApiError(401, "Sessão expirada. Faça login novamente.");
  }
  return token;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
    return JSON.stringify(body?.detail ?? body);
  } catch {
    return response.statusText || `Erro ${response.status}`;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      // O backend não envia Cache-Control, e o navegador pode aplicar cache
      // heurístico a respostas GET sem validators — isso serviria dados
      // desatualizados (status/trechos pendentes) depois de uma ação do
      // usuário ou durante o polling. Estes dados são sempre dinâmicos.
      cache: "no-store",
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    throw new ApiError(0, "Não foi possível conectar à API. Verifique sua conexão.");
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function listProjects(): Promise<Project[]> {
  return apiFetch<Project[]>("/projects");
}

export function getProject(id: string): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/projects/${id}`);
}

export function getAudioUrl(id: string): Promise<AudioUrlResponse> {
  return apiFetch<AudioUrlResponse>(`/projects/${id}/audio-url`);
}

export function deleteProject(id: string): Promise<void> {
  return apiFetch<void>(`/projects/${id}`, { method: "DELETE" });
}

export function renameProject(id: string, filename: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
}

export function resolveSegment(
  projectId: string,
  segmentId: string,
  payload: ResolveSegmentPayload
): Promise<DoubtfulSegment> {
  return apiFetch<DoubtfulSegment>(`/projects/${projectId}/segments/${segmentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Disponível a partir de needs_review/done — ver backend. */
export function updateFinalText(projectId: string, text: string): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/projects/${projectId}/final-text`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

/** Desfaz todas as edições (trechos resolvidos + edição livre) e volta exatamente à transcrição original. */
export function resetProject(projectId: string): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/projects/${projectId}/reset`, { method: "POST" });
}

/**
 * Upload via XMLHttpRequest (não fetch) porque precisamos do evento de
 * progresso de upload, que a Fetch API não expõe.
 */
export function createProject(file: File, onProgress?: (pct: number) => void): Promise<Project> {
  return new Promise(async (resolve, reject) => {
    let token: string;
    try {
      token = await getAuthToken();
    } catch (err) {
      reject(err);
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${getApiBaseUrl()}/projects`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Project);
        } catch {
          reject(new ApiError(xhr.status, "Resposta inválida da API."));
        }
      } else {
        let message = xhr.statusText || `Erro ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (typeof body?.detail === "string") message = body.detail;
        } catch {
          // ignore parse failure, keep default message
        }
        reject(new ApiError(xhr.status, message));
      }
    };

    xhr.onerror = () => reject(new ApiError(0, "Não foi possível conectar à API."));

    xhr.send(formData);
  });
}

function parseFilenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = header.match(/filename="?([^"]+)"?/);
  return match ? match[1] : fallback;
}

/** Baixa o export e dispara o download no navegador (precisa de header Authorization, por isso via fetch + blob). */
export async function downloadExport(
  projectId: string,
  format: ExportFormat,
  fallbackFilename: string
): Promise<void> {
  const token = await getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}/export?format=${format}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  const blob = await response.blob();
  const filename = parseFilenameFromContentDisposition(
    response.headers.get("Content-Disposition"),
    `${fallbackFilename}.${format}`
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
