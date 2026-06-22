/**
 * SNAP Foundations — lesson content and progress persistence.
 *
 * Nine sequential lessons across nine healthy-ageing pathways.
 * Voice: warm, intelligent, body-present, hope-forward. The same register
 * as the Breathing Studio — calm and reassuring, never clinical or preachy.
 *
 * Sources of inspiration: IOF, Royal Osteoporosis Society, NHS/NICE guidance,
 * Dr McCormick's "Great Bones", behavioural science, longevity research.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface LessonSection {
  heading: string;
  body: string;
}

export type LessonAccent = "primary" | "accent" | "success" | "xpGold";

export interface Lesson {
  id: string;
  /** 1-based position in the sequence. */
  index: number;
  /** Thematic grouping — shown as a label above the node. */
  pathway: string;
  title: string;
  tagline: string;
  /** Feather icon name. */
  icon: string;
  accent: LessonAccent;
  xpReward: number;
  /** Displayed reading-time estimate. */
  duration: string;
  /** One practical action the user can take today. */
  keyAction: string;
  /** Bone Buddy's warm celebration message shown on completion. */
  completionMessage: string;
  sections: LessonSection[];
  ctaLabel: string;
  ctaRoute: string;
}

export const LESSONS: Lesson[] = [
  // ── 1 ─────────────────────────────────────────────────────────────────────
  {
    id: "lesson-1",
    index: 1,
    pathway: "Understanding Bone Health",
    title: "Your bones are living tissue",
    tagline: "The foundation everything else is built on",
    icon: "zap",
    accent: "primary",
    xpReward: 75,
    duration: "6 min",
    keyAction:
      "Take a moment to note when you last had a DEXA scan — or speak to your GP about arranging one. Knowing your baseline is step one.",
    completionMessage:
      "You now understand something most people never stop to think about. Your bones are alive, responsive, and ready to be supported. That knowledge is yours to keep.",
    sections: [
      {
        heading: "A living, renewing framework",
        body: "Your skeleton is not the fixed structure it might seem. Every single day, specialised cells called osteoclasts quietly dissolve old bone, while osteoblasts lay down fresh tissue in its place. This process — bone remodelling — never stops. It is one of the most remarkable things your body does, and it happens completely without your awareness.",
      },
      {
        heading: "Peak bone mass — your biggest asset",
        body: "Bone is built fastest during childhood and your twenties. By your early thirties, most people reach their peak bone mass — the highest density your skeleton will ever have. Think of this like a savings account: the more you put in early, the more you have to draw from later. But here is the good news: at any age, the choices you make today affect how well your bones age from this point forward.",
      },
      {
        heading: "Why bone loss happens — and what it is not",
        body: "From your mid-thirties, the balance of remodelling begins to shift slightly — building slows relative to breakdown. This is entirely natural, not a failure. Factors like oestrogen levels, activity, nutrition, sleep, and stress all influence the rate of change. Genetics play a role, but lifestyle shapes the outcome more than most people realise. You have more influence than you might think.",
      },
      {
        heading: "Your numbers are a starting point, not a verdict",
        body: "A DEXA scan measures bone mineral density at your spine and hips, producing a T-score. That number tells you where you are today — nothing more. It is not a prediction, not a sentence, and not a reason to worry. It is information. The most empowering thing you can do with it is log it in SNAP and watch how your habits move it over time.",
      },
    ],
    ctaLabel: "View my bone tracker",
    ctaRoute: "/health/bone-tracker",
  },

  // ── 2 ─────────────────────────────────────────────────────────────────────
  {
    id: "lesson-2",
    index: 2,
    pathway: "Muscle + Movement",
    title: "Muscle — your skeleton's closest ally",
    tagline: "Why strength is one of the greatest protectors of healthy ageing",
    icon: "trending-up",
    accent: "success",
    xpReward: 75,
    duration: "5 min",
    keyAction:
      "Try one of SNAP's beginner movement sessions today. Even five minutes of weight-bearing movement sends the right signals to your bones.",
    completionMessage:
      "Every time you move with intention, you are investing in both your muscles and your bones. They work as a team — and so do you.",
    sections: [
      {
        heading: "Muscle is bone's best friend",
        body: "When a muscle contracts, it pulls on the bone it is attached to. That tension is not stress — it is a signal. A signal that says: be strong here. Bones respond by maintaining or increasing density at exactly those points. This is why weight-bearing movement is so powerful: it speaks directly to your skeleton in the language it understands.",
      },
      {
        heading: "Grip strength — the quiet longevity signal",
        body: "Research from the UK Biobank and other large studies consistently finds that grip strength is one of the strongest predictors of how well we age. It is a proxy for overall muscle health, coordination, and bone resilience. The good news: grip strength responds beautifully to regular activity. It is not something you either have or you don't — it is something you build.",
      },
      {
        heading: "Balance is a skill, not a given",
        body: "Falls are not inevitable, and the fear of them does not have to shrink your world. Balance is a trainable skill. Simple practices — standing on one leg while waiting for the kettle, mindful walking, gentle yoga — build the proprioceptive awareness that keeps you steady. SNAP's movement sessions include balance-focused routines you can begin at home, at any fitness level.",
      },
      {
        heading: "Resistance and recovery — both matter",
        body: "Weight-bearing activity — walking, dancing, climbing stairs, body-weight exercises — signals bones to maintain density. Resistance training adds another layer, building the muscle strength that protects your skeleton. But recovery matters just as much as effort. Rest is where your body actually makes the changes. Movement and calm, together, are the full picture.",
      },
    ],
    ctaLabel: "Browse movement sessions",
    ctaRoute: "/movement",
  },

  // ── 3 ─────────────────────────────────────────────────────────────────────
  {
    id: "lesson-3",
    index: 3,
    pathway: "Nutrition",
    title: "Nourish your bones, nourish yourself",
    tagline: "The nutrients that build lifelong strength",
    icon: "coffee",
    accent: "accent",
    xpReward: 75,
    duration: "7 min",
    keyAction:
      "Open your meal plan and try one calcium-rich food today that is not from dairy. Kale, tinned sardines, or a handful of almonds are a great start.",
    completionMessage:
      "Every meal is an opportunity — not a test. You don't need to be perfect, just consistent and curious. Your bones notice every nourishing choice.",
    sections: [
      {
        heading: "Calcium — the full story",
        body: "Calcium gives bone its density and hardness. Around 99% of the calcium in your body lives in your bones and teeth — the remaining 1% is doing vital work in your blood, nerves, and muscles. When your diet runs low, your body draws calcium from your skeleton to keep everything else running. Most adults need 1,000–1,200 mg per day but typically get around 700 mg. Dairy is well known, but calcium is also found in kale, pak choi, tinned fish with bones, tofu, sesame seeds, almonds, and fortified plant milks.",
      },
      {
        heading: "Vitamin D, K2 and the partnership principle",
        body: "Calcium cannot be effectively absorbed and used by the body without vitamin D - they work together as essential partners in bone health. Vitamin D helps your body absorb calcium from food and supplements, while vitamin K2 helps direct that calcium into bones and teeth, where it is needed most. Many people may struggle to maintain optimal vitamin D levels during periods of limited sun exposure, particularly during winter months, when spending more time indoors, or when living in regions with less year-round sunlight. For this reason, vitamin D supplementation is commonly recommended by healthcare professionals. Vitamin K2 is often overlooked, yet it plays an important role in supporting healthy calcium distribution within the body. Together, calcium, vitamin D and vitamin K2 form a powerful partnership that supports bone strength, mobility and healthy ageing. This is why SNAP considers these nutrients together, helping you build a more complete picture of your bone health rather than focusing on individual nutrients in isolation.",
      },
      {
        heading: "Protein — the forgotten bone builder",
        body: "Bone is not only mineral — about a third of it is collagen, a protein scaffold that gives it flexibility and fracture resistance. Adequate protein supports both muscle and bone. Most older adults are under-eating protein. Aim for a palm-sized portion of quality protein at each meal — eggs, fish, chicken, legumes, tofu, Greek yoghurt. This single habit makes a measurable difference to muscle mass, bone density, and recovery.",
      },
      {
        heading: "Eating patterns that support healthy ageing",
        body: "Chronic inflammation quietly accelerates bone breakdown. The Mediterranean pattern — rich in oily fish, olive oil, colourful vegetables, nuts, and legumes — is the most evidence-backed eating approach for musculoskeletal health and longevity. Ultra-processed foods, excess alcohol, and high-sugar diets all work against bone. You don't need a perfect diet — just a nourishing one, most of the time.",
      },
    ],
    ctaLabel: "Open my meal plan",
    ctaRoute: "/health/meal-plan",
  },

  // ── 4 ─────────────────────────────────────────────────────────────────────
  {
    id: "lesson-4",
    index: 4,
    pathway: "Hormonal Health",
    title: "Hormones, midlife and your bones",
    tagline: "Understanding change — and what you can do with it",
    icon: "activity",
    accent: "primary",
    xpReward: 75,
    duration: "6 min",
    keyAction:
      "Ask Bone Buddy one question about hormonal health and your bones today. Whatever is on your mind — there are no wrong questions.",
    completionMessage:
      "Hormonal shifts are natural. Understanding them doesn't mean accepting decline — it means making informed choices. You have more influence here than you might feel right now.",
    sections: [
      {
        heading: "Oestrogen and bone — an intimate connection",
        body: "Oestrogen plays a central role in bone remodelling by slowing the activity of osteoclasts — the cells that break bone down. When oestrogen levels decline, that braking effect reduces. Bone breakdown can outpace building for a period. This is why the perimenopausal years and the first years after menopause are a particularly significant window for bone health. The good news: this window is also when lifestyle has the greatest impact.",
      },
      {
        heading: "The perimenopause window",
        body: "Perimenopause — the transition phase before periods stop — can begin years earlier than most women expect, sometimes in the early forties. During this time, oestrogen fluctuates unpredictably. Sleep often suffers. Muscle mass begins to change. Bone density can shift more quickly than at other life stages. Recognising this window — and responding to it with nourishment, movement, and rest — is one of the most impactful things you can do for your long-term skeletal health.",
      },
      {
        heading: "It is not only about women",
        body: "Testosterone plays a similar structural role in bone health for men, and levels decline gradually from the thirties onward. Men are significantly under-screened for osteoporosis despite representing around a quarter of hip fracture cases. Hormonal health matters across all genders — and the same principles apply: nourishment, movement, sleep, and stress management are the foundations for everyone.",
      },
      {
        heading: "You have more choices than you think",
        body: "HRT, when appropriate and prescribed by a specialist, can be highly effective at protecting bone density during and after menopause. But it is one option among many. Resistance training, protein intake, vitamin D, and sleep quality all have significant independent effects on bone. Your GP or a menopause specialist can help you understand what is right for your situation. SNAP's Bone Buddy can help you prepare questions before that conversation.",
      },
    ],
    ctaLabel: "Ask Bone Buddy",
    ctaRoute: "/(tabs)/coach",
  },

  // ── 5 ─────────────────────────────────────────────────────────────────────
  {
    id: "lesson-5",
    index: 5,
    pathway: "Stress + Sleep",
    title: "Calm is strength",
    tagline: "How rest and recovery build the bones you live in",
    icon: "moon",
    accent: "primary",
    xpReward: 75,
    duration: "5 min",
    keyAction:
      "Try a breathing session in the Breathing Studio — even the Calm option, just a few minutes. Notice how your body feels after.",
    completionMessage:
      "Rest is not the opposite of strength. It is where strength is built. Every calm moment you create is working for you, not away from you.",
    sections: [
      {
        heading: "How stress reaches your skeleton",
        body: "When you are under sustained pressure, your body produces cortisol — the primary stress hormone. In small, short bursts, cortisol is useful. But chronically elevated cortisol increases the activity of osteoclasts (bone-breaking cells) and reduces the activity of osteoblasts (bone-building cells). It also interferes with calcium absorption and muscle recovery. Stress is not just something you feel — it is something your body physically responds to, right down to bone level.",
      },
      {
        heading: "Sleep — the silent bone builder",
        body: "During deep sleep, growth hormone is released, osteoblasts are most active, and the body does its most significant repair and rebuilding work. Studies consistently link poor sleep quality and short sleep duration with lower bone density over time. Getting 7–9 hours is not indulgent — it is structural maintenance. The quality of your sleep may be one of the most underrated levers for healthy ageing.",
      },
      {
        heading: "Your nervous system is on your side",
        body: "The parasympathetic nervous system — the rest-and-digest state — is the counterbalance to stress. When it is active, cortisol drops, digestion improves, inflammation eases, and the body has the resources to repair. You can deliberately activate this system. Slow breathing — longer exhale than inhale — is one of the most direct ways. Five minutes of calm breathing before sleep, after a difficult moment, or at the start of your day genuinely shifts your physiology.",
      },
      {
        heading: "Small rituals, lasting effects",
        body: "You don't need a dedicated wellness programme to benefit from nervous system regulation. A few conscious breaths before a meal. A short walk without your phone. Reading instead of scrolling before bed. These are not minor habits — over weeks and months, they change the hormonal environment in which your bones exist. SNAP's Breathing Studio is designed to make this effortless to begin.",
      },
    ],
    ctaLabel: "Open Breathing Studio",
    ctaRoute: "/breathing-studio",
  },

  // ── 6 ─────────────────────────────────────────────────────────────────────
  {
    id: "lesson-6",
    index: 6,
    pathway: "Longevity",
    title: "Age with strength and freedom",
    tagline: "Healthy ageing is trainable — this is what it looks like",
    icon: "sun",
    accent: "xpGold",
    xpReward: 75,
    duration: "5 min",
    keyAction:
      "Identify one daily movement habit you can add this week — a walk after dinner, using the stairs, a five-minute morning stretch. One habit, starting today.",
    completionMessage:
      "Healthy ageing is not something that happens to you. It is something you build, one day at a time. You are already doing it.",
    sections: [
      {
        heading: "What longevity really means",
        body: "Longevity is not just about living longer — it is about living well for longer. The emerging science of healthspan focuses on maintaining physical function, cognitive sharpness, emotional wellbeing, and independence into later decades. Bone and muscle health are at the very centre of this picture. Your skeleton is your structural freedom. When it is strong, everything else becomes possible.",
      },
      {
        heading: "Independence is a practice",
        body: "The ability to carry your own shopping, walk without assistance, get up from the floor, travel with confidence — these capacities are not fixed. They are outcomes of the habits you build over years. Research from the MacArthur Foundation study on successful ageing found that lifestyle factors — especially physical activity — were stronger predictors of healthy ageing than genetics. You are training your future self every day, even when it doesn't feel like it.",
      },
      {
        heading: "The habits that compound across decades",
        body: "Small, consistent actions have a compounding effect that is difficult to perceive in the short term but profound over years. A 20-minute walk three times a week. A protein-rich breakfast. Eight hours of sleep. Five minutes of calm breathing. These are not sacrifices — they are investments. The evidence from longitudinal studies is clear: the people who age with the most vitality are not those who exercised intensely in their thirties. They are those who moved consistently across their whole lives.",
      },
      {
        heading: "Sunlight, vitamin D and seasonal awareness",
        body: "Sunlight plays an important role in both bone health and overall wellbeing. When ultraviolet B (UVB) rays reach the skin, the body can produce vitamin D naturally, helping support calcium absorption, bone strength and healthy ageing. Regular exposure to natural daylight may also help support circadian rhythms, mood, sleep quality and general wellbeing. Spending time outdoors, particularly during daylight hours, can provide benefits that extend beyond vitamin D alone. Vitamin D production varies depending on factors such as season, geographic location, skin tone, age, clothing coverage, sunscreen use and time spent outdoors. During winter months, in regions with limited sunlight, or for people who spend most of their time indoors, maintaining optimal vitamin D levels can be more challenging. When spending time in the sun, it is important to balance the benefits of natural light with appropriate skin protection. Many people choose to use protective clothing, hats, shade or mineral-based sun protection when needed, particularly during periods of strong UV exposure. Understanding how sunlight, nutrition and supplementation work together can help support bone health, mobility, resilience and healthy ageing throughout the year.",
      },
    ],
    ctaLabel: "Browse movement sessions",
    ctaRoute: "/movement",
  },

  // ── 7 ─────────────────────────────────────────────────────────────────────
  {
    id: "lesson-7",
    index: 7,
    pathway: "Confidence + Mindset",
    title: "Confidence starts in the body",
    tagline: "How to rebuild your relationship with movement and health",
    icon: "heart",
    accent: "accent",
    xpReward: 75,
    duration: "5 min",
    keyAction:
      "Reflect on one thing that felt harder before you started this journey — and notice how far you have already come. That change is real.",
    completionMessage:
      "Confidence is not something you wait to feel — it is something you build, one small action at a time. Look at what you have already done.",
    sections: [
      {
        heading: "The fear of falling — and moving through it",
        body: "Fear of falling is one of the most common and understandable responses to a bone health diagnosis. And yet the fear itself can become the greater risk — when it leads to reduced activity, which in turn reduces muscle strength and balance. The path through this is not bravery. It is gentle, supported movement that rebuilds both physical confidence and trust in your body. SNAP's movement sessions are designed with exactly this in mind.",
      },
      {
        heading: "Identity after a diagnosis",
        body: "Receiving a bone health diagnosis can shift how you see yourself. You might feel fragile, or suddenly aware of your body in ways that feel unfamiliar. This is an entirely normal response. But here is something worth holding: a diagnosis is not an identity. It is information. And information is power. The people who navigate bone health most successfully are not those who were never diagnosed — they are those who used the information to make changes.",
      },
      {
        heading: "Progress over perfection — always",
        body: "Behavioural science is unambiguous on this point: perfectionism is the enemy of habit. The people who make lasting health changes are not the ones who start with the most discipline — they are the ones who are most forgiving of themselves when they miss a day, restart without guilt, and focus on the direction of travel rather than the destination. One missed walk does not undo a week of consistent movement. SNAP is built around celebrating what you do, not marking what you didn't.",
      },
      {
        heading: "Building a sustainable relationship with your health",
        body: "The goal is not a six-week programme. It is a way of living that fits into your real life — with its pressures, its off days, and its seasons. Small, enjoyable routines tend to stick far longer than dramatic overhauls. Find the movement you enjoy. Find the meals that nourish and satisfy. Find the moments of calm that feel natural. Then let SNAP help you notice the patterns and celebrate the progress.",
      },
    ],
    ctaLabel: "Explore Wellness Hub",
    ctaRoute: "/(tabs)/wellness",
  },

  // ── 8 ─────────────────────────────────────────────────────────────────────
  {
    id: "lesson-8",
    index: 8,
    pathway: "Daily Practice",
    title: "Your daily foundations",
    tagline: "A rhythm, not a routine — and you have already begun",
    icon: "bar-chart-2",
    accent: "xpGold",
    xpReward: 125,
    duration: "5 min",
    keyAction:
      "Open your SNAP Shot and take a moment to acknowledge one thing from this week — however small. Every step is part of the story.",
    completionMessage:
      "You have completed another SNAP Foundation. What you are building here - understanding, habits, courage, curiosity - is becoming part of your daily rhythm.",
    sections: [
      {
        heading: "A rhythm, not a routine",
        body: "The word 'routine' can feel rigid — something to perform and then feel guilty about breaking. A rhythm is something different. It has space in it. It bends with your life without disappearing. Think of SNAP not as a programme with a start and end date, but as a daily companion that helps you stay in rhythm with the things that matter: movement, nourishment, rest, reflection.",
      },
      {
        heading: "What your data is really telling you",
        body: "The numbers in SNAP — T-scores, calcium intake, session counts, streak days — are not judgements. They are a mirror. They show you patterns you would never notice otherwise: that you sleep better on the weeks you move more, that your nutrition is best mid-week, that your mood is higher after a breathing session. Over time, this data becomes a deeply personal picture of how your lifestyle and your wellbeing connect.",
      },
      {
        heading: "Your weekly SNAP Shot",
        body: "Every week, SNAP compiles a gentle summary of how you have been doing — across movement, nutrition, breathing, and reflection. The SNAP Shot is designed to celebrate consistency rather than perfection. It surfaces patterns, acknowledges your effort, and helps you notice the direction you are moving in. Even the weeks where not much felt possible count — because showing up in any form is still showing up.",
      },
      {
        heading: "You have built something real",
        body: "By working through these nine lessons, you have laid a foundation that most people never build. You understand how your bones work. You know which habits protect them. You have connected with tools — movement, breathing, nutrition, reflection — that will serve you for years. Bone Buddy is here whenever you have a question, a doubt, or just want to understand something more deeply. This is not the end of your SNAP journey. It is where it truly begins.",
      },
    ],
    ctaLabel: "View my insights",
    ctaRoute: "/insights",
  },

  // ── 9 ─────────────────────────────────────────────────────────────────────
  {
    id: "lesson-9",
    index: 9,
    pathway: "Supplements & Routine",
    title: "Supplements, medications and your daily intake",
    tagline: "There is no single right path — only the one that works for you",
    icon: "layers",
    accent: "accent",
    xpReward: 75,
    duration: "6 min",
    keyAction:
      "Open Today's Intake and add one supplement or medication you take regularly. One item logged today is a habit started.",
    completionMessage:
      "You now understand not just what you take, but why — and how to track it in a way that actually supports your journey. That clarity is worth more than any perfect streak.",
    sections: [
      {
        heading: "Your path, your choices",
        body: "There are many ways to support bone health, and no single approach is right for everyone. Some people manage their bone health entirely through lifestyle — nourishment, movement, sleep, stress management, and targeted supplements. Others are prescribed medication by their GP or specialist, and incorporate that alongside a healthy lifestyle. Many people do both. All of these approaches are valid. What matters is that you understand what you are doing, feel confident doing it, and can track it consistently enough to notice patterns over time.",
      },
      {
        heading: "Supplements and medications — what they each do",
        body: "Supplements are nutritional support taken to fill gaps in your diet or boost specific nutrients. The most relevant for bone health are vitamin D3, calcium when dietary intake falls short, magnesium, vitamin K2, collagen or protein supplements where appropriate, and omega-3 fatty acids. Medications, when prescribed, work at a more clinical level - bisphosphonates like alendronic acid slow bone breakdown; denosumab has a similar effect via a different mechanism; HRT replaces declining oestrogen and can be highly protective during and after menopause. These are not competing approaches. They are different tools for different circumstances. Your clinician is the right person to discuss which apply to your situation.",
      },
      {
        heading: "Reading the label: a plain guide to units",
        body: "One of the most common sources of confusion around supplements and medications is the abbreviations on the label. mg means milligrams — a thousandth of a gram. Most mineral supplements, including calcium and magnesium, are measured in mg. mcg means micrograms — a thousandth of a milligram. Vitamin K2 and some B vitamins typically use mcg. IU means International Units — a different way of measuring biological activity, used for fat-soluble vitamins like D3. g means grams, used for larger quantities such as protein powders or collagen. Your prescription will always state the exact dose and unit. If you are ever uncertain about what you are taking or why, your pharmacist is an excellent — and often underused — resource.",
      },
      {
        heading: "How SNAP helps you track your routine",
        body: "SNAP's Today's Intake tracker is built to make daily logging effortless. You can add any supplement or medication in a few taps: choose whether it is a supplement or prescribed medication, search for it or add it by name, enter the dose and unit, set how often you take it, and optionally note the time of day. Once set up, marking it as taken takes a single tap. Over time, this creates a clear, personal picture of your routine — not a medical record, and not a clinical diagnosis, but a genuine awareness of what you are doing and how consistently you are doing it. That consistency, built up day by day, feeds into your Bone Health Tracker and helps SNAP offer you more relevant encouragement and insights.",
      },
    ],
    ctaLabel: "Open Today's Intake",
    ctaRoute: "/health/supplements",
  },
];

