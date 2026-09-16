/**
 * Dry run: scrape every site with `lib/config.ts`'s filters and print what came
 * back, without touching Supabase (so it needs no credentials at all - useful
 * for checking the scrapers themselves in isolation from saved searches).
 *
 * Run this whenever the app's Results tab looks wrong - it's the quickest way
 * to tell "no cars matched" apart from "that site changed and its scraper needs
 * fixing".
 *
 *   npm run verify
 */
import { filters } from "./lib/config.js";
import { runScrapers, printSummary } from "./lib/run.js";

const SAMPLE_ROWS = 3;

async function main() {
  console.log("Filters:", filters, "\n");

  const started = Date.now();
  const { results, listings } = await runScrapers(filters);

  for (const result of results) {
    console.log(`\n=== ${result.name}`);
    if (!result.ok) {
      console.error(`  FAILED: ${result.error}`);
      continue;
    }
    if (result.listings.length === 0) {
      console.log("  no matching listings");
      continue;
    }
    for (const listing of result.listings.slice(0, SAMPLE_ROWS)) {
      const price = listing.price?.toLocaleString("en-AE") ?? "?";
      const km = listing.km?.toLocaleString("en-AE") ?? "?";
      console.log(
        `  ${listing.year ?? "????"} ${listing.make} ${listing.model} - AED ${price} - ${km} km`
      );
      console.log(`    ${listing.link}`);
    }
    if (result.listings.length > SAMPLE_ROWS) {
      console.log(`  ... and ${result.listings.length - SAMPLE_ROWS} more`);
    }
  }

  console.log(`\n--- summary (${Math.round((Date.now() - started) / 1000)}s)`);
  printSummary(results, listings.length);
  console.log("\nDry run - nothing was written to Supabase.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
