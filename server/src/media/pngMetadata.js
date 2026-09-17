// Minimal PNG header parser - reads only the mandatory IHDR chunk, which the PNG spec
// guarantees is the very first chunk immediately after the 8-byte signature, at a fixed
// byte layout. No dependency needed for this; avoids pulling in an image library (and its
// native-binary risk on the Linux App Service) just to read four integers.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, bitDepth: number } | null} null if not a valid PNG
 */
export function parsePngHeader(buffer) {
  if (buffer.length < 33) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  // Bytes 8-11: IHDR chunk length (always 13); bytes 12-15: "IHDR" ASCII.
  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType !== "IHDR") return null;

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  // "32-bit PNG" (the media spec's terminology) means 8 bits/channel x 4 channels
  // (RGBA, colorType 6) - not the raw IHDR bitDepth field, which is bits-per-channel.
  const bitsPerPixel = colorType === 6 ? bitDepth * 4 : colorType === 4 ? bitDepth * 2 : bitDepth;
  return { width, height, bitDepth, colorType, bitsPerPixel };
}
