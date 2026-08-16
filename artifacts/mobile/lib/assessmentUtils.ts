export type HeightUnit = "cm" | "ft_in";
export type WeightUnit = "kg" | "lb";

const CM_PER_INCH = 2.54;
const KG_PER_POUND = 0.45359237;

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * CM_PER_INCH;
}

export function poundsToKg(pounds: number): number {
  return pounds * KG_PER_POUND;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / CM_PER_INCH;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round((totalInches - feet * 12) * 10) / 10;
  if (inches >= 12) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

export function kgToPounds(kg: number): number {
  return kg / KG_PER_POUND;
}

export function calculateBmi(heightCm: number, weightKg: number): number | null {
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg) || heightCm <= 0 || weightKg <= 0) {
    return null;
  }
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

export function sortNewestByDate<T extends { date?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aMs = a.date ? Date.parse(a.date) : 0;
    const bMs = b.date ? Date.parse(b.date) : 0;
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
  });
}

export function isValidAssessmentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
