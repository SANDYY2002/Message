import { config } from "./config.js";
import { createNoticeResolver } from "../../shared/notices.mjs";
export const noticeText = createNoticeResolver(config.notices);
