/**
 * Curated bone-friendly recipe library and "How to" guides for the SNAP Life
 * Meal Plan & Nutrition section.
 *
 * Every recipe is intentionally simple (5–7 steps, 5–25 minutes) and is
 * tagged with the bone-supporting nutrients it leans into so the personalised
 * plan engine can pick balanced days that hit calcium / vitamin D / protein
 * targets without overwhelming the user with macros.
 *
 * Nutrient figures are typical-portion estimates suitable for guidance only —
 * not medical advice and not intended for clinical tracking.
 */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface Recipe {
  id: string;
  name: string;
  mealType: MealType;
  prepMins: number;
  calories: number;
  /** mg */
  calcium: number;
  /** IU */
  vitD: number;
  /** g */
  protein: number;
  /** mg */
  magnesium: number;
  highlight: string;
  ingredients: string[];
  steps: string[];
  tags: string[];
  vegetarian: boolean;
  dairyFree: boolean;
  /**
   * True if the recipe is gluten-free (or trivially made gluten-free with
   * a swap the user would make anyway, e.g. using gluten-free oats, tamari
   * instead of soy sauce, or rice instead of wheat-based bread/wrap).
   * Recipes built around bread, wraps, rye or wheat-based pasta are false.
   */
  glutenFree: boolean;
}

export interface Guide {
  id: string;
  title: string;
  summary: string;
  readMins: number;
  intro: string;
  sections: { heading: string; body: string; bullets?: string[] }[];
  closing: string;
}

// ---- Recipes ---------------------------------------------------------------

