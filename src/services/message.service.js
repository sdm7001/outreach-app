'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { getConfig } = require('../config');
const logger = require('../utils/logger');

const SPAM_WORDS = [
  'free', 'guarantee', 'winner', 'cash', 'prize', 'urgent', 'act now',
  'click here', 'limited time', 'no risk', '100%', 'make money', 'earn money',
  'buy now', 'order now', 'don\'t delete', 'you have been selected'
];

function checkSpamScore(subject, body) {
  const text = ((subject || '') + ' ' + (body || '')).toLowerCase();
  let score = 0;
  const triggers = [];

  for (const word of SPAM_WORDS) {
    if (text.includes(word)) {
      score += 10;
      triggers.push(word);
    }
  }

  // ALL CAPS words
  const capsWords = (text.match(/\b[A-Z]{4,}\b/g) || []).length;
  score += capsWords * 5;

  // Excessive exclamation marks
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations > 3) score += exclamations * 3;

  // Many links
  const links = (body || '').match(/https?:\/\//g) || [];
  if (links.length > 3) score += (links.length - 3) * 5;

  return { score: Math.min(score, 100), triggers };
}

async function generateDraft(contactId, campaignId, stepId, promptVersion, websiteAuditId) {
  const db = getDb();
  const config = getConfig();

  // Get contact with account info
  const contact = db.prepare(`
    SELECT c.*, a.company_name, a.industry, a.domain, a.employee_count
    FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id
    WHERE c.id = ?
  `).get(contactId);

  if (!contact) throw new NotFoundError(`Contact ${contactId} not found`);

  // Get step info
  const step = stepId
    ? db.prepare('SELECT * FROM sequence_steps WHERE id = ?').get(stepId)
    : null;

  // Build prompt
  const firstName = contact.first_name || 'there';
  const company = contact.company_name || 'your company';
  const industry = contact.industry || 'your industry';
  const title = contact.title || 'professional';
  const angle = contact.outreach_angle || 'it-downtime';

  const senderName = config.FROM_NAME || 'Scott';
  const senderCompany = config.COMPANY_NAME || 'TexMG';
  const talosWebsite = config.TALOS_WEBSITE || 'https://talosautomation.ai';

  let tone = step?.tone || 'professional';
  let subjectHint = step?.subject_template || '';
  let bodyHint = step?.body_template || '';

  const painMap = {
    'it-downtime': 'IT downtime and unreliable support costing productivity',
    'hipaa-compliance': 'HIPAA/compliance risks and audit exposure',
    'ai-automation': 'AI automation opportunities to reduce manual work',
    'cybersecurity': 'ransomware and cybersecurity threats targeting small practices',
    'cost-savings': 'overpaying for IT while getting slow response times',
    'growth': 'scaling operations without adding headcount using AI',
  };
  const pain = painMap[angle] || painMap['it-downtime'];

  // Load website audit findings if available
  let auditContext = '';
  if (websiteAuditId) {
    const audit = db.prepare('SELECT * FROM website_audits WHERE id = ?').get(websiteAuditId);
    if (audit && audit.status === 'completed' && audit.findings) {
      try {
        const findings = JSON.parse(audit.findings);
        const hooks = findings.email_hooks || [];
        const summary = findings.summary || '';
        if (hooks.length || summary) {
          auditContext = `\nWebsite audit findings for ${company} (score: ${audit.overall_score}/100):\n`;
          if (summary) auditContext += `- ${summary}\n`;
          hooks.forEach(h => { auditContext += `- ${h}\n`; });
          auditContext += 'Use 1-2 of these specific observations to make the email feel researched, not generic.\n';
        }
      } catch (_) { /* ignore parse error */ }
    }
  }

  const systemPrompt = `You are an expert B2B cold email writer for a managed IT services and AI automation company. Your emails are concise (under 150 words), personalized, professional, and never use spam trigger words. Always include a clear call-to-action. Tone: ${tone}.`;

  const userPrompt = subjectHint && bodyHint
    ? `Generate a cold email using this subject template: "${subjectHint}" and body template: "${bodyHint}". Personalize for: First Name: ${firstName}, Company: ${company}, Industry: ${industry}, Title: ${title}, Pain Point: ${pain}.${auditContext} Sender: ${senderName} from ${senderCompany}. Include {{UNSUBSCRIBE_URL}} at the end. Return JSON: {"subject": "...", "body": "..."}`
    : `Generate a personalized cold email for:
- First Name: ${firstName}
- Company: ${company}
- Industry: ${industry}
- Title: ${title}
- Pain point to address: ${pain}
${auditContext}Sender: ${senderName} from ${senderCompany} (AI automation + managed IT services, website: ${talosWebsite})
Requirements: Under 150 words, specific to their industry, no generic phrases, reference something specific about their business if audit findings are provided, clear next step CTA, include {{UNSUBSCRIBE_URL}} on last line.
Return valid JSON only: {"subject": "...", "body": "..."}`;

  if (!config.ANTHROPIC_API_KEY) {
    // Mock generation when no API key
    logger.warn('ANTHROPIC_API_KEY not set, using mock generation');
    return saveDraft(db, contactId, campaignId, stepId, {
      subject: `Quick question for ${company}`,
      body: `Hi ${firstName},\n\nI noticed ${company} is in the ${industry} space and wanted to reach out about ${pain}.\n\nWe help companies like yours with managed IT and AI automation. Would you have 15 minutes this week to discuss?\n\nBest,\n${senderName}\n\n{{UNSUBSCRIBE_URL}}`,
    }, config.AI_MODEL, promptVersion || 'v1', websiteAuditId);
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: config.AI_MODEL || 'claude-haiku-4-5',
    max_tokens: config.AI_MAX_TOKENS || 600,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  });

  const rawText = message.content[0].text.trim();

  let parsed;
  try {
    // Extract JSON from response (may have markdown code blocks)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch (e) {
    logger.warn('Failed to parse AI response as JSON, using raw', { raw: rawText.slice(0, 200) });
    parsed = {
      subject: `Question for ${company}`,
      body: rawText,
    };
  }

  return saveDraft(db, contactId, campaignId, stepId, parsed, config.AI_MODEL, promptVersion || config.AI_PROMPT_VERSION, websiteAuditId);
}

