require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MongoClient, ObjectId } = require("mongodb");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const writingTopics = {
  restaurant:
    "Write about a memorable meal you had — where, what you ate, and why it stood out.",
  travel:
    "Describe a trip you'd like to take, and explain why that destination interests you.",
  daily_routine:
    "Describe your typical daily routine, from morning to evening.",
  opinion:
    "Do you think social media does more good than harm? Explain your view with reasons.",
  hobby: "Write about a hobby or activity you enjoy, and how you got into it.",
  work_study:
    "Describe your job or studies, and what you find most challenging about it.",
};

function buildWritingReviewInstruction(languageKey, levelKey) {
  const language = languages[languageKey] || languages.german;
  const levelText = levelGuidance[levelKey] || levelGuidance.B1;

  return `You are an experienced, encouraging ${language.name} writing teacher reviewing a learner's written submission.

${levelText}

The learner has submitted a piece of writing in ${language.name}. Review it and respond with ONLY a JSON object, no other text, in this exact format:

{
  "correctedText": "the FULL text, lightly corrected — fix grammar/spelling errors but preserve the learner's own voice and structure as much as possible",
  "inlineNotes": [
    { "original": "the exact original phrase with the mistake", "corrected": "the corrected version", "explanation": "a short, plain-language explanation of the mistake" }
  ],
  "overallFeedback": {
    "structure": "1-2 sentences on how well-organized the writing is (intro/body/conclusion, paragraph flow, logical order)",
    "vocabulary": "1-2 sentences on vocabulary range and word choice — repetitive, appropriate, impressive word use, etc.",
    "register": "1-2 sentences on whether the tone/formality matches what the piece seems to be going for",
    "strengths": "1-2 sentences on what the learner did well — always find something genuine",
    "nextSteps": "1-2 concrete, specific things to focus on improving next time"
  },
  "wordCount": <integer, the word count of the original submission>
}

Only include entries in "inlineNotes" for genuine errors — do not invent corrections for stylistic preferences that aren't actually wrong. If the submission has no errors at all, "inlineNotes" can be an empty array, but still give full "overallFeedback".`;
}

function generateId() {
  return crypto.randomBytes(12).toString("hex");
}

const mongoClient = new MongoClient(process.env.MONGODB_URI);
let feedbackCollection;
let chatsCollection;
let usersCollection;
let progressCollection;
let dictionaryHistoryCollection;

