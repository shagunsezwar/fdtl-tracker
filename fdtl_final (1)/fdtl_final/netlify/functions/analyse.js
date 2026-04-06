// Netlify Function — Google Gemini API proxy for IndiGo FDTL Monitor
// Uses Gemini 1.5 Flash — FREE tier, no credit card needed
// Get your free key at: aistudio.google.com

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({
        error: 'GEMINI_API_KEY not set. Get a FREE key at aistudio.google.com → Get API Key. Then add it in Netlify → Site configuration → Environment variables → GEMINI_API_KEY'
      })
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { imageBase64, mediaType, rosterType } = body;
  if (!imageBase64 || !mediaType) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing image data' }) };
  }

  const typeDesc = {
    pre:    'PRE-ROSTER (planned duties, published before the month starts)',
    update: 'ROSTER UPDATE (mid-month scheduling changes/swaps)',
    actual: 'ACTUAL ROSTER / E-LOGBOOK (what was actually flown)',
  }[rosterType] || 'ROSTER';

  const prompt = `You are an expert IndiGo aviation FDTL compliance analyser reading a ${typeDesc} from the IndiGo eCrew app.

== HOW TO READ THE INDIGO ECREW ROSTER FORMAT ==

Each duty block looks like this:
  DATE (e.g. "01 Wed")
  Reporting time: HHMM
  FLTNO  DEPTIME  ORIGIN  DEST  ARRTIME
  FLTNO  DEPTIME  ORIGIN  DEST  ARRTIME  (more sectors if multi-sector)
  Debriefing time: HHMM

Special day types — SKIP these, do NOT include in output:
  - OFG / Golden Day Off — rest day
  - PL / Privilege Leave — leave
  - Blank/empty day — no duty
  - HOTEL lines — outstation rest, not a duty
  - "Rest:" lines — just rest period info

ONLY extract rows that have BOTH a "Reporting time" AND a "Debriefing time".

EXAMPLE: "01 Wed, Reporting time: 1520, 6E2013 1620 BLR IXC 1820, 6E2014 1920 IXC BLR 2230, Debriefing time: 2300"
  date = "2026-04-01"
  route = "BLR-IXC-BLR"
  reportTime = "15:20"
  engoff = "23:00"  (debriefing time minus 30 min, since debrief = engine off + 30 min post-flight)
  debriefTime = "23:30" (add 30 min to engine off per §2.4.1.2)
  block = total flying time across all sectors in hours
  landings = number of sectors (2 here)
  night = true if FDP encroaches 0000-0600 local time

== FDTL RULES — IndiGo OMA Chapter 2, TR13/2026 ==

§2.6.1 — 2-PILOT FDP LIMITS (day duty):
  6 landings → max FT 8h, max FDP 11:00h
  5 landings → max FT 8h, max FDP 11:30h
  4 landings → max FT 8h, max FDP 12:00h
  3 landings → max FT 8h, max FDP 12:30h
  2 landings → max FT 9h, max FDP 13:00h
  1 landing  → max FT 10h, max FDP 13:00h

§2.6.1.4 — Night duty (FDP touches 0000–0600):
  max FT 8h, max FDP 10:00h, max 2 landings

§2.4.1.2 — Actual FDP = report time → engine off + 30 min post-flight
  So: actualFDP = (debriefTime - reportTime) in hours

§2.10.1 — Min rest between duties:
  Must be MAX of (preceding FDP) AND (12h domestic)

== CALCULATION ==
1. For each flight duty: actualFDP = debriefTime - reportTime (handle midnight crossover)
2. night = true if FDP window overlaps 0000-0600
3. For consecutive duties: restBefore = this reportTime - previous debriefTime
4. restOk = restBefore >= max(previousFDP, 12)
5. legal = no FDTL rules violated

== OUTPUT ==
Return ONLY raw JSON, no markdown, no explanation, no code fences:
{
  "duties": [
    {
      "date": "2026-04-01",
      "route": "BLR-IXC-BLR",
      "reportTime": "15:20",
      "engoff": "23:00",
      "debriefTime": "23:30",
      "block": 6.5,
      "landings": 2,
      "night": false,
      "actualFDP": 8.0,
      "maxFDP": 13.0,
      "maxFT": 9.0,
      "maxLandings": 2,
      "legal": true,
      "issues": [],
      "restBefore": null,
      "minRest": 12,
      "restOk": true,
      "rosterType": "${rosterType || 'pre'}"
    }
  ],
  "summary": "X duties checked. Y illegal, Z advisory.",
  "totalDuties": 5,
  "illegalCount": 0,
  "warnCount": 1
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey.trim()}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: mediaType,
                data: imageBase64,
              }
            },
            {
              text: prompt
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini error:', response.status, errText);
      return {
        statusCode: 502, headers: CORS,
        body: JSON.stringify({ error: `Gemini API error ${response.status}: ${errText}` })
      };
    }

    const data = await response.json();

    // Extract text from Gemini response
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Empty response from Gemini' }) };
    }

    // Strip any markdown fences
    const cleaned = text.replace(/^```json\s*/m, '').replace(/^```\s*/m, '').replace(/```\s*$/m, '').trim();

    // Validate JSON
    JSON.parse(cleaned);

    return { statusCode: 200, headers: CORS, body: cleaned };

  } catch (err) {
    console.error('Function error:', err.message);
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: `Error: ${err.message}` })
    };
  }
};
