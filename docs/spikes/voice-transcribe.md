# Spike: recording + server transcription instead of Web Speech

**Status:** built, waiting for real phone tests. Verdict: TBD.

## What it tests

The riskiest assumptions of replacing Chrome's Web Speech API in `AddStops.tsx` and `FailReason.tsx`:

1. MediaRecorder works on iPhone (Safari and home-screen app) and Android Chrome, and OpenAI accepts the file (mp4 / webm).
2. `gpt-4o-mini-transcribe` with `language: he` and an address prompt hears Israeli streets, numbers and cities well enough.
3. Claude Haiku (`claude-haiku-5-5`) turns the raw text into one clean line per address that `parser.js` reads correctly, applies self-corrections ("הרצל 5 לא סליחה 8") and does not invent cities or numbers.
4. The wait after pressing stop (transcription + Haiku) is acceptable for a courier.

## Haiku call (updated 2026-11-21)

- Structured outputs (`output_config.format`, JSON schema): stops mode returns `{addresses: [{street, number, city, extra}]}`, reason mode returns `{reason}`. The server joins addresses into "street number city extra" lines with no commas for `parser.js`. If the JSON fails, or Haiku fails or refuses, the raw transcript is used.
- Prompt caching on the fixed system prompt. The stops prompt (rules, city list, 5 examples) is estimated at about 900-1300 tokens, over Haiku 5.5's 512-token minimum, so it caches. The reason prompt is estimated at about 300 tokens, under the minimum, so it does not cache. The test page shows the real cached token count per call. The cache lives 5 minutes, and at Haiku prices the saving is small. The main gain is a slightly shorter wait.
- Few-shot examples of self-corrections, number words, apartment details, streets named after cities and silence.
- Known gap: a city Haiku hears that `cities.js` does not list (e.g. גבעת שמואל) is read by `parser.js` as a new street. The response lists such cities in `unknownCities`, and the page warns about them. Fix in the full build: use Haiku's structured addresses directly, or extend `cities.js`.

## How to run

- Vercel env vars (Production and Preview): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must already be set (the endpoint checks company membership with them).
- Open `https://<site>/spikes/voice-transcribe/` on the phone and sign in with the company admin's email and password.
  The page keeps its own sign-in, so it never replaces a courier's identity on that phone.
- For the iPhone home-screen test: Share > Add to Home Screen from that page, then open it from the icon.
- Each result shows: format and size, time of each step, raw text, Haiku text, and what `parser.js` makes of both.

## Script to read (each on iPhone and Android)

1. Three plain addresses with cities: "הרצל שמונה רחובות, ויצמן ארבע עשרה פתח תקווה, ביאליק שלוש".
2. A self-correction: "הרצל חמש לא סליחה שמונה".
3. Details: "רוטשילד שבע עשרה א דירה ארבע קומה שתיים ראשון לציון".
4. A long list (8-10 addresses) at normal speed, with a short pause between them, outdoors or on the scooter.
5. Failure reason mode: "אממ הלקוח לא היה בבית, התקשרתי פעמיים והוא לא ענה".

## Result

TBD: fill in per phone: did it record, accuracy of raw vs clean, wrong streets/numbers, invented content, seconds waited.
