'use strict';

/**
 * Auto-Prospecting Worker
 *
 * Runs on a configurable interval (default: every 6 hours).
 * 1. Searches Apollo.io using the configured ICP preset
 * 2. Scores each prospect against the ICP using Claude AI
 * 3. Saves prospects scoring >= threshold to the prospect pool
 * 4. Enqueues enrichment for each new prospect
 */

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { getConfig } = require('../config');
const { enqueue } = require('./queue');
const logger = require('../utils/logger');

// ICP1 — TexMG MSP target profile (Houston, TX)
const ICP_PROFILES = {
  icp1: {
    name: 'TexMG MSP — Houston TX',
    description: 'Small-to-mid-size businesses in Houston, TX that need managed IT services. Target industries: healthcare, legal, financial services, oil & energy, construction, accounting. Company size: 10–200 employees. Decision maker titles: owner, CEO, president, office manager, IT director.',
    apollo: {
      per_page: 25,
      page: 1,
      person_titles: ['owner','founder','ceo','president','managing partner','office manager','practice manager','it manager','it director','operations manager','coo'],
      q_organization_locations: ['Houston, Texas, United States'],
      q_organization_keyword_tags: ['information technology and services','computer & network security','hospital & health care','legal services','accounting','financial services','oil & energy','construction'],
      organization_num_employees_ranges: ['10,200'],
    },
    scoreThreshold: 60,
  },
};

