// ============================================================
//  Upload museum CSV → Firestore (one-time utility)
//
//  Reads the curatorial CSV, filters real exhibits, and
//  uploads each one to the "museumFacts" collection via
//  Firestore REST API using the Firebase CLI access token.
//
//  Usage (from functions/):
//    npm run build
//    node lib/uploadFacts.js
//
//  Re-running is safe — documents are upserted by ID.
// ============================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {parse} from "csv-parse/sync";

// ── Config ──────────────────────────────────────────────────
const PROJECT    = "museumai-2a2e6";
const COLLECTION = "museumFacts";
const MAX_DETAIL = 1500;          // truncate long descriptions

const CSV_PATH = path.resolve(
  process.cwd(),
  "../VR Museum Exhibit Information Database" +
    " - Curatorial Database.csv"
);

// Non-exhibit rows to skip.
const SKIP = new Set([
  "Welcome Message",
  "Gallery Credits",
  "VR Tips and Hints",
  "Terms of Use Legal Information",
  "Exhibition Information",
  "Coming Soon",
]);

// ── Types ───────────────────────────────────────────────────
interface CsvRow {
  Location_Reference: string;
  Object_Title:       string;
  Location:           string;
  Description:        string;
  Long_Description:   string;
  Creator:            string;
  Origin:             string;
  Media:              string;
  Meta_Tags:          string;
  Fun_Fact:           string;
  Curator:            string;
}

// ── Helpers ─────────────────────────────────────────────────

/** Read Firebase CLI access token from local config. */
function getAccessToken(): string {
  const p = path.join(
    os.homedir(), ".config", "configstore",
    "firebase-tools.json"
  );
  const cfg = JSON.parse(fs.readFileSync(p, "utf-8"));
  const token = cfg?.tokens?.access_token;
  if (!token) {
    throw new Error(
      "No access_token found. Run: firebase login --reauth"
    );
  }
  return token as string;
}

/** Trim a string field, return "" if missing. */
const t = (v: string | undefined): string =>
  (v ?? "").trim();

/** Convert a CSV row to Firestore REST field map. */
function rowToFields(row: CsvRow) {
  let details = t(row.Long_Description) || t(row.Description);
  if (details.length > MAX_DETAIL) {
    details = details.slice(0, MAX_DETAIL) + "…";
  }

  const sv = (v: string) => ({stringValue: v});
  return {
    title:       sv(t(row.Object_Title)),
    details:     sv(details),
    locationRef: sv(t(row.Location_Reference)),
    location:    sv(t(row.Location)),
    creator:     sv(t(row.Creator)),
    origin:      sv(t(row.Origin)),
    media:       sv(t(row.Media)),
    metaTags:    sv(t(row.Meta_Tags)),
    funFact:     sv(t(row.Fun_Fact)),
    curator:     sv(t(row.Curator)),
  };
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  // 1. Parse CSV.
  const raw  = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as CsvRow[];
  console.log(`Parsed ${rows.length} rows`);

  // 2. Filter to real exhibits.
  const exhibits = rows.filter((r) => {
    const title = t(r.Object_Title);
    if (!title || SKIP.has(title)) return false;
    return !!(t(r.Long_Description) || t(r.Description));
  });
  console.log(`${exhibits.length} exhibits after filtering`);

  // 3. Upload via REST.
  const token   = getAccessToken();
  const baseUrl =
    "https://firestore.googleapis.com/v1/projects/" +
    `${PROJECT}/databases/(default)/documents/${COLLECTION}`;

  let ok = 0;
  let fail = 0;

  for (const row of exhibits) {
    const docId = `${t(row.Location_Reference)}_${t(row.Object_Title)}`
      .replace(/[/\\]/g, "_")
      .slice(0, 120);

    const resp = await fetch(
      `${baseUrl}/${encodeURIComponent(docId)}`,
      {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({fields: rowToFields(row)}),
      }
    );

    if (resp.ok) {
      ok++;
    } else {
      fail++;
      console.error(`  FAIL [${docId}]: ${resp.status}`);
      if (resp.status === 401) {
        console.error("Token expired → firebase login --reauth");
        break;
      }
    }

    if ((ok + fail) % 25 === 0) {
      console.log(`  ${ok + fail} / ${exhibits.length}`);
    }
  }

  console.log(`\nDone: ${ok} uploaded, ${fail} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