function saveDraft(db, contactId, campaignId, stepId, { subject, body }, aiModel, promptVersion, websiteAuditId) {
  const spamResult = checkSpamScore(subject, body);
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO message_drafts (id, contact_id, campaign_id, sequence_step_id, subject, body, ai_model, prompt_version, spam_score, website_audit_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)
  `).run(id, contactId, campaignId || null, stepId || null, subject, body, aiModel, promptVersion, spamResult.score, websiteAuditId || null, now);

  logger.info('Draft generated', { draftId: id, contactId, spamScore: spamResult.score });
  return getDraft(id);
}

function getDraft(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT d.*, c.first_name, c.last_name, c.email as contact_email, c.title,
           a.company_name,
           wa.overall_score as audit_overall_score,
           wa.findings as audit_findings,
           wa.domain as audit_domain
    FROM message_drafts d
    JOIN contacts c ON c.id = d.contact_id
    LEFT JOIN accounts a ON a.id = c.account_id
    LEFT JOIN website_audits wa ON wa.id = d.website_audit_id
    WHERE d.id = ?
  `).get(id);
  if (!row) throw new NotFoundError(`Draft ${id} not found`);
  return row;
}

function listDrafts({ status, campaign_id, page = 1, limit = 20 } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (status) { conditions.push('d.status = ?'); params.push(status); }
  if (campaign_id) { conditions.push('d.campaign_id = ?'); params.push(campaign_id); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM message_drafts d ${where}`).get(...params).cnt;

  const rows = db.prepare(`
    SELECT d.*, c.first_name, c.last_name, c.email as contact_email, c.title, a.company_name,
           wa.overall_score as audit_overall_score, wa.domain as audit_domain,
           wa.findings as audit_findings
    FROM message_drafts d
    JOIN contacts c ON c.id = d.contact_id
    LEFT JOIN accounts a ON a.id = c.account_id
    LEFT JOIN website_audits wa ON wa.id = d.website_audit_id
    ${where}
    ORDER BY d.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { data: rows, total, page, limit, pages: Math.ceil(total / limit) };
}

function approveDraft(id, userId) {
  const db = getDb();
  const draft = db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(id);
  if (!draft) throw new NotFoundError(`Draft ${id} not found`);
  if (draft.status === 'approved') throw new ValidationError('Draft already approved');

  db.prepare(`UPDATE message_drafts SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(userId, new Date().toISOString(), id);

  logger.info('Draft approved', { draftId: id, userId });
  return getDraft(id);
}

function rejectDraft(id, userId, reason) {
  const db = getDb();
  const draft = db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(id);
  if (!draft) throw new NotFoundError(`Draft ${id} not found`);

  db.prepare(`UPDATE message_drafts SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(userId, new Date().toISOString(), id);

  logger.info('Draft rejected', { draftId: id, userId, reason });
  return getDraft(id);
}

async function generateWithRetry(params, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generateDraft(params.contactId, params.campaignId, params.stepId, params.promptVersion, params.websiteAuditId);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw lastErr;
}

module.exports = { generateDraft, generateWithRetry, getDraft, listDrafts, approveDraft, rejectDraft, checkSpamScore };
