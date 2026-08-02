import { getUncachableRevenueCatClient } from "./revenueCatClient";

import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "SNAP Life";

// Bundle / package matches artifacts/mobile/app.json
const APP_STORE_APP_NAME = "SNAP Life iOS";
const APP_STORE_BUNDLE_ID = "com.snaplife.ltd";
const PLAY_STORE_APP_NAME = "SNAP Life Android";
const PLAY_STORE_PACKAGE_NAME = "com.snaplife.app";

// Two entitlements:
//   snap_plus    -> SNAP Plus monthly (£6.99/mo)
//   snap_premium -> Premium access. Granted by both Founder Premium (£9.99/mo)
//                   and SNAP Premium (£14.99/mo).
const PLUS_ENTITLEMENT_IDENTIFIER = "snap_plus";
const PLUS_ENTITLEMENT_DISPLAY_NAME = "SNAP Plus";
const PREMIUM_ENTITLEMENT_IDENTIFIER = "snap_premium";
const PREMIUM_ENTITLEMENT_DISPLAY_NAME = "SNAP Premium";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "SNAP Plans";

interface PlanSpec {
  productIdentifier: string;
  playStoreProductIdentifier: string;
  displayName: string;
  userFacingTitle: string;
  duration: "P1W" | "P1M" | "P2M" | "P3M" | "P6M" | "P1Y";
  packageIdentifier: string;
  packageDisplayName: string;
  prices: { amount_micros: number; currency: string }[];
  /** Which entitlement(s) this product grants. */
  entitlement: "plus" | "premium";
}

// Three monthly packages in the offering:
//   $rc_monthly     -> SNAP Plus (£6.99/mo)       -> snap_plus
//   founder_premium -> Founder Premium (£9.99/mo) -> snap_premium
//   premium         -> SNAP Premium (£14.99/mo)   -> snap_premium
// Introductory trials are configured in App Store Connect / Google Play.
const PLANS: PlanSpec[] = [
  {
    productIdentifier: "snaplife_plus_monthly",
    playStoreProductIdentifier: "snaplife_plus_monthly:monthly",
    displayName: "SNAP Plus Monthly",
    userFacingTitle: "SNAP Plus - Monthly",
    duration: "P1M",
    packageIdentifier: "$rc_monthly",
    packageDisplayName: "Plus Monthly",
    entitlement: "plus",
    prices: [
      { amount_micros: 6990000, currency: "GBP" },
      { amount_micros: 6990000, currency: "USD" },
      { amount_micros: 6990000, currency: "EUR" },
    ],
  },
  {
    productIdentifier: "snaplife_founder_premium_monthly",
    playStoreProductIdentifier: "snaplife_founder_premium_monthly:monthly",
    displayName: "Founder Premium Monthly",
    userFacingTitle: "Founder Premium - Monthly",
    duration: "P1M",
    packageIdentifier: "founder_premium",
    packageDisplayName: "Founder Premium",
    entitlement: "premium",
    prices: [
      { amount_micros: 9990000, currency: "GBP" },
      { amount_micros: 9990000, currency: "USD" },
      { amount_micros: 9990000, currency: "EUR" },
    ],
  },
  {
    productIdentifier: "snaplife_premium_monthly",
    playStoreProductIdentifier: "snaplife_premium_monthly:monthly",
    displayName: "SNAP Premium Monthly",
    userFacingTitle: "SNAP Premium - Monthly",
    duration: "P1M",
    packageIdentifier: "premium",
    packageDisplayName: "Premium Monthly",
    entitlement: "premium",
    prices: [
      { amount_micros: 14990000, currency: "GBP" },
      { amount_micros: 14990000, currency: "USD" },
      { amount_micros: 14990000, currency: "EUR" },
    ],
  },
];

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

