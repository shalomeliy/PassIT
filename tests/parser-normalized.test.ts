import { describe, expect, it } from 'vitest';
import { parseTranscript } from '../src/domain/parser.js';
import { addressLines, type CleanAddress } from '../api/_lib/transcribe';

// Haiku returns structured addresses; addressLines joins them into "street number city extra" per line.
// These pin that parser.js reads that format the same way every time.
const lines = (text: string) => addressLines(text.split('\n').map((l): CleanAddress => {
  const [street, number, city = '', extra = ''] = l.split('|').map((x) => x.trim());
  return { street, number, city, extra };
}));
const parse = (text: string, defaultCity = 'רחובות') =>
  parseTranscript(lines(text), { defaultCity }).map((a) => [a.street, a.number, a.city]);

describe('parser.js on the cleaned format', () => {
  it('reads one address per line with and without a city', () => {
    expect(parse('הרצל|8|רחובות\nויצמן|14|פתח תקווה\nביאליק|3')).toEqual([
      ['הרצל', '8', 'רחובות'], ['ויצמן', '14', 'פתח תקווה'], ['ביאליק', '3', 'רחובות'],
    ]);
  });

  it('keeps cities of two words and streets named after cities', () => {
    expect(parse('שדרות ירושלים|120|תל אביב\nהנשיא|5|ראשון לציון\nאחד העם|1|באר שבע')).toEqual([
      ['שדרות ירושלים', '120', 'תל אביב-יפו'], ['הנשיא', '5', 'ראשון לציון'], ['אחד העם', '1', 'באר שבע'],
    ]);
  });

  it('keeps a house letter and apartment details', () => {
    const [a] = parseTranscript(lines('הרצל|17א|רחובות|דירה 4 קומה 2'), { defaultCity: null });
    expect([a.street, a.number, a.city, a.apartment, a.floor]).toEqual(['הרצל', '17א', 'רחובות', '4', '2']);
  });

  it('survives a comma inside a field', () => {
    expect(parse('הרצל|8|רחובות,\nויצמן|14|פתח תקווה')).toEqual([['הרצל', '8', 'רחובות'], ['ויצמן', '14', 'פתח תקווה']]);
  });

  it('keeps an address with no city on the start city', () => {
    expect(parse('הרצל|8|\nביאליק|3|', 'יבנה')).toEqual([['הרצל', '8', 'יבנה'], ['ביאליק', '3', 'יבנה']]);
  });

  it('documents the open gap: a city missing from cities.js becomes a bogus street', () => {
    expect(parse('הרצל|8|גבעת שמואל', '')).toEqual([['הרצל', '8', ''], ['גבעת שמואל', null, '']]);
  });

  it('documents why commas are stripped: parser.js splits on them', () => {
    const raw = parseTranscript('הרצל 8, רחובות', { defaultCity: null });
    expect(raw.length).toBe(2);   // "הרצל 8" and a bogus "רחובות" with no number
  });
});