async function connectDB() {
  try {
    await mongoClient.connect();
    feedbackCollection = mongoClient.db("stembridge").collection("feedback");
    chatsCollection = mongoClient.db("stembridge").collection("chats");
    usersCollection = mongoClient.db("stembridge").collection("users");
    progressCollection = mongoClient.db("stembridge").collection("progress");
    dictionaryHistoryCollection = mongoClient
      .db("stembridge")
      .collection("dictionaryHistory");
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
  hebrew: { name: "Hebrew", ttsLang: "he-IL" },
};

const levelGuidance = {
  A1: "The user is a complete beginner (CEFR A1). Use only the simplest, most common words and very short sentences (3-6 words). Avoid idioms entirely.",
  A2: "The user is an elementary learner (CEFR A2). Use simple, common vocabulary and short, clear sentences.",
  B1: "The user is an intermediate learner (CEFR B1). Use everyday vocabulary and natural sentence length. Simple idioms are fine if common.",
  B2: "The user is an upper-intermediate learner (CEFR B2). Use natural vocabulary and normal sentence complexity, including some idiomatic expressions.",
  C1: "The user is an advanced learner (CEFR C1), possibly preparing for an exam like IELTS or TOEFL. Use natural, sophisticated vocabulary and idiom. Corrections should focus on nuance, register, and natural phrasing, not just basic grammar.",
  C2: "The user is near-native (CEFR C2). Speak completely naturally, exactly as you would with a native speaker, full idiom and colloquialism included. Corrections should focus on subtle style and native-level fluency, not basic errors.",
};

function buildInterviewSystemInstruction(
  mode,
  languageKey,
  levelKey,
  jobField,
) {
  const field =
    jobField && jobField.trim() ? jobField.trim() : "a general professional";

  if (mode === "star") {
    return `You are an experienced, warm but professional hiring manager conducting a behavioral job interview in English for a "${field}" position.

Rules:
- Ask ONE interview question at a time, in natural professional English — the kind a real interviewer would ask (behavioral/situational questions especially: "Tell me about a time when...", "Describe a situation where...").
- Keep your question itself to 1-2 sentences.
- After the candidate answers, evaluate their response using the STAR method (Situation, Task, Action, Result). Under a line that says exactly "Feedback:", give 2-3 sentences noting what they covered well and what's missing (e.g. "You described the Situation and Action clearly, but didn't mention the Result — always close with the outcome.").
- After the feedback, naturally transition to your next question in the same reply.
- Stay encouraging and constructive, never harsh — this is practice, not a real rejection.
- Do not repeat a question you've already asked in this session.`;
  }

  const language = languages[languageKey] || languages.german;
  const levelText = levelGuidance[levelKey] || levelGuidance.B1;
  const translationRule =
    languageKey !== "english"
      ? `\n- Immediately after your interview question, on a new line, add "Translation:" followed by a natural English translation of your question. This always comes BEFORE any Correction line.`
      : "";

  return `You are a professional interviewer conducting a job interview in ${language.name} for a "${field}" position. The candidate is a ${language.name} learner practicing for a real interview conducted in this language.

${levelText}

Rules:
- Ask ONE interview question at a time, in natural professional ${language.name} — the kind a real interviewer would ask.
- Keep your question to 1-2 sentences.${translationRule}
- If the candidate made a grammar or vocabulary mistake in their answer, gently note it after your question (and after the translation, if present), under a line that says "Correction:". Keep this to 1-2 sentences. If there's no mistake, skip this line.
- Stay warm and professional, never harsh.
- Do not repeat a question you've already asked in this session.`;
}

const edgeVoices = {
  german: "de-DE-KatjaNeural",
  english: "en-US-AriaNeural",
  spanish: "es-ES-ElviraNeural",
  mandarin: "zh-CN-XiaoxiaoNeural",
  russian: "ru-RU-SvetlanaNeural",
  arabic: "ar-SA-ZariyahNeural",
  hebrew: "he-IL-HilaNeural",
};

// A second, contrasting voice per language — used so two-speaker dialogues
// (see /dialogues.html) actually sound like two different people instead
// of one narrator reading both parts.
const edgeVoicesSecondary = {
  german: "de-DE-ConradNeural",
  english: "en-US-GuyNeural",
  spanish: "es-ES-AlvaroNeural",
  mandarin: "zh-CN-YunxiNeural",
  russian: "ru-RU-DmitryNeural",
  arabic: "ar-SA-HamedNeural",
  hebrew: "he-IL-AvriNeural",
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
- Keep your in-character reply to ONE short sentence, maximum 15 words — like a real quick back-and-forth, not a monologue.${translationRule}
- If the user made a grammar or vocabulary mistake, gently note the correction AFTER your in-character reply (and after the translation, if present), under a line that says "Correction:". Keep this to 1-2 sentences max. If there's no mistake, skip this line entirely.
- Keep the tone warm and encouraging, never harsh.
- If the user goes off-topic, gently and naturally steer the conversation back to the scenario, still in character.
- Brevity is critical — the user is listening to this out loud and needs to process it quickly.
- If — and only if — this exchange brings the scenario to a natural, satisfying close (e.g. the meal is paid for and the customer is leaving, directions were given and confirmed, the item was purchased, check-in is complete), add one final line at the very end, after everything else: "ScenarioComplete: yes". If the scenario is still ongoing, do not add this line at all — omit it entirely rather than writing "no".`;

  if (mode === "audio") {
    return `${baseRules}

You will receive an audio clip of the user speaking.

CRITICAL RULES for audio mode — follow exactly:
1. "transcription" must be the EXACT words the user said, in the ORIGINAL language they spoke it in. Do NOT translate it.
2. "reply" must ALWAYS be written in ${language.name}, regardless of what language the user spoke.

Respond with a JSON object only, no other text, in this exact format:
{
  "transcription": "the exact words the user said, in their original language, not translated",
  "reply": "your ${language.name} in-character reply, plus optional Translation/Correction sections as instructed"
}`;
  }
  return baseRules;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MASCOT_NAME = "Bridgee";

function buildTutorSystemInstruction(languageKey, unitTitle, chunkContext) {
  const language = languages[languageKey] || languages.german;
  const supportedList = Object.entries(languages)
    .map(([key, l]) => `${key} (${l.name})`)
    .join(", ");

  const lessonContext = unitTitle
    ? `\n\nThe learner is currently on the lesson "${unitTitle}" in the ${language.name} grammar course.${
        chunkContext
          ? ` Here is the specific content they're looking at right now, which their question is likely about:\n"""\n${chunkContext}\n"""`
          : ""
      }`
    : "";

  return `You are ${MASCOT_NAME}, the friendly official mascot and AI tutor of STEMBridge Speaks, a free language-learning platform for students. You are a small cartoon chameleon character — warm, encouraging, a little playful, but always clear and genuinely helpful. You are talking to a student who is working through the Learn Grammar section.

You are equally knowledgeable across ALL languages STEMBridge Speaks teaches: ${supportedList}. You are NOT limited to whichever language the student happens to be studying right now — if they ask a question about a completely different language, answer it fully and directly, exactly as you would for the current one. The learner is currently studying ${language.name}, so use that as helpful context, and feel free to compare across languages when it aids understanding (e.g. "this works like German cases" or "unlike English, this verb...").${lessonContext}

Rules:
- Answer clearly and correctly. Being right matters more than being cute — get grammar facts correct.
- Keep responses SHORT: 2-4 sentences for a simple question, a short paragraph maximum for something that genuinely needs more explanation. This is a chat bubble, not an essay.
- Use at most one small, natural touch of personality or encouragement (e.g. a brief "Nice question!" or an emoji) — don't overdo it or pad the answer with fluff.
- Give a concrete example in the target language when it helps (with a quick English gloss).
- Treat every question about any of the 7 supported languages as fully in-scope, regardless of what lesson the student currently has open. Only redirect if the topic isn't language learning at all.
- If the question is completely unrelated to language learning (e.g. general trivia, coding help, personal advice), gently decline and redirect: explain in character that you're focused on helping with language learning, and ask if they have a language question instead. Don't answer the off-topic question.
- Never claim to be a human tutor or a real person — you're an AI mascot, and that's fine to acknowledge if asked directly.
- This is a student-facing educational product used by school-age learners. Always keep responses wholesome and classroom-appropriate — no profanity, violence, sexual content, or other material unsuitable for a school setting, regardless of how a question is phrased.

RESPONSE FORMAT — this matters, follow it exactly every single turn:
Respond with ONLY a JSON object, no other text, no markdown fences, in this exact shape:
{
  "reply": "your in-character answer, following all the rules above",
  "topicLanguage": "one of: ${Object.keys(languages).join(", ")}"
}
"topicLanguage" is whichever single language this specific answer is primarily ABOUT — the one the student is really asking about right now, not necessarily the lesson they happen to have open. If the question genuinely isn't about one specific language (e.g. general study-tips advice), use "${languageKey && languages[languageKey] ? languageKey : "german"}" as the default. This field is used to pick a voice accent for reading your reply aloud, so it must always be exactly one of the listed keys, lowercase, nothing else.`;
}

async function generateChatTitle(userMessage, replyText, attempt = 1) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    const result = await model.generateContent(
      `Summarize this exchange into a short 3-5 word conversation title. No punctuation, no quotes, just the title itself.\n\nUser: ${userMessage}\nReply: ${replyText}`,
    );
    const title = result.response.text().trim().replace(/["'.]/g, "");
    return title.slice(0, 50) || userMessage.slice(0, 40);
  } catch (err) {
    if (err.status === 503 && attempt < 2) {
      console.log("Title generation got a 503, retrying once...");
      await sleep(1500);
      return generateChatTitle(userMessage, replyText, attempt + 1);
    }
    console.error(
      "Title generation failed, using fallback title:",
      err.message,
    );
    return userMessage.slice(0, 40);
  }
}

async function lookupWord(word, languageKey) {
  const language = languages[languageKey] || languages.german;
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const prompt = `You are a comprehensive multilingual dictionary and thesaurus for ${language.name}. Look up "${word}" — this could be a single letter/alphabet character, a single word, a multi-word phrase, or an idiom. Handle ALL of these categories properly; do not reject something just because it isn't a single standalone word.

Respond with ONLY a JSON object, no other text, in this exact format:
{
  "entryType": "letter" | "word" | "phrase" | "idiom",
  "word": "the letter/word/phrase, corrected for spelling if needed",
  "partOfSpeech": "noun/verb/adjective/etc for a word; empty string for letter/phrase/idiom",
  "definition": "a clear English explanation — for a letter, describe its sound/pronunciation and common usage; for an idiom, explain the figurative meaning (and literal translation if that helps understanding); for a phrase, explain what it means and when it's used",
  "exampleSentence": "for word/phrase/idiom: one natural example sentence in ${language.name} using it. For a letter: one common ${language.name} word that starts with or prominently features that letter",
  "exampleTranslation": "English translation of the example",
  "notes": "any brief, genuinely useful note — gender/case for a word, formality level, common confusion, regional variation, etc. Empty string if nothing notable."
}

Only set "entryType" to "not_found" and explain in "definition" that no entry exists, if "${word}" is truly gibberish and not identifiable as a letter, word, phrase, or idiom in ${language.name} or any language.`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text();
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

app.get("/", (req, res) => {
  res.send("STEMBridge Speaks backend is running.");
});

app.get("/languages", (req, res) => {
  res.json(languages);
});

// ---------- CHAT MANAGEMENT ----------

app.post("/api/chats", requireAuth, async (req, res) => {
  try {
    const { language, scenario, level } = req.body;
    const chat = {
      userId: req.userId,
      title: "New chat",
      language: language || "german",
      scenario: scenario || "restaurant",
      level: level || "B1",
      messages: [],
      shareId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await chatsCollection.insertOne(chat);
    res.json({ chatId: result.insertedId, ...chat });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create chat." });
  }
});

app.get("/api/chats", requireAuth, async (req, res) => {
  try {
    const chats = await chatsCollection
      .find({ userId: req.userId })
      .project({ title: 1, language: 1, scenario: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json(chats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load chats." });
  }
});

app.get("/api/chats/:id", requireAuth, async (req, res) => {
  try {
    const chat = await chatsCollection.findOne({
      _id: new ObjectId(req.params.id),
      userId: req.userId,
    });
    if (!chat) return res.status(404).json({ error: "Chat not found." });
    res.json(chat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load chat." });
  }
});

app.delete("/api/chats/:id", requireAuth, async (req, res) => {
  try {
    await chatsCollection.deleteOne({
      _id: new ObjectId(req.params.id),
      userId: req.userId,
    });
    res.json({ status: "Chat deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete chat." });
  }
});

app.post("/api/chats/:id/share", requireAuth, async (req, res) => {
  try {
    const chat = await chatsCollection.findOne({
      _id: new ObjectId(req.params.id),
      userId: req.userId,
    });
    if (!chat) return res.status(404).json({ error: "Chat not found." });

    let shareId = chat.shareId;
    if (!shareId) {
      shareId = generateId();
      await chatsCollection.updateOne({ _id: chat._id }, { $set: { shareId } });
    }
    res.json({ shareId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create share link." });
  }
});

// Public read-only view — intentionally NOT behind requireAuth, anyone with the link can view
app.get("/api/shared/:shareId", async (req, res) => {
  try {
    const chat = await chatsCollection.findOne({ shareId: req.params.shareId });
    if (!chat) return res.status(404).json({ error: "Shared chat not found." });
    res.json(chat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load shared chat." });
  }
});

// ---------- CONVERSATION (now chat-scoped, not global) ----------

app.post("/chat", requireAuth, async (req, res) => {
  try {
    const { chatId, message, scenario, language, level } = req.body;

    const chat = await chatsCollection.findOne({
      _id: new ObjectId(chatId),
      userId: req.userId,
    });
    if (!chat) return res.status(404).json({ error: "Chat not found." });

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildSystemInstruction(
        scenario,
        language,
        "text",
        level,
      ),
    });

    const geminiHistory = chat.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));
    const chatSession = model.startChat({ history: geminiHistory });
    const result = await chatSession.sendMessage(message);
    const text = result.response.text();

    const newMessages = [
      ...chat.messages,
      { role: "user", text: message },
      { role: "model", text },
    ];

    const newTitle =
      chat.title === "New chat"
        ? await generateChatTitle(message, text)
        : chat.title;

    await chatsCollection.updateOne(
      { _id: chat._id },
      {
        $set: {
          messages: newMessages,
          title: newTitle,
          updatedAt: new Date(),
          language,
          scenario,
          level,
        },
      },
    );

    res.json({ reply: text, title: newTitle });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.post("/chat-audio", requireAuth, async (req, res) => {
  try {
    const { chatId, audio, scenario, language, level } = req.body;

    const chat = await chatsCollection.findOne({
      _id: new ObjectId(chatId),
      userId: req.userId,
    });
    if (!chat) return res.status(404).json({ error: "Chat not found." });

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
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const newMessages = [
      ...chat.messages,
      { role: "user", text: parsed.transcription },
      { role: "model", text: parsed.reply },
    ];

    const newTitle =
      chat.title === "New chat"
        ? await generateChatTitle(parsed.transcription, parsed.reply)
        : chat.title;
    await chatsCollection.updateOne(
      { _id: chat._id },
      {
        $set: {
          messages: newMessages,
          title: newTitle,
          updatedAt: new Date(),
          language,
          scenario,
          level,
        },
      },
    );

    res.json({ ...parsed, title: newTitle });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Something went wrong processing audio.",
      transcription: "(error)",
      reply: "Sorry, something went wrong.",
    });
  }
});

app.post("/chat/start", requireAuth, async (req, res) => {
  try {
    const { chatId, scenario, language, level } = req.body;
    const chat = await chatsCollection.findOne({
      _id: new ObjectId(chatId),
      userId: req.userId,
    });
    if (!chat) return res.status(404).json({ error: "Chat not found." });

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildSystemInstruction(
        scenario,
        language,
        "text",
        level,
      ),
    });

    const result = await model.generateContent(
      "Start the conversation naturally, in character, with a short opening line or question — as if the user just walked up to you. Do not wait for the user to speak first.",
    );
    const text = result.response.text();

    const newMessages = [...chat.messages, { role: "model", text }];
    await chatsCollection.updateOne(
      { _id: chat._id },
      {
        $set: {
          messages: newMessages,
          updatedAt: new Date(),
          language,
          scenario,
          level,
        },
      },
    );

    res.json({ reply: text });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Something went wrong starting the conversation." });
  }
});

app.post("/api/interview/start", requireAuth, async (req, res) => {
  try {
    const { mode, language, level, jobField } = req.body;
    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildInterviewSystemInstruction(
        mode,
        language,
        level,
        jobField,
      ),
    });
    const result = await model.generateContent(
      "Start the interview with a brief, warm greeting and your first question. Do not wait for the candidate to speak first.",
    );
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start the interview." });
  }
});

app.post("/api/interview/message", requireAuth, async (req, res) => {
  try {
    const { mode, language, level, jobField, message, history } = req.body;
    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildInterviewSystemInstruction(
        mode,
        language,
        level,
        jobField,
      ),
    });
    const geminiHistory = (history || []).map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));
    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.post("/api/interview/audio", requireAuth, async (req, res) => {
  try {
    const { mode, language, level, jobField, audio } = req.body;
    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction:
        buildInterviewSystemInstruction(mode, language, level, jobField) +
        `

You will receive an audio clip of the candidate's spoken answer. Respond with ONLY a JSON object, no other text, in this exact format:
{
  "transcription": "the exact words the candidate said, in their original language, not translated",
  "reply": "your response, following all the rules above"
}`,
    });
    const result = await model.generateContent([
      { inlineData: { mimeType: "audio/webm", data: audio } },
      {
        text: "Listen to this audio and respond according to your instructions.",
      },
    ]);
    const cleaned = result.response
      .text()
      .replace(/```json|```/g, "")
      .trim();
    res.json(JSON.parse(cleaned));
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Something went wrong processing audio.",
      transcription: "(error)",
      reply: "Sorry, something went wrong.",
    });
  }
});

