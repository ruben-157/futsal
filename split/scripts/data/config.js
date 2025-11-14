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

export const SKILLS = {
  Job: 3,
  Ramtin: 2,
  Thijs: 4,
  Emiel: 4,
  Frits: 3,
  Gerjan: 3,
  Wout: 3,
  Aklilu: 1,
  Aron: 1,
  Aurant: 2,
  Bas: 4,
  Bjorn: 4,
  Danny: 3,
  David: 3,
  Hanno: 5,
  Jefta: 3,
  Lenn: 3,
  Nathan: 3,
  Ruben: 4,
  Rene: 3,
  Sem: 5,
  Timo: 3,
  Wijnand: 3,
  Willem: 4,
  Amir: 4,
  Ralph: 5,
};

export const DEFAULT_SKILL = 3;
export function getSkill(name){
  return typeof SKILLS[name] === 'number' ? SKILLS[name] : DEFAULT_SKILL;
}

export const STAMINA = {
  Job: 3,
  Ramtin: 1,
  Thijs: 4,
  Emiel: 3,
  Frits: 2,
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
  Amir: 4,
  Ralph: 5,
};

export const DEFAULT_STAMINA = 3;
export function getStamina(name){
  return typeof STAMINA[name] === 'number' ? STAMINA[name] : DEFAULT_STAMINA;
}
