import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import nodemailer from "nodemailer";

export function invitationMailer() {
  const fileMode = process.env.MAIL_MODE === "file" && process.env.NODE_ENV !== "production";
  if (fileMode && process.env.MAIL_DIRECTORY) {
    const directory = process.env.MAIL_DIRECTORY;
    return async (to: string, text: string) => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, `${randomUUID()}.json`), JSON.stringify({ to, subject: "Join a CollabFlow workspace", text }), { mode: 0o600 });
    };
  }
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    requireTLS: port !== 465,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    ...(process.env.SMTP_USER && { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }),
  });
  const from = process.env.MAIL_FROM;
  return async (to: string, text: string) => {
    const result = await transport.sendMail({ from, to, subject: "Join a CollabFlow workspace", text });
    if (!result.accepted.length || result.rejected.length) throw new Error("Recipient rejected");
  };
}
