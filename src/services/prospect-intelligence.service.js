'use strict';

/**
 * Prospect Intelligence Service
 *
 * Uses Claude to build a strategic brief on each prospect before email generation.
 * Combines everything known about the individual:
 *   - Title, role, seniority level
 *   - Industry and company size
 *   - Website audit findings (what their company's digital presence looks like)
 *
 * Output: a prospect brief with the single best appointment angle, tone,
 * conversation openers, likely objections, and personalization notes.
 *
 * This drives email generation — instead of generic templates, Claude writes
 * each email specifically for this person's role and situation.
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { getConfig } = require('../config');
const { researchProspect } = require('./web-research.service');
const logger = require('../utils/logger');

// Role seniority buckets used to calibrate Claude's analysis
const OWNER_TITLES = ['owner', 'founder', 'ceo', 'president', 'principal', 'managing partner', 'managing director', 'partner'];
const EXEC_TITLES  = ['coo', 'cfo', 'vp', 'vice president', 'director', 'chief'];
const MGMT_TITLES  = ['manager', 'administrator', 'supervisor', 'coordinator', 'operations'];
const IT_TITLES    = ['it director', 'it manager', 'systems administrator', 'sysadmin', 'network', 'infrastructure', 'technology'];

function _classifyTitle(title = '') {
  const t = title.toLowerCase();
  if (OWNER_TITLES.some(r => t.includes(r))) return 'owner_ceo';
  if (IT_TITLES.some(r => t.includes(r)))    return 'it_decision_maker';
  if (EXEC_TITLES.some(r => t.includes(r)))  return 'c_suite_exec';
  if (MGMT_TITLES.some(r => t.includes(r)))  return 'office_manager';
  return 'professional';
}

async function _buildIntelWithClaude({ contact, account, websiteAudit, webResearch, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const titleClass = _classifyTitle(contact.title);
  const employeeCount = account?.employee_count || contact.employee_count || null;
  const sizeDesc = employeeCount ? `${employeeCount} employees` : 'small-to-mid-size';

  // Include website audit summary if available
  let auditSection = '';
  if (websiteAudit && websiteAudit.status === 'completed' && websiteAudit.findings) {
    try {
      const f = JSON.parse(websiteAudit.findings);
      auditSection = `
Company Website Analysis (score ${websiteAudit.overall_score}/100):
- Summary: ${f.summary || 'N/A'}
- Content & Messaging: ${f.content_score}/100 — ${(f.findings && f.findings.content) || ''}
- Conversion: ${f.conversion_score}/100 — ${(f.findings && f.findings.conversion) || ''}
- SEO: ${f.seo_score}/100 — ${(f.findings && f.findings.seo) || ''}
- Competitive Positioning: ${f.competitive_score}/100 — ${(f.findings && f.findings.competitive) || ''}
- Brand & Trust: ${f.brand_score}/100 — ${(f.findings && f.findings.brand) || ''}
- Growth Signals: ${f.growth_score}/100 — ${(f.findings && f.findings.growth) || ''}`;
    } catch (_) { /* ignore */ }
  }

  // Include web research findings if available
  let webSection = '';
  if (webResearch) {
    if (webResearch.person) {
      webSection += `\nPublic web research on ${contact.first_name || ''} ${contact.last_name || ''}:\n${webResearch.person}\n`;
    }
    if (webResearch.company) {
      webSection += `\nPublic web research on ${contact.company_name || account?.company_name || 'their company'}:\n${webResearch.company}\n`;
    }
  }

  const prompt = `You are a B2B sales strategist for TexMG, a managed IT services and AI automation company serving Houston, TX businesses (10–200 employees). Your job is to brief a sales rep before they cold email a prospect, with the goal of booking a 15-minute discovery call.

PROSPECT:
- Name: ${contact.first_name || ''} ${contact.last_name || ''}
- Title: ${contact.title || 'Unknown'}
- Role type: ${titleClass.replace(/_/g, ' ')}
- Company: ${contact.company_name || account?.company_name || 'Unknown'}
- Industry: ${contact.industry || account?.industry || 'Unknown'}
- Company size: ${sizeDesc}
- Location: ${contact.city || ''}, ${contact.state || 'TX'}
${auditSection}${webSection}
OUR SERVICES: Managed IT (helpdesk, monitoring, backup, security), AI workflow automation, HIPAA/compliance IT support, cybersecurity, Microsoft 365 management.

Analyze this prospect and produce a strategic brief for the sales rep. Think deeply about:
1. What does someone with THIS title at a company THIS size in THIS industry actually worry about day-to-day?
2. What would make them want to take a 15-minute call with an IT company?
3. What specific observation from the website audit or web research (if available) is most compelling to reference?
4. What tone will land best — direct ROI talk for an owner, technical credibility for IT, compliance framing for healthcare, etc.?
5. What did the web research reveal about this person or their company that we can reference naturally in the email?

Return ONLY valid JSON (no markdown, no explanation outside the JSON):
{
  "role_profile": "2-3 sentence description of what this person's job pressures and priorities actually are",
  "pain_points": [
    "most likely pain point specific to their role and industry",
    "second most likely pain point",
    "third most likely pain point"
  ],
  "appointment_angle": "The single best reason this specific person would agree to a 15-minute call — be specific to their role, industry, website, and any web research findings",
  "recommended_tone": "one of: direct_roi | technical_credibility | compliance_risk | empathetic_peer | growth_focused",
  "conversation_openers": [
    "First specific opening sentence that references something real about them or their company (not generic)",
    "Alternative opener with a different angle",
    "A question-based opener that creates curiosity"
  ],
  "objection_handling": [
    "Most likely objection this title gives IT vendors + brief preempt strategy",
    "Second most likely objection + preempt"
  ],
  "personalization_notes": "Key insight the email writer should keep in mind — specific facts from web research or the website audit that make this prospect unique",
  "subject_line_ideas": [
    "Subject line idea 1 — specific, references something real",
    "Subject line idea 2 — different angle"
  ]
}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0]?.text || '{}';
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}') + 1;
  return JSON.parse(text.slice(jsonStart, jsonEnd));
}

/**
 * Build prospect intelligence for a contact. Returns the intelligence record.
 * Caches per contact — one intel record per contact (regenerated if stale > 30 days).
 */
async function buildProspectIntelligence({ contact, account, websiteAudit, prospectId }) {
  const db = getDb();
  const config = getConfig();

  if (!config.ANTHROPIC_API_KEY) {
    logger.warn('[ProspectIntel] ANTHROPIC_API_KEY not set — skipping');
    return null;
  }

  const contactId = contact.id || null;

  // Cache check: reuse intel < 30 days old for same contact
  if (contactId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const cached = db.prepare(`
      SELECT * FROM prospect_intelligence
      WHERE contact_id = ? AND status = 'completed' AND created_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(contactId, thirtyDaysAgo);
    if (cached) {
      logger.info('[ProspectIntel] Using cached intel', { contactId, intelId: cached.id });
      return cached;
    }
  }

  const intelId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO prospect_intelligence
      (id, contact_id, prospect_id, first_name, last_name, title, company_name, industry, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
  `).run(
    intelId,
    contactId,
    prospectId || null,
    contact.first_name || null,
    contact.last_name || null,
    contact.title || null,
    contact.company_name || account?.company_name || null,
    contact.industry || account?.industry || null,
    now, now
  );

  logger.info('[ProspectIntel] Building intelligence brief', {
    intelId, contactId,
    title: contact.title, company: contact.company_name || account?.company_name,
  });

  try {
    // Run web research in parallel with nothing else blocking it
    const webResearch = await researchProspect({
      firstName: contact.first_name,
      lastName: contact.last_name,
      title: contact.title,
      companyName: contact.company_name || account?.company_name,
      industry: contact.industry || account?.industry,
      city: contact.city,
    });

    const brief = await _buildIntelWithClaude({ contact, account, websiteAudit, webResearch, apiKey: config.ANTHROPIC_API_KEY });

    const ts = new Date().toISOString();
    db.prepare(`
      UPDATE prospect_intelligence SET
        status = 'completed',
        role_profile = ?,
        pain_points = ?,
        appointment_angle = ?,
        recommended_tone = ?,
        conversation_openers = ?,
        objection_handling = ?,
        personalization_notes = ?,
        full_brief = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      brief.role_profile || null,
      JSON.stringify(brief.pain_points || []),
      brief.appointment_angle || null,
      brief.recommended_tone || null,
      JSON.stringify(brief.conversation_openers || []),
      JSON.stringify(brief.objection_handling || []),
      brief.personalization_notes || null,
      JSON.stringify(brief),
      ts,
      intelId
    );

    logger.info('[ProspectIntel] Brief complete', {
      intelId, tone: brief.recommended_tone, angle: brief.appointment_angle,
    });

    return db.prepare('SELECT * FROM prospect_intelligence WHERE id = ?').get(intelId);

  } catch (err) {
    db.prepare(`UPDATE prospect_intelligence SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`)
      .run(err.message, new Date().toISOString(), intelId);
    logger.error('[ProspectIntel] Brief failed', { intelId, error: err.message });
    return null;
  }
}

function getIntelligence(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM prospect_intelligence WHERE id = ?').get(id);
}

module.exports = { buildProspectIntelligence, getIntelligence };
