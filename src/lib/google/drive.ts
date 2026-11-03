const APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const TOKEN_STORAGE_KEY = "egc-google-token";

interface TokenState {
  accessToken: string;
  expiresAt: number;
  email?: string;
}

export function getGoogleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
}

export function loadToken(): TokenState | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TokenState;
    if (parsed.expiresAt <= Date.now() + 15_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToken(token: TokenState): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
}

export function clearGoogleToken(): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

function loadGis(): Promise<typeof google> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Google Identity غير متاح خارج المتصفح."));
      return;
    }
    if (window.google?.accounts?.oauth2) {
      resolve(window.google);
      return;
    }
    const existing = document.querySelector("script[data-egc-gis]");
    const onLoad = () => {
      if (window.google) resolve(window.google);
      else reject(new Error("تعذر تحميل Google Identity Services."));
    };
    if (existing) {
      existing.addEventListener("load", onLoad);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.egcGis = "true";
    script.onload = onLoad;
    script.onerror = () => reject(new Error("فشل تحميل مكتبة Google. يلزم اتصال إنترنت لربط Drive."));
    document.head.appendChild(script);
  });
}

export async function connectGoogle(): Promise<TokenState> {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error("لم يتم ضبط NEXT_PUBLIC_GOOGLE_CLIENT_ID.");
  }
  const gis = await loadGis();
  return new Promise((resolve, reject) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: APPDATA_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        const token: TokenState = {
          accessToken: response.access_token,
          expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000,
        };
        saveToken(token);
        resolve(token);
      },
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}

export async function getAccessToken(): Promise<string> {
  const existing = loadToken();
  if (existing) return existing.accessToken;
  const connected = await connectGoogle();
  return connected.accessToken;
}

export interface DriveBackupFile {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
}

export async function uploadAppData(fileName: string, bytes: Uint8Array): Promise<DriveBackupFile> {
  const token = await getAccessToken();
  const metadata = { name: fileName, parents: ["appDataFolder"] };
  const body = new FormData();
  body.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  body.append("file", new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) throw new Error(`فشل رفع النسخة إلى Google Drive (${res.status}).`);
  return (await res.json()) as DriveBackupFile;
}

export async function listAppDataBackups(): Promise<DriveBackupFile[]> {
  const token = await getAccessToken();
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("spaces", "appDataFolder");
  url.searchParams.set("fields", "files(id,name,createdTime,modifiedTime,size)");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("pageSize", "50");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("تعذر قراءة النسخ من Google Drive.");
  const json = (await res.json()) as { files?: DriveBackupFile[] };
  return json.files ?? [];
}

export async function downloadAppData(fileId: string): Promise<Uint8Array> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("تعذر تنزيل النسخة من Google Drive.");
  return new Uint8Array(await res.arrayBuffer());
}

export async function deleteAppData(fileId: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error("تعذر حذف نسخة قديمة.");
}

export async function pruneOldBackups(keep: number): Promise<void> {
  const files = (await listAppDataBackups()).filter((f) => f.name.startsWith("evergreen-cash-"));
  const extra = files.slice(keep);
  for (const file of extra) {
    await deleteAppData(file.id);
  }
}

declare global {
  interface Window {
    google?: typeof google;
  }
}