app.post("/api/writing/review", requireAuth, async (req, res) => {
  try {
    const { text, language, level } = req.body;
    if (!text || !text.trim())
      return res.status(400).json({ error: "Please write something first." });

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildWritingReviewInstruction(language, level),
    });
    const result = await model.generateContent(text);
    const cleaned = result.response
      .text()
      .replace(/```json|```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({
        error: "Could not review your writing right now. Please try again.",
      });
  }
});

app.post("/tts", async (req, res) => {
  try {
    const { text, level, language, speaker } = req.body;
    const voiceMap = speaker === 2 ? edgeVoicesSecondary : edgeVoices;
    const voice = voiceMap[language] || voiceMap.german;
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

app.post("/api/tutor-help", async (req, res) => {
  try {
    const { message, language, unitTitle, chunkContext, history } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "No question provided." });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: buildTutorSystemInstruction(
        language,
        unitTitle,
        chunkContext,
      ),
    });

    // Client sends a short rolling window of prior turns for continuity;
    // no server-side persistence needed for this feature.
    const geminiHistory = Array.isArray(history)
      ? history.slice(-10).map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: String(m.text || "").slice(0, 2000) }],
        }))
      : [];

    const chatSession = model.startChat({ history: geminiHistory });
    const result = await chatSession.sendMessage(message.slice(0, 1000));
    const rawText = result.response.text();

    let reply = rawText.trim();
    let topicLanguage = languages[language] ? language : "german";
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.reply) reply = parsed.reply;
      if (parsed.topicLanguage && languages[parsed.topicLanguage]) {
        topicLanguage = parsed.topicLanguage;
      }
    } catch (parseErr) {
      // Model didn't return valid JSON this turn — fall back to the raw
      // text as the reply and the current lesson language as the accent,
      // rather than failing the whole request.
      console.error(
        "Tutor help: couldn't parse structured reply, using raw text:",
        parseErr.message,
      );
    }

    res.json({ reply, topicLanguage, mascot: MASCOT_NAME });
  } catch (err) {
    console.error("Tutor help failed:", err);
    res.status(500).json({
      error: `${MASCOT_NAME} couldn't answer that just now — please try again.`,
    });
  }
});

