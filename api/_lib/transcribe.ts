// Voice to text for the courier: OpenAI turns the recording into Hebrew text, then Claude Haiku cleans it.
// Pure logic with injected fetch and Anthropic client, so it runs in the Vercel function, the Vite dev server and tests alike.
import type Anthropic from '@anthropic-ai/sdk';
import { CITIES } from '../../src/domain/cities.js';
import { HttpError } from './optimize.js';

/** stops: a list of addresses, one per line for parser.js. reason: one short failure reason for the daily report. */
export type TranscribeMode = 'stops' | 'reason';

export interface TranscribeDeps {
  openaiKey?: string;
  anthropic?: Pick<Anthropic, 'messages'> | null;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  fetch?: typeof fetch;
}

export interface TranscribeOutput {
  mode: TranscribeMode;
  raw: string;
  /** null when Haiku failed or refused; the caller then uses raw. */
  clean: string | null;
  cleanError?: string;
  /** Haiku's structured result in stops mode, kept for the full build. */
  addresses?: CleanAddress[];
  /** Cities that parser.js would not recognise in the lines. */
  unknownCities?: string[];
  /** Prompt tokens served from Anthropic's cache on this call (0 = cache miss or prompt too short). */
  cachedTokens?: number;
  ms: { transcribe: number; clean: number };
}

export const STT_MODEL = 'gpt-4o-mini-transcribe';
export const CLEAN_MODEL = 'claude-haiku-5-5';
/** Vercel refuses request bodies over 4.5 MB, so the app keeps recordings under this. */
export const MAX_BYTES = 4 * 1024 * 1024;
const MIN_BYTES = 1000;

// OpenAI reads the format from the file name, so each recording type gets its own extension.
const EXT: Record<string, string> = {
  'audio/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3',
};
export const extFor = (contentType: string) => EXT[contentType.split(';')[0].trim().toLowerCase()] ?? null;

const CITY_NAMES = CITIES.map((c) => c[0]).join(', ');
export const STT_PROMPT = {
  stops: `שליח מקריא רשימת כתובות למשלוח בישראל: רחוב, מספר בית, ולפעמים עיר, דירה, קומה או כניסה. למשל: הרצל 8 רחובות, ויצמן 14 פתח תקווה דירה 3. ערים: ${CITY_NAMES}.`,
  reason: 'שליח מסביר בקצרה למה משלוח לא נמסר: לא היה בבית, לא ענה, אין גישה, סירב, ביקש לתאם מחדש.',
} as const;

// The fixed instructions for Haiku. They never change between calls, so they are cached (see cleanText).
// Examples of the hard cases are part of the prompt: they teach more than rules alone.
export const CLEAN_PROMPT = {
  stops: `You clean a Hebrew speech transcript of a courier reading delivery addresses in Israel, and return them as structured data.

Rules:
- One entry per address, in the order spoken.
- Remove filler words and greetings ("אממ", "יאללה", "אוקיי", "הבאה", "אחר כך", "תרשום").
- Apply the courier's own corrections: "לא סליחה", "לא, בעצם", "טעיתי", "רגע" replace what came right before. A correction can replace the number, the street or the whole address.
- number: digits only, plus a house letter if said ("17א"). Words become digits: "חמש" -> 5, "שלוש עשרה" -> 13, "מאה עשרים" -> 120.
- street: the street name exactly as heard, without the words "רחוב" or "מספר". Streets named after cities stay streets ("שדרות ירושלים").
- city: only if the courier said it for that address, written as in the city list below when it is one of them. Otherwise an empty string. Never guess a city.
- extra: apartment, floor, entrance and door code with their Hebrew word and digits ("דירה 4 קומה 2", "כניסה ב", "קוד 1234"), or an empty string.
- Never add an address, street, number or city that was not said. If no address was said, return an empty list.
- No commas in any field.

Known cities: ${CITY_NAMES}.

Examples (transcript -> addresses):
1. "הרצל חמש לא סליחה שמונה רחובות"
   -> [{street:"הרצל", number:"8", city:"רחובות", extra:""}]
2. "אממ ויצמן ארבע עשרה פתח תקווה אחר כך ביאליק שלוש"
   -> [{street:"ויצמן", number:"14", city:"פתח תקווה", extra:""}, {street:"ביאליק", number:"3", city:"", extra:""}]
3. "רוטשילד שבע עשרה א דירה ארבע קומה שתיים ראשון לציון"
   -> [{street:"רוטשילד", number:"17א", city:"ראשון לציון", extra:"דירה 4 קומה 2"}]
4. "שדרות ירושלים מאה עשרים בת ים, הנביאים 3 לא רגע זה הנשיא 3 חולון"
   -> [{street:"שדרות ירושלים", number:"120", city:"בת ים", extra:""}, {street:"הנשיא", number:"3", city:"חולון", extra:""}]
5. "רגע אני מחפש את הרשימה"
   -> []`,
  reason: `You clean a short Hebrew speech transcript where a courier explains why a delivery failed.
Return one short, clear Hebrew sentence for a manager's daily report.
Rules:
- Remove filler words, repetitions and self-corrections; keep the courier's meaning and every fact (names, times, numbers).
- Add basic punctuation. No quotes, no prefix like "סיבה:", no explanation of what you changed.
- Never add facts that were not said. If nothing meaningful was said, return an empty string.

Examples (transcript -> reason):
1. "אממ הלקוח לא היה בבית, התקשרתי פעמיים והוא לא ענה" -> "הלקוח לא היה בבית. התקשרתי פעמיים ולא ענה."
2. "השומר לא נתן להיכנס, לא, בעצם לא היה קוד לשער" -> "לא היה קוד לשער ולא הצלחתי להיכנס."
3. "הלקוחה ביקשה ש ש שנביא מחר אחרי חמש" -> "הלקוחה ביקשה משלוח מחר אחרי 17:00."`,
} as const;