export const RECIPES: Recipe[] = [
  // BREAKFAST
  {
    id: "b1",
    name: "Greek Yogurt & Almond Parfait",
    mealType: "breakfast",
    prepMins: 5,
    calories: 340,
    calcium: 350,
    vitD: 60,
    protein: 22,
    magnesium: 60,
    highlight: "High in calcium and protein — supports bone density first thing.",
    ingredients: [
      "200g full-fat Greek yogurt",
      "1 tbsp almond butter",
      "Handful of fresh berries",
      "1 tbsp flaked almonds",
      "1 tsp honey (optional)",
    ],
    steps: [
      "Spoon the Greek yogurt into a bowl or jar.",
      "Swirl through the almond butter.",
      "Top with berries and flaked almonds.",
      "Drizzle with honey if you like a touch of sweetness.",
    ],
    tags: ["High Calcium", "High Protein"],
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
  },
  {
    id: "b2",
    name: "Fortified Oat Porridge with Seeds",
    mealType: "breakfast",
    prepMins: 8,
    calories: 380,
    calcium: 320,
    vitD: 100,
    protein: 14,
    magnesium: 110,
    highlight: "Fortified plant milk delivers calcium and vitamin D in one bowl.",
    ingredients: [
      "50g rolled oats",
      "300ml fortified plant milk (oat, soya, or almond)",
      "1 tbsp chia seeds",
      "1 tbsp pumpkin seeds",
      "1 small banana, sliced",
    ],
    steps: [
      "Combine oats and fortified milk in a small saucepan.",
      "Bring to a gentle simmer, stirring for 4 minutes until creamy.",
      "Stir in the chia seeds.",
      "Pour into a bowl and top with pumpkin seeds and banana.",
    ],
    tags: ["Fortified", "Magnesium"],
    vegetarian: true,
    dairyFree: true,
    // Made gluten-free by using certified gluten-free rolled oats (widely
    // available; pure oats are naturally gluten-free).
    glutenFree: true,
  },
  {
    id: "b3",
    name: "Smoked Salmon & Egg on Rye",
    mealType: "breakfast",
    prepMins: 10,
    calories: 420,
    calcium: 140,
    vitD: 480,
    protein: 28,
    magnesium: 50,
    highlight: "Smoked salmon is one of the richest natural sources of vitamin D.",
    ingredients: [
      "2 slices rye bread",
      "60g smoked salmon",
      "2 eggs",
      "1 tsp butter or olive oil",
      "Squeeze of lemon, black pepper",
    ],
    steps: [
      "Toast the rye bread.",
      "Crack the eggs into a non-stick pan with the butter or oil.",
      "Scramble gently over a low heat for 2–3 minutes.",
      "Pile the eggs onto the toast, top with smoked salmon.",
      "Finish with lemon and a grind of black pepper.",
    ],
    tags: ["Vitamin D", "Omega-3"],
    vegetarian: false,
    dairyFree: false,
    // Built around rye bread.
    glutenFree: false,
  },
  {
    id: "b4",
    name: "Tofu Scramble with Spinach",
    mealType: "breakfast",
    prepMins: 12,
    calories: 360,
    calcium: 380,
    vitD: 40,
    protein: 24,
    magnesium: 90,
    highlight: "Calcium-set tofu and dark greens — a plant-based bone boost.",
    ingredients: [
      "200g firm calcium-set tofu",
      "1 large handful baby spinach",
      "1 tsp turmeric",
      "1 tbsp olive oil",
      "1 slice sourdough toast",
      "Salt and pepper",
    ],
    steps: [
      "Crumble the tofu into a bowl with the turmeric and a pinch of salt.",
      "Warm the olive oil in a non-stick pan.",
      "Add the tofu and cook for 4 minutes, stirring.",
      "Wilt the spinach through for 1 minute.",
      "Serve on the sourdough toast.",
    ],
    tags: ["Plant-Based", "High Calcium"],
    vegetarian: true,
    dairyFree: true,
    // Built around sourdough toast.
    glutenFree: false,
  },

  // LUNCH
  {
    id: "l1",
    name: "Sardine Toast with Avocado",
    mealType: "lunch",
    prepMins: 8,
    calories: 480,
    calcium: 350,
    vitD: 270,
    protein: 30,
    magnesium: 80,
    highlight: "Tinned sardines bring calcium, vitamin D and omega-3 in one go.",
    ingredients: [
      "1 tin sardines in olive oil (drained)",
      "2 slices wholemeal sourdough",
      "1 small ripe avocado",
      "Squeeze of lemon",
      "Chilli flakes, black pepper",
    ],
    steps: [
      "Toast the sourdough.",
      "Mash the avocado with lemon and a pinch of salt.",
      "Spread the avocado over the toast.",
      "Lay the sardines on top.",
      "Finish with chilli flakes and pepper.",
    ],
    tags: ["Vitamin D", "Calcium", "Omega-3"],
    vegetarian: false,
    dairyFree: true,
    // Built around sourdough toast.
    glutenFree: false,
  },
  {
    id: "l2",
    name: "Lentil & Kale Soup",
    mealType: "lunch",
    prepMins: 25,
    calories: 350,
    calcium: 180,
    vitD: 0,
    protein: 18,
    magnesium: 90,
    highlight: "Plant protein and dark leafy greens — a quiet bone hero.",
    ingredients: [
      "1 onion, diced",
      "2 garlic cloves, sliced",
      "200g red lentils",
      "1L vegetable stock",
      "2 large handfuls chopped kale",
      "1 tbsp olive oil, salt, pepper",
    ],
    steps: [
      "Soften the onion and garlic in the olive oil for 5 minutes.",
      "Add the lentils and stock, simmer 15 minutes.",
      "Stir in the kale and cook 3 more minutes.",
      "Season and serve.",
    ],
    tags: ["Plant-Based", "Iron", "Magnesium"],
    vegetarian: true,
    dairyFree: true,
    // Lentils, vegetables, gluten-free stock — naturally gluten-free.
    glutenFree: true,
  },
  {
    id: "l3",
    name: "Chicken & Quinoa Power Bowl",
    mealType: "lunch",
    prepMins: 20,
    calories: 520,
    calcium: 130,
    vitD: 30,
    protein: 42,
    magnesium: 95,
    highlight: "Lean protein and complete-grain quinoa for muscle and bone.",
    ingredients: [
      "150g cooked chicken breast",
      "100g cooked quinoa",
      "Handful rocket and baby spinach",
      "1/4 cucumber, sliced",
      "1 tbsp tahini",
      "1 tsp lemon juice, olive oil",
    ],
    steps: [
      "Layer the quinoa, leaves and cucumber in a bowl.",
      "Slice the chicken and place on top.",
      "Whisk the tahini with lemon juice and 2 tsp water.",
      "Drizzle the dressing over the bowl and finish with olive oil.",
    ],
    tags: ["High Protein", "Complete Protein"],
    vegetarian: false,
    dairyFree: true,
    // Quinoa is naturally gluten-free.
    glutenFree: true,
  },
  {
    id: "l4",
    name: "Cottage Cheese & Roasted Veg Wrap",
    mealType: "lunch",
    prepMins: 12,
    calories: 460,
    calcium: 280,
    vitD: 60,
    protein: 26,
    magnesium: 50,
    highlight: "Cottage cheese is the under-rated calcium-protein combo.",
    ingredients: [
      "1 large wholemeal wrap",
      "150g cottage cheese",
      "100g roasted peppers (jar)",
      "Handful baby spinach",
      "1 tsp pesto, black pepper",
    ],
    steps: [
      "Spread the cottage cheese over the wrap.",
      "Layer with spinach and peppers.",
      "Spoon over the pesto and grind on pepper.",
      "Roll tightly and slice in half.",
    ],
    tags: ["High Protein", "Calcium"],
    vegetarian: true,
    dairyFree: false,
    // Built around a wholemeal wheat wrap.
    glutenFree: false,
  },

  // DINNER
  {
    id: "d1",
    name: "Baked Mackerel with Sweet Potato",
    mealType: "dinner",
    prepMins: 25,
    calories: 540,
    calcium: 130,
    vitD: 380,
    protein: 38,
    magnesium: 110,
    highlight: "Oily fish for vitamin D and omega-3 in one tray.",
    ingredients: [
      "2 mackerel fillets",
      "1 large sweet potato, cubed",
      "1 tbsp olive oil",
      "1 tsp smoked paprika",
      "Lemon wedges, parsley",
    ],
    steps: [
      "Heat the oven to 200°C / 180°C fan.",
      "Toss the sweet potato with oil and paprika; roast 15 minutes.",
      "Add the mackerel to the tray and roast a further 10 minutes.",
      "Serve with lemon and parsley.",
    ],
    tags: ["Vitamin D", "Omega-3"],
    vegetarian: false,
    dairyFree: true,
    glutenFree: true,
  },
  {
    id: "d2",
    name: "Tofu Stir-fry with Bok Choy",
    mealType: "dinner",
    prepMins: 18,
    calories: 490,
    calcium: 420,
    vitD: 0,
    protein: 26,
    magnesium: 100,
    highlight: "Calcium-set tofu and bok choy — a calcium duo without dairy.",
    ingredients: [
      "200g firm calcium-set tofu, cubed",
      "2 bok choy, halved",
      "1 tbsp sesame oil",
      "1 tbsp tamari (gluten-free soy sauce)",
      "1 garlic clove, sliced",
      "1 tsp sesame seeds, cooked rice to serve",
    ],
    steps: [
      "Press the tofu briefly with kitchen paper to dry.",
      "Sear the tofu in sesame oil for 4 minutes until golden.",
      "Add the garlic and bok choy; stir-fry 3 minutes.",
      "Splash in the tamari and toss.",
      "Serve over rice and scatter with sesame seeds.",
    ],
    tags: ["Plant-Based", "High Calcium"],
    vegetarian: true,
    dairyFree: true,
    // Tamari (recipe's first option) is gluten-free; rice is gluten-free.
    glutenFree: true,
  },
  {
    id: "d3",
    name: "Chickpea & Spinach Curry",
    mealType: "dinner",
    prepMins: 22,
    calories: 510,
    calcium: 280,
    vitD: 0,
    protein: 20,
    magnesium: 130,
    highlight: "Spinach, chickpeas and seeds — a plant-rich magnesium hit.",
    ingredients: [
      "1 tin chickpeas, drained",
      "200g chopped spinach (fresh or frozen)",
      "1 tin chopped tomatoes",
      "1 onion, 2 garlic cloves",
      "1 tbsp curry paste, 1 tbsp olive oil",
      "Brown rice to serve",
    ],
    steps: [
      "Soften the onion and garlic in olive oil for 5 minutes.",
      "Stir in the curry paste (check it's gluten-free) for 1 minute.",
      "Add the tomatoes and chickpeas; simmer 10 minutes.",
      "Wilt the spinach through for 3 minutes.",
      "Serve over brown rice.",
    ],
    tags: ["Plant-Based", "Magnesium", "Calcium"],
    vegetarian: true,
    dairyFree: true,
    // Served with brown rice (the gluten-free option in the recipe).
    glutenFree: true,
  },
  {
    id: "d4",
    name: "Roast Salmon with Greens",
    mealType: "dinner",
    prepMins: 20,
    calories: 560,
    calcium: 200,
    vitD: 440,
    protein: 38,
    magnesium: 90,
    highlight: "Salmon and broccoli — a textbook bone-and-muscle dinner.",
    ingredients: [
      "1 salmon fillet (150g)",
      "1 small head broccoli",
      "Handful kale",
      "1 tbsp olive oil",
      "1 lemon, salt, pepper",
    ],
    steps: [
      "Heat the oven to 200°C / 180°C fan.",
      "Place the salmon on a tray, drizzle with oil and lemon.",
      "Roast for 12 minutes.",
      "Steam the broccoli and kale for 4 minutes.",
      "Plate everything with lemon wedges.",
    ],
    tags: ["Vitamin D", "Omega-3"],
    vegetarian: false,
    dairyFree: true,
    glutenFree: true,
  },

  // SNACKS
  {
    id: "s1",
    name: "Cheese & Walnut Bites",
    mealType: "snack",
    prepMins: 3,
    calories: 180,
    calcium: 220,
    vitD: 0,
    protein: 10,
    magnesium: 35,
    highlight: "Quick calcium pick-me-up between meals.",
    ingredients: [
      "30g mature cheddar, cubed",
      "Small handful walnuts",
      "A few apple slices",
    ],
    steps: [
      "Arrange the cheese, walnuts and apple on a small plate.",
      "Eat slowly with a glass of water.",
    ],
    tags: ["Calcium Boost"],
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
  },
  {
    id: "s2",
    name: "Edamame & Sesame",
    mealType: "snack",
    prepMins: 5,
    calories: 160,
    calcium: 100,
    vitD: 0,
    protein: 12,
    magnesium: 60,
    highlight: "Plant protein with a magnesium bonus.",
    ingredients: [
      "150g frozen edamame in pods",
      "Pinch of sea salt",
      "1 tsp sesame seeds",
    ],
    steps: [
      "Boil the edamame for 4 minutes.",
      "Drain and toss with salt and sesame seeds.",
    ],
    tags: ["Plant-Based", "Magnesium"],
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
  },
  {
    id: "s3",
    name: "Fortified Almond Latte & Figs",
    mealType: "snack",
    prepMins: 4,
    calories: 200,
    calcium: 320,
    vitD: 100,
    protein: 6,
    magnesium: 50,
    highlight: "Fortified plant milk turns a coffee break into a bone break.",
    ingredients: [
      "200ml fortified almond or oat milk",
      "1 shot espresso (or strong coffee)",
      "3 dried figs",
    ],
    steps: [
      "Warm the milk gently.",
      "Pour over the espresso.",
      "Enjoy with the figs on the side.",
    ],
    tags: ["Fortified", "Calcium"],
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
  },
];

