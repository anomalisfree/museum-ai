// ============================================================
//  Museum of Science Fiction — Virtual Guide (Cloud Function)
//  Model: gpt-4o-mini  |  Region: us-central1
//  Secret: MUSEUM_AI (OpenAI API key)
// ============================================================

import {defineSecret} from "firebase-functions/params";
import {setGlobalOptions} from "firebase-functions/v2/options";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import OpenAI from "openai";

// ── Global settings ─────────────────────────────────────────
setGlobalOptions({region: "us-central1", maxInstances: 5});

const OPENAI_API_KEY = defineSecret("MUSEUM_AI");

if (!getApps().length) initializeApp();
const db = getFirestore();

// ── System prompt ───────────────────────────────────────────
const SYSTEM_PROMPT = [
  "You are a friendly virtual guide at the",
  "Museum of Science Fiction.",
  "Answer in the same language the visitor uses.",
  "Keep answers concise (2-5 sentences).",
  "Cite exhibit titles and creators when relevant.",
  "Stay within the provided exhibit data.",
  "If you don't know, say so and suggest asking",
  "a staff member.",
].join(" ");

// ── Types ───────────────────────────────────────────────────
interface Exhibit {
  title: string;
  details: string;
  location?: string;
  creator?: string;
  origin?: string;
  media?: string;
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Build a text context block from exhibit list.
 * @param {Exhibit[]} exhibits - array of exhibits.
 * @return {string} formatted context string.
 */
const buildContext = (exhibits: Exhibit[]): string =>
  exhibits
    .map((e) => {
      const p = [`Title: ${e.title}`];
      if (e.location) p.push(`Location: ${e.location}`);
      if (e.creator) p.push(`Creator: ${e.creator}`);
      if (e.origin) p.push(`Origin: ${e.origin}`);
      if (e.media) p.push(`Media: ${e.media}`);
      p.push(`Info: ${e.details}`);
      return p.join(" | ");
    })
    .join("\n\n");

/**
 * Load exhibits from Firestore collection.
 * @return {Promise<Exhibit[]>} array of exhibits.
 */
const loadExhibits = async (): Promise<Exhibit[]> => {
  const snap = await db
    .collection("museumFacts")
    .limit(200)
    .get();

  const exhibits: Exhibit[] = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const title = String(d.title ?? "").trim();
    const details = String(d.details ?? "").trim();
    if (!title || !details) return;
    exhibits.push({
      title,
      details,
      location: String(d.location ?? "").trim() || undefined,
      creator: String(d.creator ?? "").trim() || undefined,
      origin: String(d.origin ?? "").trim() || undefined,
      media: String(d.media ?? "").trim() || undefined,
    });
  });
  return exhibits;
};

// ── Callable Cloud Function ─────────────────────────────────

export const museumGuide = onCall(
  {secrets: [OPENAI_API_KEY]},
  async (request) => {
    // 1. Validate input.
    const question = (
      request.data?.question as string | undefined
    )?.trim();
    if (!question) {
      throw new HttpsError(
        "invalid-argument",
        "'question' is required."
      );
    }

    // 2. Load exhibit data.
    const exhibits = await loadExhibits();
    if (!exhibits.length) {
      return {
        answer:
          "Museum data is not loaded yet. " +
          "Please try again later.",
      };
    }

    // 3. Call OpenAI.
    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY.value(),
    });

    try {
      const completion = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          {role: "system", content: SYSTEM_PROMPT},
          {
            role: "system",
            content:
              "Exhibit data:\n" + buildContext(exhibits),
          },
          {role: "user", content: question},
        ],
        max_output_tokens: 350,
      });

      const answer =
        completion.output_text ??
        "Sorry, I couldn't generate an answer.";

      logger.info("museumGuide OK", {
        question,
        exhibitCount: exhibits.length,
      });
      return {answer};
    } catch (err) {
      logger.error("museumGuide FAIL", err);
      throw new HttpsError(
        "internal",
        "Failed to generate answer."
      );
    }
  }
);
