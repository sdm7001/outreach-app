require("dotenv").config();

module.exports = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  APOLLO_API_KEY: process.env.APOLLO_API_KEY || "",
  GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY || "",
  HUNTER_API_KEY: process.env.HUNTER_API_KEY || "",
  SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
  SMTP_PORT: parseInt(process.env.SMTP_PORT || "587"),
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  FROM_NAME: process.env.FROM_NAME || "Lindsay Thompson",
  FROM_EMAIL: process.env.FROM_EMAIL || process.env.SMTP_USER || "",
  TRACKING_DOMAIN: process.env.TRACKING_DOMAIN || "https://lindsay.texmg.com",
  TRACKING_PORT: parseInt(process.env.TRACKING_PORT || "3847"),
  TG_BOT_TOKEN: process.env.TG_BOT_TOKEN || "8791433925:AAHXNby7AXWs3M8N-lc_sKHqsFLZQ0bJzis",
  TG_CHAT_ID: process.env.TG_CHAT_ID || "7091232103",
  DAILY_PROSPECT_LIMIT: parseInt(process.env.DAILY_PROSPECT_LIMIT || "10"),
  EMAIL_STAGGER_MIN_MS: parseInt(process.env.EMAIL_STAGGER_MIN_MS || "480000"),
  EMAIL_STAGGER_MAX_MS: parseInt(process.env.EMAIL_STAGGER_MAX_MS || "720000"),
  COMPANY_NAME: "TexMG",
  COMPANY_ADDRESS: "21175 Tomball Parkway, Houston TX 77070",
  COMPANY_WEBSITE: "https://texmg.com",
  TALOS_WEBSITE: "https://talosautomation.ai",
  TARGET_INDUSTRIES: ["Healthcare", "Law Practice", "Accounting", "Medical Practice", "Dental", "Legal Services", "CPA", "Financial Services"],
  TARGET_TITLES: ["Office Manager", "Practice Administrator", "Managing Partner", "CEO", "Owner", "Practice Manager", "Operations Manager", "IT Director"],
  TARGET_LOCATIONS: ["Houston, Texas", "Houston, TX"],
  TARGET_EMPLOYEE_RANGE: [25, 200],
  PAIN_ANGLES: [
    { angle: "it-downtime", desc: "IT downtime costs and unreliable support" },
    { angle: "hipaa-compliance", desc: "HIPAA/compliance anxiety and audit risk" },
    { angle: "ai-automation", desc: "AI automation for repetitive tasks and patient/client communication" },
    { angle: "cybersecurity", desc: "Ransomware and cybersecurity threats targeting small practices" },
    { angle: "cost-savings", desc: "Overpaying for IT while getting poor response times" },
    { angle: "growth", desc: "Scaling operations without adding headcount using AI" }
  ]
};
