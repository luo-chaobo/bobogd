"use strict";

function splitState(state) {
  if (!state || Array.isArray(state) || typeof state !== "object") {
    throw new TypeError("state must be an object");
  }
  return Object.entries(state).map(([name, value]) => {
    const kind = Array.isArray(value) ? "array" : value !== null && typeof value === "object" ? "object" : "value";
    const entries = kind === "array" ? value.map((item, position) => [String(position), item])
      : kind === "object" ? Object.entries(value) : [["", value]];
    const rows = entries.map(([key, item], position) => {
      const payload = JSON.stringify(item);
      if (payload === undefined) throw new TypeError(`section ${name} contains a non-JSON value`);
      return {
        position,
        key: kind === "array" ? null : key,
        recordId: kind === "array" && item && !Array.isArray(item) && typeof item.id === "string" ? item.id : null,
        payload
      };
    });
    return { name, kind, rows };
  });
}

function joinState(sections) {
  if (!Array.isArray(sections)) throw new TypeError("sections must be an array");
  const result = {};
  const seen = new Set();
  for (const section of sections) {
    if (seen.has(section.name)) throw new Error("duplicate section");
    seen.add(section.name);
    const rows = [...section.rows].sort((a, b) => a.position - b.position);
    if (rows.some((row, position) => row.position !== position)) throw new Error(`section ${section.name} has missing or duplicate position`);
    let value;
    if (section.kind === "array") value = rows.map(row => JSON.parse(row.payload));
    else if (section.kind === "object") {
      const keys = new Set();
      const entries = rows.map(row => {
        if (typeof row.key !== "string" || keys.has(row.key)) throw new Error(`section ${section.name} has duplicate or invalid key`);
        keys.add(row.key);
        return [row.key, JSON.parse(row.payload)];
      });
      value = Object.fromEntries(entries);
    } else if (section.kind === "value" && rows.length === 1) value = JSON.parse(rows[0].payload);
    else throw new Error(`section ${section.name} has invalid kind or row count`);
    Object.defineProperty(result, section.name, { value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

module.exports = { splitState, joinState };
