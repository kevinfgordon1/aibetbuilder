// UI sport chips. Soccer is one chip that maps to soccer_epl + soccer_usa_mls.
// Those remain the Odds API / cache keys — do not invent a soccer Odds API key.
//
// Chip on iff at least one soccer key is selected. Toggling Soccer on sets both;
// toggling off clears both. A lone EPL or MLS key in profile/URL still lights Soccer.

import { SOCCER_SPORT_KEYS, isSoccerSport } from "./soccerPairing.js";

export const SOCCER_CHIP_ID = "soccer";
export const SOCCER_CHIP_LABEL = "Soccer";

export function sportChipOptions(sports) {
  const chips = [];
  let soccerInserted = false;
  for (const s of sports || []) {
    if (SOCCER_SPORT_KEYS.includes(s.key)) {
      if (!soccerInserted) {
        chips.push({
          id: SOCCER_CHIP_ID,
          label: SOCCER_CHIP_LABEL,
          keys: [...SOCCER_SPORT_KEYS],
        });
        soccerInserted = true;
      }
      continue;
    }
    chips.push({ id: s.key, label: s.label, keys: [s.key] });
  }
  return chips;
}

export function isSoccerChipId(id) {
  return id === SOCCER_CHIP_ID || isSoccerSport(id);
}

export function soccerKeysSelected(selected) {
  const set = selected instanceof Set ? selected : new Set(selected || []);
  return SOCCER_SPORT_KEYS.some((k) => set.has(k));
}

function chipKeys(chip) {
  if (!chip) return [];
  if (Array.isArray(chip.keys) && chip.keys.length) return chip.keys;
  if (chip.key) return [chip.key];
  return [];
}

export function sportChipSelected(chip, selected) {
  const set = selected instanceof Set ? selected : new Set(selected || []);
  if (!chip) return false;
  if (chip.id === SOCCER_CHIP_ID) return soccerKeysSelected(set);
  return chipKeys(chip).some((k) => set.has(k));
}

export function toggleSportChip(selected, chip, { minSelected = 1 } = {}) {
  const prev = selected instanceof Set ? new Set(selected) : new Set(selected || []);
  const keys = chip && chip.id === SOCCER_CHIP_ID ? [...SOCCER_SPORT_KEYS] : chipKeys(chip);
  if (!keys.length) return prev;
  const next = new Set(prev);
  if (sportChipSelected(chip, prev)) {
    for (const k of keys) next.delete(k);
    if (next.size < minSelected) return prev;
    return next;
  }
  for (const k of keys) next.add(k);
  return next;
}

export function selectedSportChipLabels(selected, chips) {
  return (chips || []).filter((c) => sportChipSelected(c, selected)).map((c) => c.label);
}

export function formatSelectedSportsSummary(selected, chips) {
  const labels = selectedSportChipLabels(selected, chips);
  if (!labels.length) return "";
  return labels.length === (chips || []).length ? "All sports" : labels.join(", ");
}

export function boardSportMatches(gameSport, boardChipId) {
  if (isSoccerChipId(boardChipId)) return isSoccerSport(gameSport);
  return gameSport === boardChipId;
}