// ── Persistence ───────────────────────────────────────────────────────────────

export function learnProgressKey(userId: string | null): string {
  return `snap_learn_progress:${userId ?? "anon"}`;
}

export function learnPromptPrefKey(userId: string | null): string {
  return `snap_learn_prompt_pref:${userId ?? "anon"}`;
}

export interface LearnProgress {
  completedIds: string[];
  /** ISO timestamp of first completion — marks the journey as "activated". */
  activatedAt?: string;
}

export const EMPTY_PROGRESS: LearnProgress = { completedIds: [] };

export async function loadLearnProgress(
  userId: string | null,
): Promise<LearnProgress> {
  try {
    const raw = await AsyncStorage.getItem(learnProgressKey(userId));
    if (!raw) return EMPTY_PROGRESS;
    return JSON.parse(raw) as LearnProgress;
  } catch {
    return EMPTY_PROGRESS;
  }
}

export async function saveLearnProgress(
  userId: string | null,
  progress: LearnProgress,
): Promise<void> {
  try {
    await AsyncStorage.setItem(learnProgressKey(userId), JSON.stringify(progress));
  } catch {}
}

export async function markLessonComplete(
  userId: string | null,
  lessonId: string,
): Promise<LearnProgress> {
  const current = await loadLearnProgress(userId);
  if (current.completedIds.includes(lessonId)) return current;
  const updated: LearnProgress = {
    completedIds: [...current.completedIds, lessonId],
    activatedAt: current.activatedAt ?? new Date().toISOString(),
  };
  await saveLearnProgress(userId, updated);
  return updated;
}

