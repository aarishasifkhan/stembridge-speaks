require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get("/", (req, res) => {
  res.send("STEMBridge Speak backend is running.");
});

app.post("/test-gemini", async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    const result = await model.generateContent(
      'Say hello in German and correct this sentence: "Ich habe hunger und ich gehen zu Restaurant."',
    );
    const text = result.response.text();
    res.json({ reply: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong calling Gemini." });
  }
});

// Text-based chat route (typed input)
let conversationHistory = [];

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: `You are a friendly German conversation tutor. You are roleplaying a waiter in a restaurant in Germany. The user is a German learner practicing ordering food.

Rules:
- Stay in character as the waiter, respond naturally in German to whatever they say.
- Keep your in-character reply to ONE short sentence, maximum 15 words — like a real quick back-and-forth in a busy restaurant, not a monologue. If there's a Correction section, keep that to 1-2 sentences maximum as well. Brevity is critical — the user is listening to this out loud and needs to process it quickly.
- If the user made a grammar or vocabulary mistake, gently note the correction AFTER your in-character reply, under a line that says "Correction:". If there's no mistake, skip this line entirely.
- Keep the tone warm and encouraging, never harsh.
- If the user goes off-topic, gently and naturally steer the conversation back to the restaurant scenario, still in character.
- Remember what's already been said earlier in this conversation, and don't repeat yourself.`,
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

// Audio-based chat route (voice input)
app.post("/chat-audio", async (req, res) => {
  try {
    const { audio } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: `You are a friendly German conversation tutor roleplaying a waiter in a restaurant in Germany. The user is a German learner practicing ordering food.

You will receive an audio clip of the user speaking.

CRITICAL RULES — follow exactly:
1. "transcription" must be the EXACT words the user said, in the ORIGINAL language they spoke it in. Do NOT translate it.
2. "reply" must ALWAYS be written in German, regardless of what language the user spoke.
3. Stay in character as the waiter throughout the "reply" field.
4. After the in-character German reply, if the user made a German grammar/vocabulary mistake, add a line "Correction:" followed by an explanation (this explanation can be in English for clarity). If there's no mistake, omit this section.
5. Keep your in-character reply to ONE short sentence, maximum 15 words — like a real quick back-and-forth in a busy restaurant, not a monologue. If there's a Correction section, keep that to 1-2 sentences maximum as well. Brevity is critical — the user is listening to this out loud and needs to process it quickly.

Respond with a JSON object only, no other text, in this exact format:
{
  "transcription": "the exact words the user said, in their original language, not translated",
  "reply": "your German in-character waiter reply, plus optional Correction: section"
}`,
    });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "audio/webm",
          data: audio,
        },
      },
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

// Reset conversation history (used by both routes' Reset button)
app.post("/reset", (req, res) => {
  conversationHistory = [];
  res.json({ status: "Conversation reset." });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