// Structured outputs: the API guarantees JSON in this shape, so nothing free-form reaches parser.js.
const STOPS_SCHEMA = {
  type: 'object',
  properties: {
    addresses: {
      type: 'array',
      items: {
        type: 'object',
        properties: { street: { type: 'string' }, number: { type: 'string' }, city: { type: 'string' }, extra: { type: 'string' } },
        required: ['street', 'number', 'city', 'extra'],
        additionalProperties: false,
      },
    },
  },
  required: ['addresses'],
  additionalProperties: false,
} as const;
const REASON_SCHEMA = {
  type: 'object',
  properties: { reason: { type: 'string' } },
  required: ['reason'],
  additionalProperties: false,
} as const;

export interface CleanAddress { street: string; number: string; city: string; extra: string }

const KNOWN_CITIES = new Set(CITIES.flat());
const noCommas = (t: string) => String(t ?? '').replace(/[,،]/g, ' ').replace(/\s+/g, ' ').trim();

/** One line per address, "street number city extra", the format parser.js reads best. */
export function addressLines(list: CleanAddress[]): string {
  return list
    .map((a) => [a.street, a.number, a.city, a.extra].map(noCommas).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');
}

/** Cities Haiku heard that cities.js does not know: parser.js would read them as a new street. */
export const unknownCities = (list: CleanAddress[]) =>
  [...new Set(list.map((a) => noCommas(a.city)).filter((c) => c && !KNOWN_CITIES.has(c)))];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/**
 * Only an active company member (admin or courier) may spend the OpenAI and Anthropic credit.
 * The Supabase access token is checked with Supabase itself, then the members table is read with that
 * token, so row security decides what the caller can see. No service key is needed.
 */
export async function requireMember(request: Request, d: TranscribeDeps): Promise<string> {
  const f = d.fetch ?? fetch;
  if (!d.supabaseUrl || !d.supabaseAnonKey) throw new HttpError(500, 'השרת לא מוגדר: חסר VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'צריך להתחבר כדי להשתמש בהקלטה');
  const headers = { apikey: d.supabaseAnonKey, Authorization: `Bearer ${token}` };
  const base = d.supabaseUrl.replace(/\/+$/, '');
  const u = await f(`${base}/auth/v1/user`, { headers });
  if (!u.ok) throw new HttpError(401, 'החיבור פג. התחבר מחדש');
  const id = ((await u.json()) as { id?: string }).id;
  if (!id) throw new HttpError(401, 'החיבור פג. התחבר מחדש');
  const m = await f(`${base}/rest/v1/members?select=role&user_id=eq.${encodeURIComponent(id)}&active=eq.true&limit=1`, { headers });
  const rows = m.ok ? ((await m.json()) as unknown[]) : [];
  if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(403, 'ההקלטה פתוחה רק לשליחים ומנהלים של חברה');
  return id;
}

// Best-effort guard per signed-in user, on top of the spending caps in the OpenAI and Anthropic accounts.
// Counters live in one function instance's memory, so they reset on cold starts.
const PER_10_MIN = 20, PER_DAY = 200;
const usage = new Map<string, number[]>();
export function checkUserLimits(user: string, now = Date.now()) {
  const recent = (usage.get(user) ?? []).filter((t) => now - t < 86_400_000);
  if (recent.length >= PER_DAY) throw new HttpError(429, 'הגעת לתקרת ההקלטות היומית');
  if (recent.filter((t) => now - t < 600_000).length >= PER_10_MIN) throw new HttpError(429, 'יותר מדי הקלטות ברצף. חכה כמה דקות');
  recent.push(now); usage.set(user, recent);
}

export async function transcribeAudio(audio: ArrayBuffer, contentType: string, mode: TranscribeMode, d: TranscribeDeps): Promise<string> {
  const f = d.fetch ?? fetch;
  const ext = extFor(contentType);
  if (!ext) throw new HttpError(415, 'פורמט הקלטה לא נתמך');
  const form = new FormData();
  form.append('file', new Blob([audio], { type: contentType.split(';')[0] }), `recording.${ext}`);
  form.append('model', STT_MODEL);
  form.append('language', 'he');
  form.append('prompt', STT_PROMPT[mode]);
  form.append('response_format', 'json');
  const r = await f('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${d.openaiKey}` }, body: form });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new HttpError(502, `התמלול נכשל (${r.status})${detail ? ': ' + detail.slice(0, 200) : ''}`);
  }
  return String(((await r.json()) as { text?: string }).text ?? '').trim();
}

export interface CleanResult { text: string; addresses?: CleanAddress[]; cachedTokens: number }

export async function cleanText(raw: string, mode: TranscribeMode, anthropic: Pick<Anthropic, 'messages'>): Promise<CleanResult> {
  const msg = await anthropic.messages.create({
    model: CLEAN_MODEL,
    max_tokens: 2048,
    // A short rewrite: no thinking and low effort keep the courier's wait short.
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: mode === 'stops' ? STOPS_SCHEMA : REASON_SCHEMA } },
    // The instructions are the same on every call, so they are cached for 5 minutes. Only the transcript is new.
    system: [{ type: 'text', text: CLEAN_PROMPT[mode], cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: raw }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('refusal');
  if (msg.stop_reason === 'max_tokens') throw new Error('התשובה נקטעה');
  const json = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const data = JSON.parse(json) as { addresses?: CleanAddress[]; reason?: string };
  const cachedTokens = msg.usage?.cache_read_input_tokens ?? 0;
  if (mode === 'reason') return { text: oneLine(data.reason ?? ''), cachedTokens };
  const addresses = Array.isArray(data.addresses) ? data.addresses : [];
  return { text: addressLines(addresses), addresses, cachedTokens };
}

const oneLine = (t: string) => String(t).replace(/\s+/g, ' ').trim();

export async function handleTranscribe(request: Request, d: TranscribeDeps): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'POST בלבד');
    if (!d.openaiKey) throw new HttpError(500, 'השרת לא מוגדר: חסר OPENAI_API_KEY');
    const mode: TranscribeMode = new URL(request.url).searchParams.get('mode') === 'reason' ? 'reason' : 'stops';
    const user = await requireMember(request, d);
    const type = request.headers.get('content-type') ?? '';
    if (!extFor(type)) throw new HttpError(415, 'פורמט הקלטה לא נתמך');
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new HttpError(413, 'ההקלטה ארוכה מדי');
    const audio = await request.arrayBuffer();
    if (audio.byteLength > MAX_BYTES) throw new HttpError(413, 'ההקלטה ארוכה מדי');
    if (audio.byteLength < MIN_BYTES) throw new HttpError(400, 'ההקלטה ריקה. נסה שוב');
    checkUserLimits(user);

    const t0 = Date.now();
    const raw = await transcribeAudio(audio, type, mode, d);
    const t1 = Date.now();
    const out: TranscribeOutput = { mode, raw, clean: null, ms: { transcribe: t1 - t0, clean: 0 } };
    if (!raw) { out.clean = ''; return json(200, out); }
    if (!d.anthropic) out.cleanError = 'חסר ANTHROPIC_API_KEY';
    else {
      try {
        const c = await cleanText(raw, mode, d.anthropic);
        out.clean = c.text;
        out.cachedTokens = c.cachedTokens;
        if (c.addresses) { out.addresses = c.addresses; out.unknownCities = unknownCities(c.addresses); }
      }
      catch (e) { out.cleanError = (e as Error).message || 'הניקוי נכשל'; }
    }
    out.ms.clean = Date.now() - t1;
    return json(200, out);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    return json(502, { error: 'התמלול נכשל' });
  }
}
