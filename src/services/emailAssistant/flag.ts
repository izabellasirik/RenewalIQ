/**
 * Email Assistant switches, read at build time. The assistant is on unless VITE_EMAIL_ASSISTANT=0
 * (the kill switch: the account's "Email Assistant" button disappears; nothing else changes). Its
 * AI reading is off unless VITE_EMAIL_ASSISTANT_AI=1 — then, for emails the fixed rules are unsure
 * about, the extract-document-vision function's "email" mode is asked as well. Kept in its own
 * module so pages can check it without loading the assistant.
 */
export const EMAIL_ASSISTANT_ENABLED = import.meta.env.VITE_EMAIL_ASSISTANT !== '0';
export const EMAIL_ASSISTANT_AI_ENABLED = import.meta.env.VITE_EMAIL_ASSISTANT_AI === '1';
