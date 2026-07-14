const { getStore } = require("@netlify/blobs");

// Horaires réels de Le Salon K (9 Rue Pierre Guillaume Petit, 76620 Le Havre)
// Mar-Jeu 9h-12h / 14h-19h (coupure déjeuner), Ven 9h-19h en continu, Sam 9h-18h, fermé Dimanche
// Fermé le Lundi jusqu'à nouvel ordre (annonce du salon publiée le 22/06, effective à partir du 13/07)
const HOURS = {
  0: null, // dimanche
  1: null, // lundi — fermé jusqu'à nouvel ordre
  2: [[9, 12], [14, 19]], // mardi
  3: [[9, 12], [14, 19]], // mercredi
  4: [[9, 12], [14, 19]], // jeudi
  5: [[9, 19]], // vendredi
  6: [[9, 18]], // samedi
};
const SLOT_MINUTES = 45;

function pad(n) { return n.toString().padStart(2, "0"); }

function generateSlots(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const ranges = HOURS[day];
  if (!ranges) return [];
  const slots = [];
  for (const [openH, closeH] of ranges) {
    let mins = openH * 60;
    const closeMins = closeH * 60;
    while (mins + SLOT_MINUTES <= closeMins) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      slots.push(`${pad(h)}:${pad(m)}`);
      mins += SLOT_MINUTES;
    }
  }
  return slots;
}

function isPast(dateStr, time) {
  const now = new Date();
  const [h, m] = time.split(":").map(Number);
  const slotDate = new Date(dateStr + "T00:00:00");
  slotDate.setHours(h, m, 0, 0);
  return slotDate.getTime() < now.getTime();
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const store = getStore({
      name: "le-salon-k-bookings",
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN,
    });

    if (event.httpMethod === "GET") {
      const date = (event.queryStringParameters || {}).date;
      if (!date) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "date manquante" }) };
      }
      const possible = generateSlots(date);
      if (possible.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ open: false, slots: [] }) };
      }
      const existing = (await store.get(date, { type: "json" })) || { taken: [] };
      const takenSet = new Set(existing.taken || []);
      const slots = possible
        .filter((t) => !isPast(date, t))
        .map((t) => ({ time: t, taken: takenSet.has(t) }));
      return { statusCode: 200, headers, body: JSON.stringify({ open: true, slots }) };
    }

    if (event.httpMethod === "POST") {
      const data = JSON.parse(event.body || "{}");
      const { date, time, name, phone, service } = data;
      if (!date || !time || !name || !phone) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, reason: "champs manquants" }) };
      }
      const possible = generateSlots(date);
      if (!possible.includes(time)) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, reason: "créneau invalide" }) };
      }
      const existing = (await store.get(date, { type: "json" })) || { taken: [], bookings: [] };
      if ((existing.taken || []).includes(time)) {
        return { statusCode: 409, headers, body: JSON.stringify({ ok: false, reason: "déjà réservé" }) };
      }
      const updated = {
        taken: [...(existing.taken || []), time],
        bookings: [...(existing.bookings || []), { time, name, phone, service: service || "", createdAt: new Date().toISOString() }],
      };
      await store.setJSON(date, updated);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "méthode non supportée" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
