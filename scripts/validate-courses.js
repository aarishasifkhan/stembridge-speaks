const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "../public/data");
const audioBaseDir = path.join(__dirname, "../public/audio");
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith("-course.json"));

let totalErrors = 0;

files.forEach((file) => {
  const langCode = file.replace("-course.json", "");
  console.log(`\n=== Checking ${file} ===`);
  let raw;
  try {
    raw = fs.readFileSync(path.join(dataDir, file), "utf-8");
  } catch (e) {
    console.log(`  ❌ Could not read file: ${e.message}`);
    totalErrors++;
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.log(`  ❌ INVALID JSON: ${e.message}`);
    totalErrors++;
    return;
  }
  console.log(`  ✅ Valid JSON`);

  if (!data.units || data.units.length === 0) {
    console.log(
      `  ⚠️  No units found (may be intentionally empty/coming soon)`,
    );
    return;
  }

  const seenAudioIds = new Set();
  const seenUnitIds = new Set();

  data.units.forEach((unit, ui) => {
    const label = `unit[${ui}] (${unit.id || "NO ID"})`;

    if (!unit.id) {
      console.log(`  ❌ ${label}: missing "id"`);
      totalErrors++;
    }
    if (seenUnitIds.has(unit.id)) {
      console.log(`  ❌ ${label}: duplicate unit id`);
      totalErrors++;
    }
    seenUnitIds.add(unit.id);

    if (!unit.title) {
      console.log(`  ❌ ${label}: missing "title"`);
      totalErrors++;
    }
    if (!unit.icon) {
      console.log(`  ⚠️  ${label}: missing "icon"`);
    }

    (unit.teaching || []).forEach((chunk, ci) => {
      const cLabel = `${label} teaching[${ci}]`;
      if (!chunk.h) {
        console.log(`  ❌ ${cLabel}: missing heading`);
        totalErrors++;
      }
      if (!chunk.p) {
        console.log(`  ❌ ${cLabel}: missing explanation text`);
        totalErrors++;
      }
      if (chunk.ex && !chunk.audioId) {
        console.log(
          `  ❌ ${cLabel}: has example text but NO audioId — speaker button will do nothing`,
        );
        totalErrors++;
      }
      if (chunk.audioId) {
        if (seenAudioIds.has(chunk.audioId)) {
          console.log(
            `  ❌ ${cLabel}: duplicate audioId "${chunk.audioId}" — will overwrite another file`,
          );
          totalErrors++;
        }
        seenAudioIds.add(chunk.audioId);
      }
    });

    const quiz = unit.quiz || [];
    if (quiz.length !== 5) {
      console.log(
        `  ⚠️  ${label}: has ${quiz.length} quiz questions, expected 5`,
      );
    }

    quiz.forEach((q, qi) => {
      const qLabel = `${label} quiz[${qi}]`;
      if (!q.q) {
        console.log(`  ❌ ${qLabel}: missing question text`);
        totalErrors++;
      }
      if (!q.answer) {
        console.log(`  ❌ ${qLabel}: missing answer`);
        totalErrors++;
      }
      if (!q.audioId) {
        console.log(`  ❌ ${qLabel}: missing audioId`);
        totalErrors++;
      } else if (seenAudioIds.has(q.audioId)) {
        console.log(`  ❌ ${qLabel}: duplicate audioId "${q.audioId}"`);
        totalErrors++;
      } else seenAudioIds.add(q.audioId);

      if (q.type === "mc") {
        if (!q.options || q.options.length < 2) {
          console.log(
            `  ❌ ${qLabel}: multiple-choice question needs at least 2 options`,
          );
          totalErrors++;
        } else if (!q.options.includes(q.answer)) {
          console.log(
            `  ❌ ${qLabel}: THE ANSWER "${q.answer}" IS NOT AMONG THE OPTIONS [${q.options.join(", ")}] — this question can never be marked correct!`,
          );
          totalErrors++;
        }
      } else if (q.type !== "fill") {
        console.log(`  ⚠️  ${qLabel}: unknown question type "${q.type}"`);
      }
    });
  });

  const audioDir = path.join(audioBaseDir, langCode);
  if (!fs.existsSync(audioDir)) {
    console.log(
      `  ⚠️  No audio folder found at public/audio/${langCode}/ — run the generation script for this language`,
    );
  } else {
    let missingAudio = 0;
    seenAudioIds.forEach((id) => {
      if (!fs.existsSync(path.join(audioDir, `${id}.mp3`))) missingAudio++;
    });
    if (missingAudio > 0) {
      console.log(
        `  ❌ ${missingAudio} referenced audioId(s) have NO matching .mp3 file in public/audio/${langCode}/`,
      );
      totalErrors += missingAudio;
    } else {
      console.log(`  ✅ All ${seenAudioIds.size} referenced audio files exist`);
    }
  }
});

console.log(`\n=====================================`);
if (totalErrors === 0) {
  console.log(`✅ ALL CHECKS PASSED — no structural issues found.`);
} else {
  console.log(`❌ Found ${totalErrors} issue(s) that need fixing — see above.`);
}
console.log(`=====================================\n`);