async function autoProspectTick(icpPreset = 'icp1') {
  const config = getConfig();
  const db = getDb();

  if (!config.APOLLO_API_KEY) {
    logger.warn('[AutoProspect] APOLLO_API_KEY not configured — skipping');
    return;
  }
  if (!config.ANTHROPIC_API_KEY) {
    logger.warn('[AutoProspect] ANTHROPIC_API_KEY not configured — skipping');
    return;
  }

  const icp = ICP_PROFILES[icpPreset];
  if (!icp) {
    logger.error('[AutoProspect] Unknown ICP preset', { icpPreset });
    return;
  }

  const runId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO auto_prospect_runs (id, status, icp_preset, started_at, created_at)
    VALUES (?, 'running', ?, ?, ?)
  `).run(runId, icpPreset, now, now);

  logger.info('[AutoProspect] Run started', { runId, icpPreset, icp: icp.name });

  try {
    // Step 1: Search Apollo
    const rawProspects = await _searchApollo(icp.apollo, config.APOLLO_API_KEY);
    logger.info('[AutoProspect] Apollo returned prospects', { runId, count: rawProspects.length });

    if (!rawProspects.length) {
      db.prepare(`UPDATE auto_prospect_runs SET status='completed', prospects_found=0, finished_at=? WHERE id=?`)
        .run(new Date().toISOString(), runId);
      logger.info('[AutoProspect] No prospects returned from Apollo', { runId });
      return;
    }

    // Step 2: Score via Claude (single batch call)
    const scored = await _scoreProspectsWithClaude(rawProspects, icp, config.ANTHROPIC_API_KEY);
    logger.info('[AutoProspect] Scoring complete', {
      runId,
      total: scored.length,
      aboveThreshold: scored.filter(p => p.icp_score >= icp.scoreThreshold).length,
    });

    // Step 3: Save qualifying prospects to pool
    let saved = 0;
    let skipped = 0;

    for (const p of scored) {
      if (p.icp_score < icp.scoreThreshold) { skipped++; continue; }

      // Dedup by email
      if (p.email) {
        const existing = db.prepare('SELECT id FROM prospect_pool WHERE email = ?').get(p.email);
        if (existing) { skipped++; continue; }
      }

      // Dedup by name + company if no email
      if (!p.email && p.first_name && p.last_name && p.company_name) {
        const existing = db.prepare(`
          SELECT id FROM prospect_pool
          WHERE first_name = ? AND last_name = ? AND company_name = ?
        `).get(p.first_name, p.last_name, p.company_name);
        if (existing) { skipped++; continue; }
      }

      const prospectId = uuidv4();
      const ts = new Date().toISOString();

      db.prepare(`
        INSERT INTO prospect_pool (
          id, user_id, first_name, last_name, email, title, company_name,
          industry, city, state, country, source, tags, status,
          icp_score, icp_reasoning, auto_prospect_run_id,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'auto_prospect','[]','pending',?,?,?,?,?)
      `).run(
        prospectId, null,
        p.first_name || null, p.last_name || null,
        p.email || null, p.title || null, p.company_name || null,
        p.industry || null, p.city || null, p.state || null, p.country || null,
        p.icp_score, p.icp_reasoning || null, runId,
        ts, ts
      );

      // Enqueue enrichment
      try {
        await enqueue('enrich_contact_auto', { prospectId }, {
          idempotencyKey: `auto-enrich:${prospectId}`,
        });
      } catch (_) { /* ignore duplicate */ }

      saved++;
    }

    db.prepare(`
      UPDATE auto_prospect_runs
      SET status='completed', prospects_found=?, prospects_saved=?, prospects_skipped=?, finished_at=?
      WHERE id=?
    `).run(rawProspects.length, saved, skipped, new Date().toISOString(), runId);

    logger.info('[AutoProspect] Run complete', { runId, found: rawProspects.length, saved, skipped });

  } catch (err) {
    db.prepare(`
      UPDATE auto_prospect_runs SET status='failed', error_message=?, finished_at=? WHERE id=?
    `).run(err.message, new Date().toISOString(), runId);
    logger.error('[AutoProspect] Run failed', { runId, error: err.message });
    throw err;
  }
}

async function _searchApollo(apolloParams, apiKey) {
  const res = await axios.post('https://api.apollo.io/v1/people/search', apolloParams, {
    timeout: 15000,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
  });

  const people = res.data?.people || [];
  return people
    .filter(p => p.first_name || p.last_name || p.organization?.name)
    .map(p => ({
      first_name: p.first_name || null,
      last_name: p.last_name || null,
      email: (p.email && p.email.includes('*')) ? null : (p.email || null),
      title: p.title || null,
      company_name: p.organization?.name || null,
      industry: p.organization?.industry || null,
      city: p.city || null,
      state: p.state || null,
      country: p.country || null,
      employee_count: p.organization?.estimated_num_employees || null,
    }));
}

async function _scoreProspectsWithClaude(prospects, icp, apiKey) {
  const client = new Anthropic({ apiKey });

  const prospectList = prospects.map((p, i) =>
    `${i + 1}. ${p.first_name || ''} ${p.last_name || ''} | ${p.title || 'Unknown title'} | ${p.company_name || 'Unknown company'} | ${p.industry || 'Unknown industry'} | ${p.city || ''}, ${p.state || ''} | Employees: ${p.employee_count || 'unknown'}`
  ).join('\n');

  const prompt = `You are an ICP (Ideal Customer Profile) scoring assistant.

ICP Description:
${icp.description}

Score each of the following prospects from 0–100 based on how well they match the ICP.
- 80–100: Excellent fit — matches industry, location, company size, and decision-maker title
- 60–79: Good fit — matches most criteria
- 40–59: Partial fit — matches some criteria
- 0–39: Poor fit — does not match key criteria

Prospects:
${prospectList}

Respond with a JSON array only (no markdown, no explanation outside the JSON):
[
  { "index": 1, "score": 85, "reasoning": "one sentence why" },
  ...
]`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  let scores = [];
  try {
    const text = message.content[0]?.text || '[]';
    const jsonStart = text.indexOf('[');
    const jsonEnd = text.lastIndexOf(']') + 1;
    scores = JSON.parse(text.slice(jsonStart, jsonEnd));
  } catch (err) {
    logger.warn('[AutoProspect] Failed to parse Claude scoring response', { error: err.message });
    // Return all prospects with score 0 on parse failure rather than losing them
    return prospects.map(p => ({ ...p, icp_score: 0, icp_reasoning: 'Scoring unavailable' }));
  }

  return prospects.map((p, i) => {
    const scored = scores.find(s => s.index === i + 1);
    return {
      ...p,
      icp_score: scored?.score || 0,
      icp_reasoning: scored?.reasoning || null,
    };
  });
}

function getAutoProspectStatus() {
  const db = getDb();
  const recent = db.prepare(`
    SELECT * FROM auto_prospect_runs ORDER BY created_at DESC LIMIT 10
  `).all();
  const running = recent.find(r => r.status === 'running');
  return { running: !!running, recent };
}

module.exports = { autoProspectTick, getAutoProspectStatus };
