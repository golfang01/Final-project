// src/routes/App/auth/+layout.ts
export const ssr = false; // ปิด SSR ถ้าใช้ localStorage
export const prerender = false;
export const trailingSlash = 'ignore';

export const load = () => {
  return {}; // ยืนยันว่า layout นี้ไม่สืบทอดจากแม่
};
