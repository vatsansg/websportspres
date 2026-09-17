// Minimal ISO/IEC 14496-12 (MP4) box parser - reads only what Step 3 needs (the video
// track's width/height from its "tkhd" box, and overall duration from "mvhd") without an
// ffmpeg/ffprobe binary. Deliberately narrow: this is not a general MP4 library, just
// enough box-walking to answer "what is this file's resolution and duration".

function readBoxes(buffer, start, end) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit size extension - rare, but must be handled to avoid mis-walking the file.
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      // Box extends to end of buffer (only valid for the last box).
      size = end - offset;
    }
    boxes.push({ type, start: offset, headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function findBox(boxes, type) {
  return boxes.find((b) => b.type === type);
}

/**
 * @param {Buffer} buffer - the full MP4 file contents.
 * @returns {{ width: number, height: number, durationSeconds: number } | null}
 */
export function parseMp4Metadata(buffer) {
  const topBoxes = readBoxes(buffer, 0, buffer.length);
  const moov = findBox(topBoxes, "moov");
  if (!moov) return null;
  const moovChildren = readBoxes(buffer, moov.start + moov.headerSize, moov.end);

  const mvhd = findBox(moovChildren, "mvhd");
  let durationSeconds = null;
  if (mvhd) {
    const version = buffer.readUInt8(mvhd.start + mvhd.headerSize);
    const isV1 = version === 1;
    const timescaleOffset = mvhd.start + mvhd.headerSize + (isV1 ? 20 : 12);
    const durationOffset = mvhd.start + mvhd.headerSize + (isV1 ? 28 : 16);
    const timescale = buffer.readUInt32BE(timescaleOffset);
    const duration = isV1
      ? Number(buffer.readBigUInt64BE(durationOffset))
      : buffer.readUInt32BE(durationOffset);
    durationSeconds = timescale > 0 ? duration / timescale : null;
  }

  let width = null;
  let height = null;
  for (const trak of moovChildren.filter((b) => b.type === "trak")) {
    const trakChildren = readBoxes(buffer, trak.start + trak.headerSize, trak.end);
    const mdia = findBox(trakChildren, "mdia");
    if (!mdia) continue;
    const mdiaChildren = readBoxes(buffer, mdia.start + mdia.headerSize, mdia.end);
    const hdlr = findBox(mdiaChildren, "hdlr");
    if (!hdlr) continue;
    // Handler type is a 4-char code at a fixed offset within hdlr (after version/flags +
    // a reserved 4 bytes) - "vide" identifies the video track among trak boxes.
    const handlerType = buffer.toString("ascii", hdlr.start + hdlr.headerSize + 8, hdlr.start + hdlr.headerSize + 12);
    if (handlerType !== "vide") continue;

    const tkhd = findBox(trakChildren, "tkhd");
    if (!tkhd) continue;
    const tkhdVersion = buffer.readUInt8(tkhd.start + tkhd.headerSize);
    // Width/height are the last two fields in tkhd, stored as 16.16 fixed-point, after
    // version/flags(4) + creation/modification/trackID/reserved/duration (20 for v0, 32 for
    // v1) + reserved(8) + layer/altgroup/volume/reserved(8) + matrix(36).
    const dimsOffset = tkhd.start + tkhd.headerSize + (tkhdVersion === 1 ? 88 : 76);
    width = buffer.readUInt32BE(dimsOffset) / 65536;
    height = buffer.readUInt32BE(dimsOffset + 4) / 65536;
    break;
  }

  if (width === null || height === null || durationSeconds === null) return null;
  return { width: Math.round(width), height: Math.round(height), durationSeconds };
}
