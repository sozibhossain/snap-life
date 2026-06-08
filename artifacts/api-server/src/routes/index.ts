import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import revenuecatRouter from "./revenuecat";
import feedbackRouter from "./feedback";
import authRouter from "./auth";
import eventsRouter from "./events";
import pushRouter from "./push";
import profileRouter from "./profile";
import syncRouter from "./sync";
import adminRouter from "./admin";
import meRouter from "./me";
import storageRouter from "./storage";
import subscriptionRouter from "./subscription";
import coachingRouter from "./coaching";
import referralRouter from "./referral";
import expertSupportRouter from "./expertSupport";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(revenuecatRouter);
router.use(feedbackRouter);
router.use(authRouter);
router.use(eventsRouter);
router.use(pushRouter);
router.use(profileRouter);
router.use(syncRouter);
router.use(adminRouter);
router.use(meRouter);
router.use(storageRouter);
router.use(subscriptionRouter);
router.use(coachingRouter);
router.use(referralRouter);
router.use(expertSupportRouter);

export default router;
