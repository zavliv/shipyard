import "server-only";
import { LOCALE, TIME_ZONE } from "./locale";
import { panelUrl } from "./server-info";
import nodemailer from "nodemailer";
import { env } from "./env";

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

function mailer() {
  if (!transport) {
    const s = env.smtp();
    transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.port === 465,
      auth: { user: s.user, pass: s.pass },
    });
  }
  return transport;
}

export async function sendLoginCode(to: string, code: string, ip: string): Promise<void> {
  const when = new Date().toLocaleString(LOCALE, { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
  await mailer().sendMail({
    from: `Shipyard <${env.smtp().from.replace(/^.*<|>.*$/g, "")}>`,
    to,
    subject: `${code} is your Shipyard sign-in code`,
    text: `Your Shipyard sign-in code is ${code}\n\nIt expires in 10 minutes and works once.\nRequested ${when} from ${ip}.\n\nIf you did not try to sign in, ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>Your Shipyard sign-in code is</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:8px 0">${code}</p>
<p>It expires in 10 minutes and works once.</p>
<p style="color:#666;font-size:12px">Requested ${when} from ${ip}. If you did not try to sign in, ignore this email.</p>
</div>`,
  });
}

export async function sendActionCode(to: string, code: string, what: string, ip: string): Promise<void> {
  const when = new Date().toLocaleString(LOCALE, { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
  await mailer().sendMail({
    from: `Shipyard <${env.smtp().from.replace(/^.*<|>.*$/g, "")}>`,
    to,
    subject: `${code} confirms: ${what}`,
    text: `Someone signed in to Shipyard asked to: ${what}\n\nConfirmation code: ${code}\n\nIt expires in 10 minutes and works once.\nRequested ${when} from ${ip}.\n\nIf this wasn't you, don't share the code and sign out of Shipyard everywhere.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>Shipyard received a request to: <b>${what.replace(/</g, "&lt;")}</b></p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:8px 0">${code}</p>
<p>The code expires in 10 minutes and works once.</p>
<p style="color:#666;font-size:12px">Requested ${when} from ${ip}. If this wasn't you, don't share the code.</p>
</div>`,
  });
}

export async function sendAlertEmail(to: string, title: string, body: string, href?: string): Promise<void> {
  const link = panelUrl(href ?? "") || "your Shipyard dashboard";
  await mailer().sendMail({
    from: `Shipyard <${env.smtp().from.replace(/^.*<|>.*$/g, "")}>`,
    to,
    subject: `[Shipyard] ${title}`,
    text: `${title}\n\n${body}\n\nOpen in Shipyard: ${link}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p style="font-size:16px;font-weight:bold;margin:0 0 8px">${title.replace(/</g, "&lt;")}</p>
<p>${body.replace(/</g, "&lt;")}</p>
<p><a href="${link}" style="color:#2f6fcb">Open in Shipyard</a></p>
</div>`,
  });
}