async function ensureTestStorePrices(
  client: Awaited<ReturnType<typeof getUncachableRevenueCatClient>>,
  projectId: string,
  productId: string,
  prices: PlanSpec["prices"],
) {
  const { error } = await client.post<TestStorePricesResponse>({
    url: "/projects/{project_id}/products/{product_id}/test_store_prices",
    path: { project_id: projectId, product_id: productId },
    body: { prices },
  });
  if (error) {
    if (typeof error === "object" && "type" in error && (error as any).type === "resource_already_exists") {
      console.log("    Test store prices already set for", productId);
    } else {
      throw new Error("Failed to add test store prices: " + JSON.stringify(error));
    }
  } else {
    console.log("    Set test store prices for", productId);
  }
}

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  // ---- Project --------------------------------------------------------
  const { data: existingProjects, error: listProjectsError } = await listProjects({
    client,
    query: { limit: 50 },
  });
  if (listProjectsError) throw new Error("Failed to list projects");

  let project: Project;
  const existingProject = existingProjects?.items?.find((p) => p.name === PROJECT_NAME);
  if (existingProject) {
    console.log("Project exists:", existingProject.id);
    project = existingProject;
  } else {
    const { data: created, error } = await createProject({
      client,
      body: { name: PROJECT_NAME },
    });
    if (error || !created) throw new Error("Failed to create project");
    console.log("Created project:", created.id);
    project = created;
  }

  // ---- Apps -----------------------------------------------------------
  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listAppsError || !apps || apps.items.length === 0) {
    throw new Error("No apps found — RevenueCat should auto-create a test_store app");
  }

  const testApp: App | undefined = apps.items.find((a) => a.type === "test_store");
  if (!testApp) throw new Error("No test_store app found");
  console.log("Test Store app:", testApp.id);

  let appStoreApp = apps.items.find((a) => a.type === "app_store");
  if (!appStoreApp) {
    const { data, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: APP_STORE_APP_NAME,
        type: "app_store",
        app_store: { bundle_id: APP_STORE_BUNDLE_ID },
      },
    });
    if (error || !data) throw new Error("Failed to create App Store app");
    appStoreApp = data;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app exists:", appStoreApp.id);
  }

  let playStoreApp = apps.items.find((a) => a.type === "play_store");
  if (!playStoreApp) {
    const { data, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: PLAY_STORE_APP_NAME,
        type: "play_store",
        play_store: { package_name: PLAY_STORE_PACKAGE_NAME },
      },
    });
    if (error || !data) throw new Error("Failed to create Play Store app");
    playStoreApp = data;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app exists:", playStoreApp.id);
  }

  // ---- Products (one per plan, per app) -------------------------------
  const { data: listedProducts, error: listProductsError } = await listProducts({
    client,
    path: { project_id: project.id },
    query: { limit: 100 },
  });
  if (listProductsError || !listedProducts) throw new Error("Failed to list products");
  const existingProducts = listedProducts;

  async function ensureProduct(
    targetApp: App,
    label: string,
    productIdentifier: string,
    plan: PlanSpec,
    isTestStore: boolean,
  ): Promise<Product> {
    const existing = existingProducts.items?.find(
      (p) => p.store_identifier === productIdentifier && p.app_id === targetApp.id,
    );
    if (existing) {
      console.log(`  ${label} product exists:`, existing.id);
      return existing;
    }
    const body: CreateProductData["body"] = {
      store_identifier: productIdentifier,
      app_id: targetApp.id,
      type: "subscription",
      display_name: plan.displayName,
    };
    if (isTestStore) {
      body.subscription = { duration: plan.duration };
      body.title = plan.userFacingTitle;
    }
    const { data, error } = await createProduct({
      client,
      path: { project_id: project.id },
      body,
    });
    if (error || !data) throw new Error(`Failed to create ${label} product`);
    console.log(`  Created ${label} product:`, data.id);
    return data;
  }

  const productIdsByEntitlement: Record<"plus" | "premium", string[]> = { plus: [], premium: [] };
  const productsByPackage: Record<string, { test: Product; ios: Product; android: Product; plan: PlanSpec }> = {};

  for (const plan of PLANS) {
    console.log(`\nPlan: ${plan.displayName}`);
    const testProduct = await ensureProduct(testApp, "Test Store", plan.productIdentifier, plan, true);
    const iosProduct = await ensureProduct(appStoreApp, "App Store", plan.productIdentifier, plan, false);
    const androidProduct = await ensureProduct(
      playStoreApp,
      "Play Store",
      plan.playStoreProductIdentifier,
      plan,
      false,
    );
    await ensureTestStorePrices(client, project.id, testProduct.id, plan.prices);
    productIdsByEntitlement[plan.entitlement].push(
      testProduct.id,
      iosProduct.id,
      androidProduct.id,
    );
    productsByPackage[plan.packageIdentifier] = {
      test: testProduct,
      ios: iosProduct,
      android: androidProduct,
      plan,
    };
  }

  // ---- Entitlements (Plus + Premium) ---------------------------------
  console.log("\nEntitlements");
  const { data: listedEntitlements, error: listEntsErr } = await listEntitlements({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listEntsErr || !listedEntitlements) throw new Error("Failed to list entitlements");
  const existingEntitlements = listedEntitlements;

  async function ensureEntitlement(lookupKey: string, displayName: string): Promise<Entitlement> {
    const existing = existingEntitlements.items?.find((e) => e.lookup_key === lookupKey);
    if (existing) {
      console.log(`  ${lookupKey} entitlement exists:`, existing.id);
      return existing;
    }
    const { data, error } = await createEntitlement({
      client,
      path: { project_id: project.id },
      body: { lookup_key: lookupKey, display_name: displayName },
    });
    if (error || !data) throw new Error(`Failed to create ${lookupKey} entitlement`);
    console.log(`  Created ${lookupKey} entitlement:`, data.id);
    return data;
  }

  const plusEnt = await ensureEntitlement(PLUS_ENTITLEMENT_IDENTIFIER, PLUS_ENTITLEMENT_DISPLAY_NAME);
  const premiumEnt = await ensureEntitlement(PREMIUM_ENTITLEMENT_IDENTIFIER, PREMIUM_ENTITLEMENT_DISPLAY_NAME);

  async function attachToEntitlement(entitlement: Entitlement, productIds: string[], label: string) {
    if (productIds.length === 0) return;
    const { error } = await attachProductsToEntitlement({
      client,
      path: { project_id: project.id, entitlement_id: entitlement.id },
      body: { product_ids: productIds },
    });
    if (error) {
      if ((error as any).type === "unprocessable_entity_error") {
        console.log(`  Products already attached to ${label} entitlement`);
      } else {
        throw new Error(`Failed to attach products to ${label} entitlement`);
      }
    } else {
      console.log(`  Attached products to ${label} entitlement`);
    }
  }
  await attachToEntitlement(plusEnt, productIdsByEntitlement.plus, "Plus");
  await attachToEntitlement(premiumEnt, productIdsByEntitlement.premium, "Premium");

  // ---- Offering -------------------------------------------------------
  console.log("\nOffering");
  const { data: existingOfferings, error: listOffErr } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listOffErr) throw new Error("Failed to list offerings");

  let offering: Offering;
  const existingOffering = existingOfferings.items?.find((o) => o.lookup_key === OFFERING_IDENTIFIER);
  if (existingOffering) {
    console.log("  Offering exists:", existingOffering.id);
    offering = existingOffering;
  } else {
    const { data, error } = await createOffering({
      client,
      path: { project_id: project.id },
      body: { lookup_key: OFFERING_IDENTIFIER, display_name: OFFERING_DISPLAY_NAME },
    });
    if (error || !data) throw new Error("Failed to create offering");
    console.log("  Created offering:", data.id);
    offering = data;
  }
  if (!offering.is_current) {
    const { error } = await updateOffering({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: { is_current: true },
    });
    if (error) throw new Error("Failed to set offering as current");
    console.log("  Marked offering as current");
  }

  // ---- Packages -------------------------------------------------------
  console.log("\nPackages");
  const { data: existingPackages, error: listPkgErr } = await listPackages({
    client,
    path: { project_id: project.id, offering_id: offering.id },
    query: { limit: 20 },
  });
  if (listPkgErr) throw new Error("Failed to list packages");

  for (const plan of PLANS) {
    const products = productsByPackage[plan.packageIdentifier];
    let pkg: Package;
    const existing = existingPackages.items?.find((p) => p.lookup_key === plan.packageIdentifier);
    if (existing) {
      console.log(`  Package ${plan.packageIdentifier} exists:`, existing.id);
      pkg = existing;
    } else {
      const { data, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: {
          lookup_key: plan.packageIdentifier,
          display_name: plan.packageDisplayName,
        },
      });
      if (error || !data) throw new Error(`Failed to create package ${plan.packageIdentifier}`);
      console.log(`  Created package ${plan.packageIdentifier}:`, data.id);
      pkg = data;
    }
    const { error: attachPkgErr } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: products.test.id, eligibility_criteria: "all" },
          { product_id: products.ios.id, eligibility_criteria: "all" },
          { product_id: products.android.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPkgErr) {
      if (
        (attachPkgErr as any).type === "unprocessable_entity_error" &&
        (attachPkgErr as any).message?.includes("Cannot attach product")
      ) {
        console.log(`  Skipping attach for ${plan.packageIdentifier}: incompatible product already attached`);
      } else {
        throw new Error(`Failed to attach products to package ${plan.packageIdentifier}`);
      }
    } else {
      console.log(`  Attached products to package ${plan.packageIdentifier}`);
    }
  }

  // ---- Public API keys ------------------------------------------------
  const { data: testKeys } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: testApp.id },
  });
  const { data: iosKeys } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: appStoreApp.id },
  });
  const { data: androidKeys } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: playStoreApp.id },
  });

  console.log("\n====================================================");
  console.log("RevenueCat setup for SNAP Life complete!");
  console.log("====================================================");
  console.log("Set these as Replit secrets:");
  console.log("  REVENUECAT_PROJECT_ID                   =", project.id);
  console.log("  REVENUECAT_TEST_STORE_APP_ID            =", testApp.id);
  console.log("  REVENUECAT_APPLE_APP_STORE_APP_ID       =", appStoreApp.id);
  console.log("  REVENUECAT_GOOGLE_PLAY_STORE_APP_ID     =", playStoreApp.id);
  console.log("  EXPO_PUBLIC_REVENUECAT_TEST_API_KEY     =", testKeys?.items.map((k) => k.key).join(",") ?? "N/A");
  console.log("  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY      =", iosKeys?.items.map((k) => k.key).join(",") ?? "N/A");
  console.log("  EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY  =", androidKeys?.items.map((k) => k.key).join(",") ?? "N/A");
  console.log("");
  console.log(
    "Entitlement identifiers (already wired in code): " +
      `${PLUS_ENTITLEMENT_IDENTIFIER}, ${PREMIUM_ENTITLEMENT_IDENTIFIER}`,
  );
  console.log("====================================================\n");
}

seedRevenueCat().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
