import { createNoticeResolver } from "../../shared/notices.mjs";
let resolve = createNoticeResolver();
export function configureNotices(overrides) {
  resolve = createNoticeResolver(overrides || {});
}
export function noticeText(template, values) {
  return resolve(template, values);
}