app.post("/api/dictionary", async (req, res) => {
  try {
    const { word, language } = req.body;
    if (!word || !word.trim()) {
      return res.status(400).json({ error: "No word provided." });
    }
    const entry = await lookupWord(word.trim(), language);
    res.json(entry);
  } catch (err) {
    console.error("Dictionary lookup failed:", err);
    res.status(500).json({ error: "Could not look up that word right now." });
  }
});

const PORT = process.env.PORT || 3000;

// ---------- AUTHENTICATION ----------

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not logged in." });
  }
  try {
    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: "Session expired. Please log in again." });
  }
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Name, email, and password are all required." });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters." });
    }

    const existing = await usersCollection.findOne({
      email: email.toLowerCase(),
    });
    if (existing) {
      return res
        .status(409)
        .json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      name,
      email: email.toLowerCase(),
      passwordHash,
      isPublic: false,
      createdAt: new Date(),
    };
    const result = await usersCollection.insertOne(user);
    const token = generateToken(result.insertedId);

    res.json({
      token,
      user: { id: result.insertedId, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    }

    const user = await usersCollection.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    const token = generateToken(user._id);
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not log in." });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await usersCollection.findOne({
      _id: new ObjectId(req.userId),
    });
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      isPublic: user.isPublic,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load account." });
  }
});

