"use strict";

const crypto = require("node:crypto");

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function addCount(counts, key) {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function sortedCounts(counts) {
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function inventoryState(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("snapshot must be a Buffer");
  const state = JSON.parse(bytes.toString("utf8"));
  if (!state || Array.isArray(state) || typeof state !== "object") throw new Error("snapshot root must be an object");
  const sections = [];
  for (const [name, value] of Object.entries(state).sort(([a], [b]) => a.localeCompare(b))) {
    const item = { name, type: valueType(value) };
    if (Array.isArray(value)) {
      const itemTypes = new Map();
      const fields = new Map();
      const ids = new Set();
      let missingId = 0;
      let duplicateId = 0;
      for (const record of value) {
        addCount(itemTypes, valueType(record));
        if (!record || Array.isArray(record) || typeof record !== "object") continue;
        for (const [key, fieldValue] of Object.entries(record)) {
          if (!fields.has(key)) fields.set(key, new Map());
          addCount(fields.get(key), valueType(fieldValue));
        }
        if (typeof record.id !== "string" || record.id.length === 0) missingId++;
        else if (ids.has(record.id)) duplicateId++;
        else ids.add(record.id);
      }
      item.count = value.length;
      item.itemTypes = sortedCounts(itemTypes);
      item.objectRecordsWithoutStringId = missingId;
      item.duplicateStringIds = duplicateId;
      item.fields = Object.fromEntries([...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, types]) => [key, sortedCounts(types)]));
    }
    sections.push(item);
  }
  return { sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, sections };
}

module.exports = { inventoryState };
