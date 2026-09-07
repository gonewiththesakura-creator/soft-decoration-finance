import { posix } from "node:path";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type EmbeddedWorkbookImage = {
  sheetIndex: number;
  sheetName: string;
  sourceRow: number;
  sourceColumn: number;
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
const decoder = new TextDecoder();

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function readXml(entries: Record<string, Uint8Array>, path: string) {
  const bytes = entries[path];
  return bytes ? xmlParser.parse(decoder.decode(bytes)) as Record<string, unknown> : null;
}

function relationshipMap(document: Record<string, unknown> | null) {
  const root = document?.Relationships as Record<string, unknown> | undefined;
  const relationships = asArray(root?.Relationship as Record<string, unknown> | Array<Record<string, unknown>> | undefined);
  return new Map(relationships.map((relationship) => [String(relationship.Id ?? ""), relationship]));
}

function relatedPath(sourcePath: string, target: unknown) {
  const resolved = posix.normalize(posix.join(posix.dirname(sourcePath), String(target ?? ""))).replace(/^\/+/, "");
  return resolved.startsWith("xl/") ? resolved : null;
}

function relationshipsPath(sourcePath: string) {
  return posix.join(posix.dirname(sourcePath), "_rels", `${posix.basename(sourcePath)}.rels`);
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function anchorImageRelationship(anchor: Record<string, unknown>) {
  const picture = nestedRecord(anchor["xdr:pic"]);
  const fill = nestedRecord(picture?.["xdr:blipFill"]);
  const blip = nestedRecord(fill?.["a:blip"]);
  return String(blip?.["r:embed"] ?? "");
}

function mimeTypeFor(path: string) {
  const extension = posix.extname(path).toLowerCase();
  const types: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff" };
  return types[extension] ?? "application/octet-stream";
}

export function extractWorkbookImages(bytes: Buffer, filename: string): EmbeddedWorkbookImage[] {
  if (!/\.xlsx$/i.test(filename)) return [];
  const entries = unzipSync(new Uint8Array(bytes));
  const workbook = readXml(entries, "xl/workbook.xml");
  const workbookRelationships = relationshipMap(readXml(entries, "xl/_rels/workbook.xml.rels"));
  const workbookRoot = nestedRecord(workbook?.workbook);
  const sheetsRoot = nestedRecord(workbookRoot?.sheets);
  const sheets = asArray(sheetsRoot?.sheet as Record<string, unknown> | Array<Record<string, unknown>> | undefined);
  const images: EmbeddedWorkbookImage[] = [];

  sheets.forEach((sheet, sheetIndex) => {
    const worksheetRelationship = workbookRelationships.get(String(sheet["r:id"] ?? ""));
    const worksheetPath = relatedPath("xl/workbook.xml", worksheetRelationship?.Target);
    if (!worksheetPath) return;
    const worksheetRelationships = relationshipMap(readXml(entries, relationshipsPath(worksheetPath)));
    const drawingRelationships = [...worksheetRelationships.values()].filter((relationship) => String(relationship.Type ?? "").endsWith("/drawing"));
    let sheetImageIndex = 0;

    for (const drawingRelationship of drawingRelationships) {
      const drawingPath = relatedPath(worksheetPath, drawingRelationship.Target);
      if (!drawingPath) continue;
      const drawing = readXml(entries, drawingPath);
      const drawingRoot = nestedRecord(drawing?.["xdr:wsDr"]);
      const mediaRelationships = relationshipMap(readXml(entries, relationshipsPath(drawingPath)));
      const anchors = [
        ...asArray(drawingRoot?.["xdr:twoCellAnchor"] as Record<string, unknown> | Array<Record<string, unknown>> | undefined),
        ...asArray(drawingRoot?.["xdr:oneCellAnchor"] as Record<string, unknown> | Array<Record<string, unknown>> | undefined),
      ];
      for (const anchor of anchors) {
        const from = nestedRecord(anchor["xdr:from"]);
        const imageRelationship = mediaRelationships.get(anchorImageRelationship(anchor));
        const mediaPath = relatedPath(drawingPath, imageRelationship?.Target);
        if (!from || !mediaPath || !mediaPath.startsWith("xl/media/") || !entries[mediaPath]) continue;
        const sourceRow = Number(from["xdr:row"] ?? -1) + 1;
        const sourceColumn = Number(from["xdr:col"] ?? -1) + 1;
        if (sourceRow < 1 || sourceColumn < 1) continue;
        sheetImageIndex += 1;
        const extension = posix.extname(mediaPath).toLowerCase() || ".bin";
        images.push({
          sheetIndex,
          sheetName: String(sheet.name ?? `Sheet${sheetIndex + 1}`),
          sourceRow,
          sourceColumn,
          filename: `s${sheetIndex + 1}-r${sourceRow}-c${sourceColumn}-${String(sheetImageIndex).padStart(3, "0")}${extension}`,
          mimeType: mimeTypeFor(mediaPath),
          bytes: Buffer.from(entries[mediaPath]),
        });
      }
    }
  });

  return images;
}
