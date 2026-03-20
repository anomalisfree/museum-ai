// ============================================================
//  Museum of Science Fiction — Virtual Guide (Cloud Function)
//  Model: gpt-4o-mini  |  Region: us-central1
//  Secrets: MUSEUM_AI (OpenAI), ELEVENLABS_KEY (ElevenLabs)
//  TTS: ElevenLabs (eleven_multilingual_v2)
// ============================================================

import {defineSecret} from "firebase-functions/params";
import {setGlobalOptions} from "firebase-functions/v2/options";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import OpenAI from "openai";

// ── Global settings ─────────────────────────────────────────
setGlobalOptions({
  region: "us-central1",
  maxInstances: 5,
});

const OPENAI_API_KEY = defineSecret("MUSEUM_AI");
const ELEVENLABS_KEY = defineSecret("ELEVENLABS_KEY");

// ── ElevenLabs TTS settings ─────────────────────────────────
// Model: eleven_multilingual_v2 (29 languages)
const ELEVENLABS_VOICE_ID = "TfOkTMvLYzgpJ01mn1zA";
const ELEVENLABS_TTS_URL =
  `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

if (!getApps().length) initializeApp();
const db = getFirestore();

// ── System prompt ───────────────────────────────────────────
const SYSTEM_PROMPT = [
  "You are Maria, the iconic robot from the 1927 film Metropolis,",
  "now serving as the virtual guide at the Museum of Science Fiction.",
  "You speak with a calm, warm, and slightly poetic tone,",
  "inspired by 1920s art-deco elegance.",
  "Answer in the same language the visitor uses.",
  "Keep answers concise (2-5 sentences).",
  "IMPORTANT: Vary the way you begin each reply.",
  "Never start two responses the same way.",
  "Do not begin with 'Ah' or any fixed greeting.",
  "Jump straight into the answer naturally.",
  "Cite exhibit titles and creators when relevant.",
  "Stay within the provided exhibit data.",
  "You may occasionally hint at your origin as an automaton",
  "from Metropolis, but keep the focus on the exhibits.",
  "If you don't know something, say so gracefully",
  "and suggest the visitor ask a human staff member.",
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
const loadExhibitsFromDb = async (): Promise<Exhibit[]> => {
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

// ── In-memory cache (5 min TTL) ─────────────────────────────
let cachedExhibits: Exhibit[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Load exhibits with in-memory caching.
 * @return {Promise<Exhibit[]>} array of exhibits.
 */
const loadExhibits = async (): Promise<Exhibit[]> => {
  const now = Date.now();
  if (cachedExhibits && now - cacheTimestamp < CACHE_TTL_MS) {
    logger.info("Using cached exhibits", {
      count: cachedExhibits.length,
    });
    return cachedExhibits;
  }
  cachedExhibits = await loadExhibitsFromDb();
  cacheTimestamp = Date.now();
  logger.info("Exhibits cached", {
    count: cachedExhibits.length,
  });
  return cachedExhibits;
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
        max_output_tokens: 200,
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

// ── Voice Guide: STT → GPT → TTS ───────────────────────────

/**
 * Callable Cloud Function for voice interaction.
 * Accepts base64-encoded audio, returns text answer + TTS audio.
 * @param {object} request.data - { audioBase64: string, language?: string }
 * @return {{ question: string, answer: string, audioBase64: string }}
 */
export const museumVoiceGuide = onCall(
  {
    secrets: [OPENAI_API_KEY, ELEVENLABS_KEY],
    timeoutSeconds: 120,
  },
  async (request) => {
    const audioBase64 = (
      request.data?.audioBase64 as string | undefined
    )?.trim();
    const language = (
      request.data?.language as string | undefined
    )?.trim() || "en";

    if (!audioBase64) {
      throw new HttpsError(
        "invalid-argument",
        "'audioBase64' is required (base64-encoded WAV/OGG)."
      );
    }

    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY.value(),
    });

    // 1. STT + Firestore in parallel ─────────────────────────
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const audioFile = new File([audioBuffer], "audio.wav", {
      type: "audio/wav",
    });

    const [transcription, exhibits] = await Promise.all([
      openai.audio.transcriptions.create({
        model: "whisper-1",
        file: audioFile,
        language,
      }),
      loadExhibits(),
    ]);

    const question = transcription.text?.trim() ?? "";
    logger.info("STT result", {question});

    if (!question) {
      return {
        question: "",
        answer: "I didn't hear a question.",
        audioBase64: "",
      };
    }

    if (!exhibits.length) {
      return {
        question,
        answer:
          "Museum data is not loaded yet. " +
          "Please try again later.",
        audioBase64: "",
      };
    }

    // 3. GPT answer ──────────────────────────────────────────
    let answer: string;
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
        max_output_tokens: 200,
      });

      answer =
        completion.output_text ??
        "Sorry, I couldn't generate an answer.";
    } catch (err) {
      logger.error("voiceGuide GPT FAIL", err);
      throw new HttpsError(
        "internal",
        "Failed to generate answer."
      );
    }

    // 4. Text-to-Speech (ElevenLabs) ─────────────────────────
    let ttsBase64 = "";
    try {
      const ttsResponse = await fetch(ELEVENLABS_TTS_URL, {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_KEY.value(),
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text: answer,
          model_id: "eleven_multilingual_v2",
        }),
      });
      if (!ttsResponse.ok) {
        const errBody = await ttsResponse.text();
        throw new Error(
          `ElevenLabs ${ttsResponse.status}: ${errBody}`
        );
      }
      const ttsBuffer = Buffer.from(
        await ttsResponse.arrayBuffer()
      );
      ttsBase64 = ttsBuffer.toString("base64");
    } catch (err) {
      logger.error("voiceGuide TTS FAIL", err);
      // Return text answer even if TTS fails
    }

    // -- Old OpenAI TTS (kept for reference) ------------------
    // const ttsResponse = await openai.audio.speech.create({
    //   model: "tts-1",
    //   voice: "shimmer",
    //   input: answer,
    //   response_format: "mp3",
    // });
    // const ttsBuffer = Buffer.from(
    //   await ttsResponse.arrayBuffer()
    // );
    // ttsBase64 = ttsBuffer.toString("base64");
    // ---------------------------------------------------------

    logger.info("museumVoiceGuide OK", {
      question,
      answerLen: answer.length,
      hasAudio: ttsBase64.length > 0,
    });

    return {question, answer, audioBase64: ttsBase64};
  }
);

// ── Text Guide with TTS: text → text + audio ────────────────

/**
 * Callable Cloud Function for text question with voice answer.
 * Accepts text question, returns text answer + TTS audio (MP3).
 * @param {object} request.data - { question: string }
 * @return {{ answer: string, audioBase64: string }}
 */
export const museumGuideWithAudio = onCall(
  {
    secrets: [OPENAI_API_KEY, ELEVENLABS_KEY],
    timeoutSeconds: 120,
  },
  async (request) => {
    // 1. Validate input ──────────────────────────────────────
    const question = (
      request.data?.question as string | undefined
    )?.trim();
    if (!question) {
      throw new HttpsError(
        "invalid-argument",
        "'question' is required."
      );
    }

    // 2. Load exhibits ───────────────────────────────────────
    const exhibits = await loadExhibits();
    if (!exhibits.length) {
      return {
        answer:
          "Museum data is not loaded yet. " +
          "Please try again later.",
        audioBase64: "",
      };
    }

    // 3. GPT answer ──────────────────────────────────────────
    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY.value(),
    });

    let answer: string;
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
        max_output_tokens: 200,
      });

      answer =
        completion.output_text ??
        "Sorry, I couldn't generate an answer.";
    } catch (err) {
      logger.error("guideWithAudio GPT FAIL", err);
      throw new HttpsError(
        "internal",
        "Failed to generate answer."
      );
    }

    // 4. Text-to-Speech (ElevenLabs) ─────────────────────────
    let ttsBase64 = "";
    try {
      const ttsResponse = await fetch(ELEVENLABS_TTS_URL, {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_KEY.value(),
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text: answer,
          model_id: "eleven_multilingual_v2",
        }),
      });
      if (!ttsResponse.ok) {
        const errBody = await ttsResponse.text();
        throw new Error(
          `ElevenLabs ${ttsResponse.status}: ${errBody}`
        );
      }
      const ttsBuffer = Buffer.from(
        await ttsResponse.arrayBuffer()
      );
      ttsBase64 = ttsBuffer.toString("base64");
    } catch (err) {
      logger.error("guideWithAudio TTS FAIL", err);
      // Return text answer even if TTS fails
    }

    // -- Old OpenAI TTS (kept for reference) ------------------
    // const ttsResponse = await openai.audio.speech.create({
    //   model: "tts-1",
    //   voice: "shimmer",
    //   input: answer,
    //   response_format: "mp3",
    // });
    // const ttsBuffer = Buffer.from(
    //   await ttsResponse.arrayBuffer()
    // );
    // ttsBase64 = ttsBuffer.toString("base64");
    // ---------------------------------------------------------

    logger.info("museumGuideWithAudio OK", {
      question,
      answerLen: answer.length,
      hasAudio: ttsBase64.length > 0,
    });

    return {answer, audioBase64: ttsBase64};
  }
);
