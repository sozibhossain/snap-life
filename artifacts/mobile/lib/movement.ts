/**
 * Movement library — small, calm, beginner-friendly routines designed to
 * be safe for users managing osteoporosis / osteopenia. Authored as
 * **general guidance only**; the UI surfaces the disclaimer prominently.
 *
 * Each routine targets a specific bone-supporting outcome (posture,
 * balance, strength, gentle weight-bearing, joint mobility) and runs in
 * 5–10 minutes with no equipment beyond a chair / wall.
 */

export interface MovementStep {
  /** Short instructional sentence in supportive en-GB. */
  text: string;
  /** Optional pacing note ("hold for 10 seconds", "rest then repeat"). */
  detail?: string;
}

export interface MovementRoutine {
  id: string;
  title: string;
  /** ≤ 60 chars — appears as the subtitle on the library list. */
  tagline: string;
  /** Whole minutes 5..10. */
  durationMin: number;
  /** Equipment requirement, kept human ("Just you and a chair"). */
  equipment: string;
  /** What this routine is good for, in calm language. */
  intent: string;
  /** 4–6 ordered steps. */
  steps: MovementStep[];
  /** Feather icon name. */
  icon: string;
  /** Accent token mapped in the screen ("primary" | "accent" | "success" | "xpGold"). */
  accent: "primary" | "accent" | "success" | "xpGold";
}

export const MOVEMENT_ROUTINES: MovementRoutine[] = [
  {
    id: "posture-reset",
    title: "Posture reset",
    tagline: "Stand a little taller — wakes up the spine.",
    durationMin: 5,
    equipment: "Just you and a wall",
    intent:
      "A gentle alignment sequence to lengthen the spine and open the chest.",
    icon: "user",
    accent: "primary",
    steps: [
      {
        text: "Stand with your back lightly touching a wall, feet a few inches away.",
        detail: "Soft knees, even weight on both feet.",
      },
      {
        text: "Tuck your chin slightly so the back of your head meets the wall.",
        detail: "Feel the long line from heels to crown.",
      },
      {
        text: "Roll the shoulders back and down, opening across the collarbones.",
        detail: "Hold for 5 slow breaths.",
      },
      {
        text: "Step away from the wall and walk gently, keeping the lift.",
        detail: "Take 10 calm steps.",
      },
      {
        text: "Repeat the wall stand and walk-away twice more.",
        detail: "Two more rounds is enough.",
      },
    ],
  },
  {
    id: "balance-builder",
    title: "Balance builder",
    tagline: "Gentle steadiness work — supports falls prevention.",
    durationMin: 6,
    equipment: "A chair or worktop for support",
    intent:
      "Builds steadier balance, which is one of the most protective things you can do for your bones.",
    icon: "navigation",
    accent: "accent",
    steps: [
      {
        text: "Stand behind a sturdy chair, hands resting lightly on the back.",
        detail: "Feet hip-width apart.",
      },
      {
        text: "Lift one foot a few inches off the floor and hold for a slow count of 10.",
        detail: "Lower with control.",
      },
      {
        text: "Repeat on the other side.",
        detail: "Three rounds each side.",
      },
      {
        text: "If steady, try lifting only one finger from the chair while you hold.",
        detail: "Skip if unsure — steady comes first.",
      },
      {
        text: "Finish by walking heel-to-toe along an imaginary line for 10 steps.",
        detail: "Use the chair as a guide if you need it.",
      },
    ],
  },
  {
    id: "weight-bearing-walk",
    title: "Weight-bearing walk",
    tagline: "A 7-minute brisk walk to wake the bones.",
    durationMin: 7,
    equipment: "Comfortable shoes",
    intent:
      "Weight-bearing movement signals your bones to stay strong. Even a brisk 7 minutes counts.",
    icon: "activity",
    accent: "success",
    steps: [
      {
        text: "Set a steady, slightly brisker-than-stroll pace.",
        detail: "You should be able to talk in short sentences.",
      },
      {
        text: "Land softly on the heel and roll through to the toe.",
        detail: "Quiet, even footsteps.",
      },
      {
        text: "Swing your arms naturally and let the shoulders relax.",
        detail: "Eyes ahead, jaw soft.",
      },
      {
        text: "After 6 minutes, slow to a stroll for the final minute.",
        detail: "Let the breath settle.",
      },
    ],
  },
  {
    id: "gentle-strength",
    title: "Gentle strength",
    tagline: "Bodyweight moves to build resilience around the bones.",
    durationMin: 8,
    equipment: "A chair",
    intent:
      "Muscle pulls on bone, and bone responds by getting stronger. These small reps add up.",
    icon: "zap",
    accent: "xpGold",
    steps: [
      {
        text: "Sit-to-stand: from a chair, stand up and sit down 8 times slowly.",
        detail: "Use the arms only if you need to.",
      },
      {
        text: "Wall press-ups: hands on a wall, slow press for 8 reps.",
        detail: "Feet a comfortable distance from the wall.",
      },
      {
        text: "Heel raises: holding the chair, lift onto your toes 12 times.",
        detail: "Lower with control.",
      },
      {
        text: "Repeat the whole sequence one more time.",
        detail: "Take a slow breath between exercises.",
      },
    ],
  },
  {
    id: "joint-mobility",
    title: "Joint mobility flow",
    tagline: "Loosen stiff joints with gentle movement.",
    durationMin: 6,
    equipment: "Just you",
    intent:
      "Mobile joints take strain off bones and make daily movement easier. Calm and unhurried.",
    icon: "wind",
    accent: "primary",
    steps: [
      {
        text: "Roll the shoulders backwards 8 times, then forwards 8 times.",
        detail: "Slow and full circles.",
      },
      {
        text: "Turn your head gently left, then right, 5 times each way.",
        detail: "Small range — never forced.",
      },
      {
        text: "Hands on hips, circle the hips slowly 5 times each way.",
        detail: "Like stirring a small pot.",
      },
      {
        text: "Lift onto your toes and back down 10 times.",
        detail: "Use a wall for balance if needed.",
      },
      {
        text: "Finish with three slow, full breaths.",
        detail: "In through the nose, out through the mouth.",
      },
    ],
  },
];

export function findRoutine(id: string | undefined | null): MovementRoutine | null {
  if (!id) return null;
  return MOVEMENT_ROUTINES.find((r) => r.id === id) ?? null;
}
