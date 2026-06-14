import { router } from "../trpc.js";
import { userRouter } from "./user.js";
import { adminRouter } from "./admin.js";
import { jobsRouter } from "./jobs.js";
import { notificationRouter } from "./notification.js";
import { registryRouter } from "./registry.js";
import { metricsRouter } from "./metrics.js";

export const appRouter = router({
  user: userRouter,
  admin: adminRouter,
  jobs: jobsRouter,
  notification: notificationRouter,
  registry: registryRouter,
  metrics: metricsRouter,
});

export type AppRouter = typeof appRouter;
