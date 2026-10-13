// Reference images are downscaled in the browser before upload.
// The models cap input resolution anyway, and a smaller body uploads faster
// and renders faster. Non-image files and failures fall through untouched.

export const REFERENCE_MAX_EDGE = 1024;

export async function shrinkImage(file: File, max = REFERENCE_MAX_EDGE): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= max) {
      if (typeof bitmap.close === "function") bitmap.close();
      return file;
    }
    const k = max / longest;
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (typeof bitmap.close === "function") bitmap.close();
      return file;
    }
    // Flatten transparency to white: the output is JPEG, which has no alpha.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (typeof bitmap.close === "function") bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
