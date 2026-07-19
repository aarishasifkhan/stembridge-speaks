require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

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

function buildSystemInstruction(scenarioKey, languageKey, mode) {
  const scenarioDescription = scenarios[scenarioKey] || scenarios.restaurant;
  const language = languages[languageKey] || languages.german;

  const baseRules = `You are a friendly ${language.name} conversation tutor. You are roleplaying as ${scenarioDescription}. The user is a ${language.name} learner practicing this scenario.

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
    const { message, scenario, language } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildSystemInstruction(scenario, language, "text"),
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
    const { audio, scenario, language } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildSystemInstruction(scenario, language, "audio"),
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

app.post("/feedback", (req, res) => {
  try {
    const fs = require("fs");
    const { rating, comment, scenario, language, userMessage, tutorReply } =
      req.body;
    const entry = {
      timestamp: new Date().toISOString(),
      rating,
      comment: comment || "",
      scenario: scenario || "unknown",
      language: language || "unknown",
      userMessage: userMessage || "",
      tutorReply: tutorReply || "",
    };
    fs.appendFileSync("feedback.log", JSON.stringify(entry) + "\n");
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
