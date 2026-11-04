import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

function asBytes(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function saveOrShareFile(bytes: Uint8Array | ArrayBuffer, fileName: string, mimeType: string): Promise<void> {
  const data = asBytes(bytes);
  if (Capacitor.isNativePlatform()) {
    const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_");
    const saved = await Filesystem.writeFile({
      path: safeName,
      data: toBase64(data),
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({ title: fileName, dialogTitle: fileName, url: saved.uri });
    return;
  }

  const blob = new Blob([data as BlobPart], { type: mimeType });
  if (mimeType === "application/pdf") {
    const file = new File([blob], fileName, { type: mimeType });
    const nav = navigator as Navigator & { share?: (item: ShareData) => Promise<void>; canShare?: (item: ShareData) => boolean };
    if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      try {
        await nav.share({ files: [file], title: fileName });
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
