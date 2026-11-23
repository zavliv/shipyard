import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  mongoUri: () => required("MONGODB_URI"),
  mongoDb: () => process.env.MONGODB_DB || "shipyard",
  adminEmail: () => required("ADMIN_EMAIL").trim().toLowerCase(),
  smtp: () => ({
    host: required("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT || 587),
    user: required("SMTP_USER"),
    pass: required("SMTP_PASS"),
    from: process.env.MAIL_FROM || required("SMTP_USER"),
  }),
  vpsctlMode: () => (process.env.VPSCTL_MODE === "ssh" ? "ssh" : "local") as "ssh" | "local",
  sshHost: () => process.env.VPSCTL_SSH_HOST || "",
  sshPort: () => process.env.VPSCTL_SSH_PORT || "22",
  production: process.env.NODE_ENV === "production",
};
