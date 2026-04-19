'use strict';

/**
 * Website Audit Service
 *
 * Fetches a company's homepage and runs a 6-dimension Claude AI audit
 * modeled on the ai-marketing-claude methodology:
 *   Content & Messaging (25%), Conversion Optimization (20%), SEO (20%),
 *   Competitive Positioning (15%), Brand & Trust (10%), Growth & Strategy (10%)
 *
 * Results are stored in website_audits and used to hyper-personalize emails.
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { getConfig } = require('../config');
const logger = require('../utils/logger');

const PAGE_FETCH_TIMEOUT_MS = 10000;
const MAX_PAGE_TEXT_CHARS = 4000; // trim to keep Claude prompt manageable

function _stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function _fetchPageText(url) {
  const res = await axios.get(url, {
    timeout: PAGE_FETCH_TIMEOUT_MS,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OutreachBot/1.0)',
      'Accept': 'text/html',
    },
    maxContentLength: 500000,
  });
  const text = _stripHtml(res.data || '');
  return text.slice(0, MAX_PAGE_TEXT_CHARS);
}

async function _auditWithClaude(pageText, companyName, industry, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const prompt = `You are a B2B digital marketing analyst. Audit this company's website for a managed IT services sales team that will cold-email them.

Company: ${companyName || 'Unknown'}
Industry: ${industry || 'Unknown'}

Website text (extracted):
---
${pageText}
---

Score each dimension 0–100 and provide ONE specific, actionable finding per dimension that a salesperson can reference in a cold email:

1. Content & Messaging (weight 25%) — Is their value prop clear? Do they speak to pain points?
2. Conversion Optimization (weight 20%) — CTAs, forms, lead capture quality
3. SEO & Visibility (weight 20%) — Basic SEO signals, meta content, keyword focus
4. Competitive Positioning (weight 15%) — Do they differentiate from competitors?
5. Brand & Trust (weight 10%) — Testimonials, case studies, professional appearance
6. Growth & Strategy (weight 10%) — Signs of growth goals, hiring, tech investment

Return ONLY valid JSON (no markdown, no explanation outside the JSON):
{
  "content_score": 0,
  "conversion_score": 0,
  "seo_score": 0,
  "competitive_score": 0,
  "brand_score": 0,
  "growth_score": 0,
  "overall_score": 0,
  "findings": {
    "content": "specific finding about their content/messaging",
    "conversion": "specific finding about their CTAs or lead capture",
    "seo": "specific finding about their SEO or discoverability",
    "competitive": "specific finding about their market positioning",
    "brand": "specific finding about their trust signals",
    "growth": "specific finding about their growth signals"
  },
  "email_hooks": [
    "one-sentence specific observation that makes a cold email feel researched",
    "another specific observation"
  ],
  "summary": "2-sentence summary of their biggest marketing gap and opportunity"
}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0]?.text || '{}';
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}') + 1;
  return JSON.parse(text.slice(jsonStart, jsonEnd));
}

/**
 * Audit a company website. Returns the website_audit record.
 * Caches: if an audit exists for this domain from the last 7 days, returns it.
 */
async function auditWebsite({ domain, companyName, industry, contactId, prospectId }) {
  const db = getDb();
  const config = getConfig();

  if (!domain) return null;
  if (!config.ANTHROPIC_API_KEY) {
    logger.warn('[WebsiteAudit] ANTHROPIC_API_KEY not set — skipping audit');
    return null;
  }

  // Normalize domain to URL
  const url = domain.startsWith('http') ? domain : `https://${domain}`;
  const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();

  // Cache check: reuse audit < 7 days old for same domain
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const cached = db.prepare(`
    SELECT * FROM website_audits
    WHERE domain = ? AND status = 'completed' AND created_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).get(normalizedDomain, sevenDaysAgo);

  if (cached) {
    logger.info('[WebsiteAudit] Using cached audit', { domain: normalizedDomain, auditId: cached.id });
    // Link to this contact/prospect if needed
    if (contactId && !cached.contact_id) {
      db.prepare('UPDATE website_audits SET contact_id = ? WHERE id = ?').run(contactId, cached.id);
    }
    return cached;
  }

  const auditId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO website_audits (id, prospect_id, contact_id, company_name, domain, url, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)
  `).run(auditId, prospectId || null, contactId || null, companyName || null, normalizedDomain, url, now, now);

  logger.info('[WebsiteAudit] Starting audit', { auditId, domain: normalizedDomain });

  try {
    // Fetch page
    let pageText = '';
    try {
      pageText = await _fetchPageText(url);
    } catch (fetchErr) {
      logger.warn('[WebsiteAudit] Failed to fetch page, auditing with company name only', {
        domain: normalizedDomain, error: fetchErr.message,
      });
      pageText = `Company: ${companyName || normalizedDomain}. Industry: ${industry || 'unknown'}.`;
    }

    // Run Claude audit
    const result = await _auditWithClaude(pageText, companyName, industry, config.ANTHROPIC_API_KEY);

    const overallScore = result.overall_score || Math.round(
      (result.content_score || 0) * 0.25 +
      (result.conversion_score || 0) * 0.20 +
      (result.seo_score || 0) * 0.20 +
      (result.competitive_score || 0) * 0.15 +
      (result.brand_score || 0) * 0.10 +
      (result.growth_score || 0) * 0.10
    );

    const ts = new Date().toISOString();
    db.prepare(`
      UPDATE website_audits SET
        status = 'completed',
        content_score = ?, conversion_score = ?, seo_score = ?,
        competitive_score = ?, brand_score = ?, growth_score = ?,
        overall_score = ?,
        findings = ?,
        raw_page_text = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      result.content_score || 0, result.conversion_score || 0, result.seo_score || 0,
      result.competitive_score || 0, result.brand_score || 0, result.growth_score || 0,
      overallScore,
      JSON.stringify(result),
      pageText.slice(0, 2000),
      ts,
      auditId
    );

    logger.info('[WebsiteAudit] Audit complete', { auditId, overallScore });
    return db.prepare('SELECT * FROM website_audits WHERE id = ?').get(auditId);

  } catch (err) {
    db.prepare(`UPDATE website_audits SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`)
      .run(err.message, new Date().toISOString(), auditId);
    logger.error('[WebsiteAudit] Audit failed', { auditId, error: err.message });
    return null;
  }
}

function getAudit(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM website_audits WHERE id = ?').get(id);
}

module.exports = { auditWebsite, getAudit };