/** Activated = user has completed at least one lesson. */
export async function isLearnActivated(userId: string | null): Promise<boolean> {
  const progress = await loadLearnProgress(userId);
  return !!progress.activatedAt || progress.completedIds.length > 0;
}

export async function loadPromptPreference(
  userId: string | null,
): Promise<"on" | "off"> {
  try {
    const raw = await AsyncStorage.getItem(learnPromptPrefKey(userId));
    return raw === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}

export async function setPromptPreference(
  userId: string | null,
  pref: "on" | "off",
): Promise<void> {
  try {
    await AsyncStorage.setItem(learnPromptPrefKey(userId), pref);
  } catch {}
}

/**
 * Returns the set of lesson IDs that are currently unlocked.
 * Lesson 1 is always unlocked; each subsequent lesson unlocks when the
 * previous one is completed.
 */
export function unlockedLessonIds(completedIds: string[]): Set<string> {
  const unlocked = new Set<string>();
  for (let i = 0; i < LESSONS.length; i++) {
    if (i === 0) {
      unlocked.add(LESSONS[i].id);
    } else if (completedIds.includes(LESSONS[i - 1].id)) {
      unlocked.add(LESSONS[i].id);
    }
  }
  return unlocked;
}

/** Total XP available across all lessons. */
export const TOTAL_LEARN_XP = LESSONS.reduce((s, l) => s + l.xpReward, 0);
