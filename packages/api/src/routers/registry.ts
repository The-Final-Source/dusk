import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { router, publicProcedure } from "../trpc.js";
import { getAdherenceSummary, getCanonicalIntent, searchCanonicalIntents } from "../services/registry/index.js";

/**
 * The `registry` router — Phase 5 ecosystem skeleton (design D9; P5-T14).
 * Exactly three read-only Zod-validated procedures; no pagination, no auth
 * surface changes, no editing, no live updates (explicitly out of v1 scope).
 */
export const registryRouter = router({
  searchCanonicalIntents: publicProcedure
    .input(z.object({ query: z.string().default("") }))
    .query(({ input }) => ({ intents: searchCanonicalIntents(input.query) })),

  getCanonicalIntent: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .query(({ input }) => {
      const intent = getCanonicalIntent(input.path);
      if (!intent) throw new TRPCError({ code: "NOT_FOUND", message: `no canonical intent at ${input.path}` });
      return { intent };
    }),

  getAdherenceSummary: publicProcedure
    .input(z.object({ package: z.string().min(1) }))
    .query(({ input }) => getAdherenceSummary(input.package)),
});
