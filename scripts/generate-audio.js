const fs = require("fs");
const os = require("os");
const path = require("path");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

const langCode = process.argv[2]; // e.g. "en"
const voice = process.argv[3]; // e.g. "en-US-AriaNeural"

if (!langCode || !voice) {
  console.error("Usage: node scripts/generate-audio.js <langCode> <voiceName>");
  process.exit(1);
}

const courseData = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, `../public/data/${langCode}-course.json`),
    "utf-8",
  ),
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateAudio(text, finalPath) {
  if (fs.existsSync(finalPath)) {
    console.log("Skipping (already exists):", path.basename(finalPath));
    return;
  }
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const tempDir = path.join(
    os.tmpdir(),
    "stembridge-tts-" + Date.now() + "-" + Math.random().toString(36).slice(2),
  );
  fs.mkdirSync(tempDir, { recursive: true });
  const { audioFilePath } = await tts.toFile(tempDir, text, { rate: "-20%" });
  fs.renameSync(audioFilePath, finalPath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("Generated:", path.basename(finalPath));
}

async function main() {
  const outDir = path.join(__dirname, `../public/audio/${langCode}`);
  fs.mkdirSync(outDir, { recursive: true });

  for (const unit of courseData.units) {
    for (const chunk of unit.teaching) {
      if (chunk.ex && chunk.audioId) {
        await generateAudio(
          chunk.ex,
          path.join(outDir, `${chunk.audioId}.mp3`),
        );
        await sleep(500);
      }
    }
    for (const q of unit.quiz) {
      if (q.q && q.audioId) {
        await generateAudio(q.q, path.join(outDir, `${q.audioId}.mp3`));
        await sleep(500);
      }
    }
  }
  console.log(`All done for ${langCode}.`);
}

main();
