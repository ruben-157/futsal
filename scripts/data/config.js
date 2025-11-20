export const DEFAULT_PLAYERS = [
  "Ruben","Job","Ramtin","Thijs","Emiel","Frits","Gerjan","Wout","Aklilu","Aron","Aurant","Bas","Bjorn","Danny","David","Hanno","Jefta","Lenn","Nathan","Rene","Sem","Timo","Wijnand","Willem","Amir","Ralph"
];

export const COLORS = [
  { name: "Green",  hex: "#10B981" },
  { name: "Blue",   hex: "#3B82F6" },
  { name: "Orange", hex: "#F59E0B" },
  { name: "Grey",   hex: "#6B7280" },
];

export const MAX_ATTENDEES = 20;

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const RATING_STEP = 0.5;

export const DEFAULT_SKILL = 3;
export const DEFAULT_STAMINA = 3;

export const SKILLS = {
  Job: 3.7,
  Ramtin: 2,
  Thijs: 4,
  Emiel: 3.7,
  Frits: 3.2,
  Gerjan: 3.2,
  Wout: 3,
  Aklilu: 1,
  Aron: 1,
  Aurant: 2.2,
  Bas: 3.8,
  Bjorn: 4,
  Danny: 3,
  David: 3,
  Hanno: 5,
  Jefta: 3.6,
  Lenn: 3.7,
  Nathan: 3.5,
  Ruben: 3.9,
  Rene: 3.6,
  Sem: 4.8,
  Timo: 3.2,
  Wijnand: 3.5,
  Willem: 4,
  Amir: 3.7,
  Ralph: 5,
};

export const STAMINA = {
  Job: 3,
  Ramtin: 1,
  Thijs: 4,
  Emiel: 3,
  Frits: 3,
  Gerjan: 3,
  Wout: 2,
  Aklilu: 1,
  Aron: 1,
  Aurant: 2,
  Bas: 3,
  Bjorn: 3,
  Danny: 3,
  David: 3,
  Hanno: 5,
  Jefta: 4,
  Lenn: 4,
  Nathan: 4,
  Ruben: 4,
  Rene: 3,
  Sem: 4,
  Timo: 2,
  Wijnand: 4,
  Willem: 4,
  Amir: 3,
  Ralph: 5,
};

export function normalizeRating(value, fallback = DEFAULT_SKILL){
  const fallbackNumber = Number.isFinite(fallback) ? fallback : DEFAULT_SKILL;
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  const base = Number.isFinite(parsed) ? parsed : fallbackNumber;
  const clamped = Math.min(RATING_MAX, Math.max(RATING_MIN, base));
  return Number(clamped.toFixed(2));
}

export function snapToRatingStep(value, fallback = DEFAULT_SKILL){
  const normalized = normalizeRating(value, fallback);
  const steps = Math.round((normalized - RATING_MIN) / RATING_STEP);
  const snapped = RATING_MIN + steps * RATING_STEP;
  return Number(Math.min(RATING_MAX, Math.max(RATING_MIN, snapped)).toFixed(2));
}

export function getSkill(name){
  return normalizeRating(SKILLS[name], DEFAULT_SKILL);
}

export function getStamina(name){
  return normalizeRating(STAMINA[name], DEFAULT_STAMINA);
}