// ---------- LEARN PROGRESS ----------

app.get("/api/progress", requireAuth, async (req, res) => {
  try {
    const doc = await progressCollection.findOne({ userId: req.userId });
    res.json(doc ? doc.data : {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load progress." });
  }
});

app.post("/api/progress", requireAuth, async (req, res) => {
  try {
    const { language, unitId } = req.body;
    if (!language || !unitId)
      return res
        .status(400)
        .json({ error: "language and unitId are required." });

    await progressCollection.updateOne(
      { userId: req.userId },
      { $set: { [`data.${language}.${unitId}`]: true, updatedAt: new Date() } },
      { upsert: true },
    );
    res.json({ status: "Progress saved." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save progress." });
  }
});

// ---------- DICTIONARY HISTORY ----------

app.get("/api/dictionary-history", requireAuth, async (req, res) => {
  try {
    const doc = await dictionaryHistoryCollection.findOne({
      userId: req.userId,
    });
    res.json(doc ? doc.recent : []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load history." });
  }
});

app.post("/api/dictionary-history", requireAuth, async (req, res) => {
  try {
    const { word, lang } = req.body;
    if (!word || !lang)
      return res.status(400).json({ error: "word and lang are required." });

    const doc = await dictionaryHistoryCollection.findOne({
      userId: req.userId,
    });
    let recent = doc ? doc.recent : [];
    recent = recent.filter((r) => !(r.word === word && r.lang === lang));
    recent.unshift({ word, lang, timestamp: new Date() });
    recent = recent.slice(0, 15);

    await dictionaryHistoryCollection.updateOne(
      { userId: req.userId },
      { $set: { recent, updatedAt: new Date() } },
      { upsert: true },
    );
    res.json({ status: "Saved.", recent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save history." });
  }
});

app.delete("/api/dictionary-history", requireAuth, async (req, res) => {
  try {
    await dictionaryHistoryCollection.updateOne(
      { userId: req.userId },
      { $set: { recent: [], updatedAt: new Date() } },
      { upsert: true },
    );
    res.json({ status: "Cleared." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not clear history." });
  }
});

// ---------- ONE-TIME MIGRATION FROM LOCALSTORAGE-ERA DATA ----------

app.post("/api/migrate", requireAuth, async (req, res) => {
  try {
    const { clientId, learnProgress, recentWords } = req.body;
    let migratedChats = 0;

    if (clientId) {
      const result = await chatsCollection.updateMany(
        { clientId, userId: { $exists: false } },
        { $set: { userId: req.userId } },
      );
      migratedChats = result.modifiedCount;
    }

    if (learnProgress && typeof learnProgress === "object") {
      const existing = await progressCollection.findOne({ userId: req.userId });
      const merged = existing ? { ...existing.data } : {};
      for (const lang in learnProgress) {
        merged[lang] = { ...(merged[lang] || {}), ...learnProgress[lang] };
      }
      await progressCollection.updateOne(
        { userId: req.userId },
        { $set: { data: merged, updatedAt: new Date() } },
        { upsert: true },
      );
    }

    if (Array.isArray(recentWords) && recentWords.length > 0) {
      const existing = await dictionaryHistoryCollection.findOne({
        userId: req.userId,
      });
      let recent = existing ? existing.recent : [];
      recentWords.forEach((r) => {
        if (
          !recent.some(
            (existingR) =>
              existingR.word === r.word && existingR.lang === r.lang,
          )
        ) {
          recent.push({ word: r.word, lang: r.lang, timestamp: new Date() });
        }
      });
      recent = recent.slice(0, 15);
      await dictionaryHistoryCollection.updateOne(
        { userId: req.userId },
        { $set: { recent, updatedAt: new Date() } },
        { upsert: true },
      );
    }

    res.json({ status: "Migration complete.", migratedChats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Migration failed." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