export function getRecipeById(id: string | undefined): Recipe | undefined {
  if (!id) return undefined;
  return RECIPES.find((r) => r.id === id);
}

export function recipesByMealType(mealType: MealType): Recipe[] {
  return RECIPES.filter((r) => r.mealType === mealType);
}

// ---- Guides ---------------------------------------------------------------

export const GUIDES: Guide[] = [
  {
    id: "g1",
    title: "How to build a bone-friendly meal",
    summary: "A simple template for putting any plate together with bones in mind.",
    readMins: 3,
    intro:
      "You don't need to count anything to eat for stronger bones. Build every plate around three quiet workhorses and the rest takes care of itself.",
    sections: [
      {
        heading: "1. Anchor it with protein",
        body:
          "Aim for a palm-sized portion at every main meal. Protein is what your body uses to maintain the collagen scaffolding of your bones.",
        bullets: [
          "Fish, eggs, chicken, lean red meat",
          "Tofu, tempeh, lentils, beans, chickpeas",
          "Greek yogurt or cottage cheese",
        ],
      },
      {
        heading: "2. Add a calcium source",
        body:
          "Calcium is the mineral your bones store. Try to get some at most meals rather than all in one go.",
        bullets: [
          "Dairy or fortified plant milks",
          "Calcium-set tofu",
          "Tinned sardines or salmon (with bones)",
          "Dark leafy greens like kale and bok choy",
        ],
      },
      {
        heading: "3. Bring in the supporting cast",
        body:
          "A handful of vitamin D and magnesium-rich foods every day helps everything else land.",
        bullets: [
          "Oily fish or fortified foods for vitamin D",
          "Seeds, nuts, wholegrains for magnesium",
          "A daily sun-light walk if you can",
        ],
      },
    ],
    closing:
      "Repeat this template across breakfast, lunch and dinner and you've covered the basics — no calculator needed.",
  },
  {
    id: "g2",
    title: "Easy ways to increase calcium daily",
    summary: "Five low-effort swaps that quietly add 200–400mg of calcium to your day.",
    readMins: 2,
    intro:
      "Most adults need around 1000–1200mg of calcium a day, and small habit shifts add up faster than a single supplement.",
    sections: [
      {
        heading: "Breakfast tweaks",
        body: "These small changes pay back every morning.",
        bullets: [
          "Switch to a fortified plant milk (oat, soya, almond)",
          "Stir a tablespoon of sesame seeds into porridge",
          "Add a slice of cheese to scrambled eggs",
        ],
      },
      {
        heading: "Lunch tweaks",
        body: "Pick one a few times a week.",
        bullets: [
          "Choose tinned sardines or salmon for lunches twice a week",
          "Top salads with feta or crumbled tofu",
          "Spread cottage cheese instead of butter on toast",
        ],
      },
      {
        heading: "Dinner & evening tweaks",
        body: "Easy plate additions.",
        bullets: [
          "Steam dark leafy greens (kale, bok choy) as a side",
          "Stir in a spoonful of yogurt to finish curries and soups",
          "End the day with a fortified milk drink",
        ],
      },
    ],
    closing:
      "Spreading calcium across the day is more effective than a single big dose — your body absorbs it better in smaller amounts.",
  },
  {
    id: "g3",
    title: "Simple swaps for better nutrition",
    summary: "Trade-ups that quietly raise the bone-supporting nutrients in everyday food.",
    readMins: 3,
    intro:
      "You don't need to overhaul your diet. A few habit-level swaps protect your bones, your joints and your overall energy.",
    sections: [
      {
        heading: "Bread & grains",
        body: "Wholegrain options bring magnesium, fibre and slower energy.",
        bullets: [
          "White toast → wholemeal sourdough or rye",
          "White rice → brown rice or quinoa",
          "Plain pasta → wholewheat or chickpea pasta",
        ],
      },
      {
        heading: "Drinks",
        body: "Liquids are an easy place to win.",
        bullets: [
          "Fizzy drinks → sparkling water with lemon",
          "Standard milk → fortified plant or A2 milk",
          "Third coffee → herbal tea (caffeine in excess can leach calcium)",
        ],
      },
      {
        heading: "Snacks",
        body: "Aim for snacks that bring something nutritionally.",
        bullets: [
          "Crisps → almonds and an apple",
          "Biscuits → Greek yogurt with seeds",
          "Chocolate bar → dark chocolate squares with walnuts",
        ],
      },
    ],
    closing:
      "Pick one swap per category to start with. Small consistent choices build stronger bones over time.",
  },
];

export function getGuideById(id: string | undefined): Guide | undefined {
  if (!id) return undefined;
  return GUIDES.find((g) => g.id === id);
}
