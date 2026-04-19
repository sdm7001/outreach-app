'use strict';

/**
 * Web Research Service
 *
 * Gathers publicly available intelligence on a prospect and their company
 * before email generation. Sources:
 *   - DuckDuckGo search snippets for the person (LinkedIn, bio, quotes)
 *   - DuckDuckGo search snippets for company news/press releases
 *
 * No additional API key required. Results are passed to prospect-intelligence
 * for Claude to synthesize into the outreach strategy.
 */

const axios = require('axios');
const logger = require('../utils/logger');

const SEARCH_TIMEOUT_MS = 8000;
const MAX_SNIPPET_CHARS = 3000;

async function _ddgSearch(query) {
  try {
    const res = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      timeout: SEARCH_TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });

    const html = res.data || '';
    // Extract result snippets from DuckDuckGo HTML
    const snippets = [];
    const titleRegex = /class="result__title"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let m;
    while ((m = snippetRegex.exec(html)) !== null && snippets.length < 5) {
      const text = m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (text.length > 30) snippets.push(text);
    }

    return snippets.join(' | ').slice(0, MAX_SNIPPET_CHARS);
  } catch (err) {
    logger.warn('[WebResearch] DuckDuckGo search failed', { query: query.slice(0, 60), error: err.message });
    return '';
  }
}

/**
 * Research a prospect using public web sources.
 * Returns structured findings to feed into prospect intelligence.
 */
async function researchProspect({ firstName, lastName, title, companyName, industry, city }) {
  const name = [firstName, lastName].filter(Boolean).join(' ');
  if (!name && !companyName) return { person: '', company: '', raw: '' };

  logger.info('[WebResearch] Researching prospect', { name, company: companyName });

  const [personSnippets, companySnippets] = await Promise.all([
    name
      ? _ddgSearch(`"${name}" "${companyName || ''}" site:linkedin.com OR professional profile`)
      : Promise.resolve(''),
    companyName
      ? _ddgSearch(`"${companyName}" ${city || 'Houston'} ${industry || ''} news OR press release OR announcement`)
      : Promise.resolve(''),
  ]);

  return {
    person: personSnippets,
    company: companySnippets,
    raw: [personSnippets, companySnippets].filter(Boolean).join('\n\n'),
  };
}

module.exports = { researchProspect };
