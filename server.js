require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MongoClient } = require("mongodb");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

const mongoClient = new MongoClient(process.env.MONGODB_URI);
let feedbackCollection;

async function connectDB() {
  try {
    await mongoClient.connect();
    feedbackCollection = mongoClient.db("stembridge").collection("feedback");
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection failed:", err);
  }
}
connectDB();

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const scenarios = {
  restaurant: "a waiter in a restaurant, helping the user order food",
  directions:
    "a friendly local in a city, helping the user who is lost find their way somewhere",
  shopping:
    "a shop assistant in a clothing store, helping the user find and buy an item",
  hotel:
    "a hotel receptionist, helping the user check in and ask about their room",
};

const languages = {
  german: { name: "German", ttsLang: "de-DE" },
  english: { name: "English", ttsLang: "en-US" },
  spanish: { name: "Spanish", ttsLang: "es-ES" },
  mandarin: { name: "Mandarin Chinese", ttsLang: "zh-CN" },
  russian: { name: "Russian", ttsLang: "ru-RU" },
  arabic: { name: "Arabic", ttsLang: "ar-SA" },
};

const levelGuidance = {
  A1: "The user is a complete beginner (CEFR A1). Use only the simplest, most common words and very short sentences (3-6 words). Avoid idioms entirely.",
  A2: "The user is an elementary learner (CEFR A2). Use simple, common vocabulary and short, clear sentences.",
  B1: "The user is an intermediate learner (CEFR B1). Use everyday vocabulary and natural sentence length. Simple idioms are fine if common.",
  B2: "The user is an upper-intermediate learner (CEFR B2). Use natural vocabulary and normal sentence complexity, including some idiomatic expressions.",
  C1: "The user is an advanced learner (CEFR C1), possibly preparing for an exam like IELTS or TOEFL. Use natural, sophisticated vocabulary and idiom. Corrections should focus on nuance, register, and natural phrasing, not just basic grammar.",
  C2: "The user is near-native (CEFR C2). Speak completely naturally, exactly as you would with a native speaker, full idiom and colloquialism included. Corrections should focus on subtle style and native-level fluency, not basic errors.",
};

const edgeVoices = {
  german: "de-DE-KatjaNeural",
  english: "en-US-AriaNeural",
  spanish: "es-ES-ElviraNeural",
  mandarin: "zh-CN-XiaoxiaoNeural",
  russian: "ru-RU-SvetlanaNeural",
  arabic: "ar-SA-ZariyahNeural",
};

const rateByLevel = {
  A1: "-40%",
  A2: "-25%",
  B1: "-10%",
  B2: "+0%",
  C1: "+15%",
  C2: "+30%",
};

function buildSystemInstruction(scenarioKey, languageKey, mode, levelKey) {
  const scenarioDescription = scenarios[scenarioKey] || scenarios.restaurant;
  const language = languages[languageKey] || languages.german;
  const levelText = levelGuidance[levelKey] || levelGuidance.B1;

  const translationRule =
    languageKey !== "english"
      ? `\n- Immediately after your in-character reply, on a new line, add "Translation:" followed by a natural English translation of ONLY your in-character reply (not the correction). This always comes BEFORE any Correction line.`
      : "";

  const baseRules = `You are a friendly ${language.name} conversation tutor. You are roleplaying as ${scenarioDescription}. The user is a ${language.name} learner practicing this scenario.

${levelText}

Rules:
- Stay in character throughout, respond naturally in ${language.name} to whatever they say.
- Keep your in-character reply to ONE short sentence, maximum 15 words — like a real quick back-and-forth, not a monologue.
- If the user made a grammar or vocabulary mistake, gently note the correction AFTER your in-character reply, under a line that says "Correction:". Keep this to 1-2 sentences max. If there's no mistake, skip this line entirely.
- Keep the tone warm and encouraging, never harsh.
- If the user goes off-topic, gently and naturally steer the conversation back to the scenario, still in character.
- Brevity is critical — the user is listening to this out loud and needs to process it quickly.`;

  if (mode === "audio") {
    return `${baseRules}

You will receive an audio clip of the user speaking.

CRITICAL RULES for audio mode — follow exactly:
1. "transcription" must be the EXACT words the user said, in the ORIGINAL language they spoke it in. Do NOT translate it.
2. "reply" must ALWAYS be written in ${language.name}, regardless of what language the user spoke.

Respond with a JSON object only, no other text, in this exact format:
{
  "transcription": "the exact words the user said, in their original language, not translated",
  "reply": "your ${language.name} in-character reply, plus optional Correction: section"
}`;
  }

  return baseRules;
}

app.get("/", (req, res) => {
  res.send("STEMBridge Speaks backend is running.");
});

app.get("/languages", (req, res) => {
  res.json(languages);
});

let conversationHistory = [];

app.post("/chat", async (req, res) => {
  try {
    const { message, scenario, language, level } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildSystemInstruction(
        scenario,
        language,
        "text",
        level,
      ),
    });

    conversationHistory.push({ role: "user", parts: [{ text: message }] });

    const chat = model.startChat({ history: conversationHistory.slice(0, -1) });
    const result = await chat.sendMessage(message);
    const text = result.response.text();

    conversationHistory.push({ role: "model", parts: [{ text }] });

    res.json({ reply: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.post("/chat-audio", async (req, res) => {
  try {
    const { audio, scenario, language, level } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildSystemInstruction(
        scenario,
        language,
        "audio",
        level,
      ),
    });

    const result = await model.generateContent([
      { inlineData: { mimeType: "audio/webm", data: audio } },
      {
        text: "Listen to this audio and respond according to your instructions.",
      },
    ]);

    const rawText = result.response.text();
    console.log("RAW GEMINI RESPONSE:", rawText);
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Something went wrong processing audio.",
      transcription: "(error)",
      reply: "Sorry, something went wrong.",
    });
  }
});

app.post("/tts", async (req, res) => {
  try {
    const { text, level, language } = req.body;
    const voice = edgeVoices[language] || edgeVoices.german;
    const rate = rateByLevel[level] || rateByLevel.B1;

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const tempDir = path.join(
      os.tmpdir(),
      "stembridge-live-tts-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2),
    );
    fs.mkdirSync(tempDir, { recursive: true });

    const { audioFilePath } = await tts.toFile(tempDir, text, { rate });
    const audioBuffer = fs.readFileSync(audioFilePath);
    fs.rmSync(tempDir, { recursive: true, force: true });

    res.json({ audio: audioBuffer.toString("base64") });
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: "Speech generation failed." });
  }
});

app.post("/feedback", async (req, res) => {
  try {
    const { rating, comment, scenario, language, userMessage, tutorReply } =
      req.body;
    const entry = {
      timestamp: new Date(),
      rating,
      comment: comment || "",
      scenario: scenario || "unknown",
      language: language || "unknown",
      userMessage: userMessage || "",
      tutorReply: tutorReply || "",
    };
    await feedbackCollection.insertOne(entry);
    res.json({ status: "Feedback recorded. Thank you!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save feedback." });
  }
});

app.post("/reset", (req, res) => {
  conversationHistory = [];
  res.json({ status: "Conversation reset." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
