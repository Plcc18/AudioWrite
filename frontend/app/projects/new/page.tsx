"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ApiError, createProject } from "@/lib/api";
import { ALLOWED_AUDIO_EXTENSIONS, MAX_UPLOAD_MB } from "@/lib/types";
import { validateAudioFile } from "@/lib/validateAudioFile";
import TopBar from "@/components/TopBar";

export default function NewProjectPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setUploadError(null);
    setFile(null);

    if (!selected) return;

    const error = validateAudioFile(selected);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    setFile(selected);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    setSubmitting(true);
    setUploadError(null);
    setProgress(0);

    try {
      const project = await createProject(file, setProgress);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setSubmitting(false);
      setProgress(null);
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setUploadError(err instanceof Error ? err.message : "Falha ao enviar o áudio.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar />
      <main className="mx-auto max-w-lg px-4 py-8 sm:px-6">
        <Link
          href="/projects"
          className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={16} /> Voltar aos projetos
        </Link>

        <h1 className="text-lg font-semibold text-slate-900">Novo projeto</h1>
        <p className="mt-1 text-sm text-slate-500">
          Formatos aceitos: {ALLOWED_AUDIO_EXTENSIONS.join(", ")}. Tamanho máximo: {MAX_UPLOAD_MB}MB.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="audio-file" className="block text-sm font-medium text-slate-700">
              Arquivo de áudio
            </label>
            <input
              id="audio-file"
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
              onChange={handleFileChange}
              disabled={submitting}
              className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          {validationError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {validationError}
            </p>
          )}

          {file && !validationError && (
            <p className="text-sm text-slate-600">
              Selecionado: <span className="font-medium">{file.name}</span> ({(file.size / (1024 * 1024)).toFixed(1)}MB)
            </p>
          )}

          {progress !== null && (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${progress}%` }}
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">Enviando... {progress}%</p>
            </div>
          )}

          {uploadError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {uploadError}
            </p>
          )}

          <button
            type="submit"
            disabled={!file || submitting}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "Enviando..." : "Enviar áudio"}
          </button>
        </form>
      </main>
    </div>
  );
}
