---
name: add-parser-case
description: Use when a dictated Hebrew address list was split or read wrong (wrong street, number, city, apartment, floor, entrance or code), or when the user shares a new real recording transcript. Turns it into a test case in tests/test-cases.js, then fixes the parser until every case passes.
---

# Add a Hebrew parser case

The parser is `src/domain/parser.js` (pure, no network; cities and their spoken variants in `src/domain/cities.js`). It cuts the text into chunks at punctuation (`, . ; : ! ?`, newline) and at spoken separators such as `ואחר כך` (`SEPARATORS` in `parser.js`), so `הרצל 13, רחובות` becomes two chunks and the city is lost. Text meant as one address must not contain punctuation between street, number and city. Cases live in `tests/test-cases.js` and run through `tests/parser.test.ts`.

## 1. Write the case first

Append to `CASES` in `tests/test-cases.js`:

```js
{
  name: 'הקלטה אמיתית N (<who>, <YYYY-MM-DD>, <browser or engine>, "<what is special>")',
  defaultCity: 'יבנה',
  text: '<the transcript exactly as received, double spaces and all>',
  expected: [
    ['<street>', '<number>', '<canonical city>'],
    ['<street>', '<number>', '<canonical city>', { apartment: '4', floor: '3', entrance: 'ב', code: '1234' }],
  ],
},
```

Rules:
- Paste the transcript verbatim. Do not clean it up; the mess is the test.
- Cities are the canonical name from `cities.js` (for example `תל אביב-יפו`, not `תל אביב`).
- Number words become digits (`שלוש עשרה` -> `'13'`); a letter suffix stays (`'17א'`).
- Only list the extra fields the speaker actually said.
- Synthetic cases go in the first group; real recordings get `הקלטה אמיתית` and the next number.

## 2. See it fail

```bash
npx vitest run tests/parser.test.ts
```

If it already passes, the case is still worth keeping as a regression; say so and stop.

## 3. Fix the parser

- Smallest change that makes the new case pass. A missing city or spoken variant goes in `cities.js`, not as a special case in `parser.js`.
- Re-run `tests/parser.test.ts` after each change. Every older case must still pass; never edit an older `expected` to make a fix pass unless the user confirms the old expectation was wrong.
- Then run `npm test` once (the transcript and geocode tests use the parser too).

## 4. Spike copy

`spikes/hebrew-dictation/parser.js` and `cities.js` are copies used by the standalone spike page. Leave them alone unless the user asks to update the spike.
