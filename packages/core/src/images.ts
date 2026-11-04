/** Image formats both renderers embed without conversion. */
export type ImageFormat = "png" | "jpeg";

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
}

/**
 * Format and pixel size from the file header (PNG IHDR or JPEG SOFn).
 * Returns undefined for anything else or for a truncated file.
 */
export function probeImage(data: Uint8Array): ImageInfo | undefined {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // PNG: 8-byte signature, then the IHDR chunk with width/height.
  if (data.length >= 24 && dv.getUint32(0) === 0x89504e47 && dv.getUint32(4) === 0x0d0a1a0a) {
    return { format: "png", width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG: walk the markers to the first start-of-frame.
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return undefined;
      const marker = data[i + 1] as number;
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = dv.getUint16(i + 2);
      // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { format: "jpeg", height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
  }
  return undefined;
}
